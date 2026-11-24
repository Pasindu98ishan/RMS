package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.common.validation.Amounts;
import com.santhula.rms.menu.domain.Category;
import com.santhula.rms.menu.domain.KitchenStation;
import com.santhula.rms.menu.domain.MenuItem;
import com.santhula.rms.menu.domain.ModifierGroup;
import com.santhula.rms.menu.repo.CategoryRepository;
import com.santhula.rms.menu.repo.KitchenStationRepository;
import com.santhula.rms.menu.repo.MenuItemRepository;
import com.santhula.rms.menu.repo.ModifierGroupRepository;
import jakarta.persistence.criteria.Predicate;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Menu items with LOCAL / FOREIGN prices, modifier groups and the sold-out flag (P1-MENU-02..06). */
@Service
public class MenuItemService {

    public static final Pattern CODE = Pattern.compile("^[A-Z0-9-]{1,20}$");
    private static final Set<String> SORTABLE = Set.of("code", "name", "localPrice", "updatedAt");

    /** What a client sends to create or replace an item. */
    public record ItemData(String code, String name, UUID categoryId, UUID stationId, BigDecimal localPrice,
                           BigDecimal foreignPrice, Boolean active, List<UUID> modifierGroupIds) {
    }

    public record GroupRef(UUID id, String name) {
    }

    /** An item with the names it refers to, built inside the transaction. */
    public record ItemView(MenuItem item, String categoryName, String stationName, List<GroupRef> groups) {
    }

    public record ItemFilter(UUID categoryId, UUID stationId, Boolean active, Boolean available, String search) {
    }

    public record ItemPage(List<ItemView> items, int page, int size, long total) {
    }

    public record AvailabilityRow(UUID id, String code, String name, String categoryName, boolean available) {
    }

    private final MenuItemRepository items;
    private final CategoryRepository categories;
    private final KitchenStationRepository stations;
    private final ModifierGroupRepository groups;
    private final AuditService audit;
    private final RmsProperties properties;
    private final Clock clock;

    @SuppressWarnings("java:S107")
    public MenuItemService(MenuItemRepository items, CategoryRepository categories, KitchenStationRepository stations,
                           ModifierGroupRepository groups, AuditService audit, RmsProperties properties, Clock clock) {
        this.clock = clock;
        this.items = items;
        this.categories = categories;
        this.stations = stations;
        this.groups = groups;
        this.audit = audit;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public ItemPage list(ItemFilter filter, int page, int size, String sort) {
        String field = "code";
        boolean desc = false;
        if (sort != null) {
            String[] parts = sort.split(",");
            if (!SORTABLE.contains(parts[0])) {
                throw ApiException.validation("sort", "Items can be sorted by code, name, localPrice or updatedAt");
            }
            field = parts[0];
            desc = "desc".equals(parts[1]);
        }
        List<MenuItem> all = new ArrayList<>(items.findAll(spec(filter)));
        Comparator<MenuItem> cmp = switch (field) {
            case "name" -> Comparator.comparing(i -> i.getName().toLowerCase(Locale.ROOT));
            case "localPrice" -> Comparator.comparing(MenuItem::localPrice);
            case "updatedAt" -> Comparator.comparing(MenuItem::getUpdatedAt);
            default -> Comparator.comparing(MenuItem::getCode);
        };
        cmp = cmp.thenComparing(MenuItem::getCode);
        all.sort(desc ? cmp.reversed() : cmp);
        int from = Math.min(page * size, all.size());
        List<MenuItem> slice = all.subList(from, Math.min(from + size, all.size()));
        return new ItemPage(views(slice), page, size, all.size());
    }

    @Transactional(readOnly = true)
    public ItemView get(UUID id) {
        return views(List.of(find(id))).get(0);
    }

    /** Active items of active categories, by category order then name: the sold-out board. */
    @Transactional(readOnly = true)
    public List<AvailabilityRow> availabilityRows() {
        Map<UUID, Category> cats = categories.findByBranchIdAndActiveTrue(properties.branchId()).stream()
                .collect(Collectors.toMap(Category::getId, c -> c));
        return items.findByBranchIdAndActiveTrue(properties.branchId()).stream()
                .filter(i -> cats.containsKey(i.getCategoryId()))
                .sorted(Comparator.comparingInt((MenuItem i) -> cats.get(i.getCategoryId()).getSortOrder())
                        .thenComparing(i -> i.getName().toLowerCase(Locale.ROOT)))
                .map(i -> new AvailabilityRow(i.getId(), i.getCode(), i.getName(), cats.get(i.getCategoryId()).getName(), i.isAvailable()))
                .toList();
    }

    // ------------------------------------------------------------------ writes

    @Transactional
    public ItemView create(ItemData d) {
        Resolved r = validate(d, null);
        MenuItem item = new MenuItem(properties.branchId(), d.code(), d.name().trim(), d.categoryId(), d.stationId(), d.active() == null || d.active());
        item.setPrices(r.local(), r.foreign());
        item.replaceModifierGroups(r.groupIds());
        items.saveAndFlush(item);
        ItemView view = views(List.of(item)).get(0);
        audit.record(AuditRecord.of(AuditAction.CREATE, "MENU_ITEM", item.getId()).after(snapshot(view)).build());
        return view;
    }

    @Transactional
    public ItemView update(UUID id, ItemData d, int expectedVersion) {
        MenuItem item = find(id);
        if (item.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("menu item");
        }
        Resolved r = validate(d, item);
        Map<String, Object> before = snapshot(views(List.of(item)).get(0));
        BigDecimal oldLocal = item.localPrice();
        BigDecimal oldForeign = item.foreignPrice();
        apply(item, d, r);
        items.saveAndFlush(item);
        ItemView view = views(List.of(item)).get(0);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "MENU_ITEM", id).before(before).after(snapshot(view)).build());
        auditPriceChange(item, oldLocal, oldForeign);
        return view;
    }

    /**
     * Sold out / available again (P1-MENU-06). Idempotent; audited only when the value changes. Written with a
     * plain UPDATE that does not touch the item's version (see MenuItemRepository.setAvailable).
     */
    @Transactional
    public AvailabilityRow setAvailability(UUID id, boolean available) {
        MenuItem item = find(id);
        if (item.isAvailable() != available) {
            items.setAvailable(id, available, Instant.now(clock));
            audit.record(AuditRecord.of(AuditAction.UPDATE, "MENU_ITEM", id)
                    .before(Map.of("available", !available)).after(Map.of("available", available)).build());
        }
        String categoryName = categories.findById(item.getCategoryId()).map(Category::getName).orElse("");
        return new AvailabilityRow(item.getId(), item.getCode(), item.getName(), categoryName, available);
    }

    @Transactional(readOnly = true)
    public boolean codeExists(String code) {
        return items.existsByBranchIdAndCode(properties.branchId(), code);
    }

    // ------------------------------------------------------------------ validation (shared with import)

    private record Resolved(BigDecimal local, BigDecimal foreign, List<UUID> groupIds) {
    }

    private Resolved validate(ItemData d, MenuItem existing) {
        List<FieldViolation> errors = new ArrayList<>();
        if (d.code() == null || !CODE.matcher(d.code()).matches()) {
            errors.add(new FieldViolation("code", "Code must be 1 to 20 capital letters, digits or dashes"));
        }
        if (d.name() == null || d.name().isBlank()) {
            errors.add(new FieldViolation("name", "Name is required"));
        }
        if (d.categoryId() == null || categories.findById(d.categoryId()).isEmpty()) {
            errors.add(new FieldViolation("categoryId", "Choose an existing category"));
        }
        KitchenStation station = d.stationId() == null ? null : stations.findById(d.stationId()).orElse(null);
        boolean unchangedStation = existing != null && d.stationId() != null && d.stationId().equals(existing.getStationId());
        if (station == null) {
            errors.add(new FieldViolation("stationId", "Choose the kitchen station that prepares this item"));
        } else if (!station.isActive() && !unchangedStation) {
            errors.add(new FieldViolation("stationId", "This kitchen station is switched off"));
        }
        BigDecimal local = null;
        BigDecimal foreign = null;
        try {
            local = Amounts.nonNegative(d.localPrice(), "localPrice", "Local price");
        } catch (ApiException e) {
            errors.addAll(e.getFieldErrors());
        }
        try {
            foreign = Amounts.nonNegativeOrNull(d.foreignPrice(), "foreignPrice", "Foreign price");
        } catch (ApiException e) {
            errors.addAll(e.getFieldErrors());
        }
        List<UUID> groupIds = d.modifierGroupIds() == null ? List.of() : d.modifierGroupIds().stream().distinct().toList();
        if (!groupIds.isEmpty()) {
            Set<UUID> found = groups.findAllById(groupIds).stream().map(ModifierGroup::getId).collect(Collectors.toSet());
            for (int i = 0; i < groupIds.size(); i++) {
                if (!found.contains(groupIds.get(i))) {
                    errors.add(new FieldViolation("modifierGroupIds[" + i + "]", "This modifier group does not exist"));
                }
            }
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
        if (d.code() != null) {
            boolean taken = existing == null
                    ? items.existsByBranchIdAndCode(properties.branchId(), d.code())
                    : items.existsByBranchIdAndCodeAndIdNot(properties.branchId(), d.code(), existing.getId());
            if (taken) {
                throw ApiException.conflict("ITEM_CODE_TAKEN", "Item code taken", "An item with code '" + d.code() + "' already exists.");
            }
        }
        return new Resolved(local, foreign, groupIds);
    }

    private static void apply(MenuItem item, ItemData d, Resolved r) {
        item.update(d.code(), d.name().trim(), d.categoryId(), d.stationId(), d.active() == null ? item.isActive() : d.active());
        item.setPrices(r.local(), r.foreign());
        item.replaceModifierGroups(r.groupIds());
    }

    private void auditPriceChange(MenuItem item, BigDecimal oldLocal, BigDecimal oldForeign) {
        if (oldLocal != null && oldLocal.compareTo(item.localPrice()) == 0 && sameAmount(oldForeign, item.foreignPrice())) {
            return;
        }
        audit.record(priceChange(item.getId(), oldLocal, oldForeign, item.localPrice(), item.foreignPrice()));
    }

    // ------------------------------------------------------------------ helpers

    private MenuItem find(UUID id) {
        return items.findById(id).orElseThrow(() -> ApiException.notFound("This menu item"));
    }

    private Specification<MenuItem> spec(ItemFilter f) {
        return (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("branchId"), properties.branchId()));
            if (f.categoryId() != null) {
                p.add(cb.equal(root.get("categoryId"), f.categoryId()));
            }
            if (f.stationId() != null) {
                p.add(cb.equal(root.get("stationId"), f.stationId()));
            }
            if (f.active() != null) {
                p.add(cb.equal(root.get("active"), f.active()));
            }
            if (f.available() != null) {
                p.add(cb.equal(root.get("available"), f.available()));
            }
            if (f.search() != null && !f.search().isBlank()) {
                String like = "%" + f.search().trim().toLowerCase(Locale.ROOT).replace("%", "\\%").replace("_", "\\_") + "%";
                p.add(cb.or(cb.like(cb.lower(root.get("code")), like, '\\'), cb.like(cb.lower(root.get("name")), like, '\\')));
            }
            return cb.and(p.toArray(Predicate[]::new));
        };
    }

    private List<ItemView> views(List<MenuItem> list) {
        Map<UUID, String> catNames = new HashMap<>();
        categories.findByBranchId(properties.branchId()).forEach(c -> catNames.put(c.getId(), c.getName()));
        Map<UUID, String> stationNames = new HashMap<>();
        stations.findByBranchIdOrderByNumber(properties.branchId()).forEach(s -> stationNames.put(s.getId(), s.getName()));
        Set<UUID> groupIds = new HashSet<>();
        list.forEach(i -> groupIds.addAll(i.getModifierGroupIds()));
        Map<UUID, String> groupNames = new HashMap<>();
        if (!groupIds.isEmpty()) {
            groups.findAllById(groupIds).forEach(g -> groupNames.put(g.getId(), g.getName()));
        }
        return list.stream().map(i -> new ItemView(i, catNames.getOrDefault(i.getCategoryId(), ""),
                stationNames.getOrDefault(i.getStationId(), ""),
                i.getModifierGroupIds().stream().map(g -> new GroupRef(g, groupNames.getOrDefault(g, ""))).toList())).toList();
    }

    private static Map<String, Object> snapshot(ItemView v) {
        MenuItem i = v.item();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", i.getCode());
        m.put("name", i.getName());
        m.put("category", v.categoryName());
        m.put("station", v.stationName());
        m.put("localPrice", plain(i.localPrice()));
        m.put("foreignPrice", plain(i.foreignPrice()));
        m.put("active", i.isActive());
        m.put("available", i.isAvailable());
        m.put("modifierGroups", v.groups().stream().map(GroupRef::name).toList());
        return m;
    }

    /** Audit snapshot built from maps of names loaded once (the import); same shape as the view snapshot. */
    static Map<String, Object> snapshot(MenuItem i, Map<UUID, String> categoryNames, Map<UUID, String> stationNames,
                                        Map<UUID, String> groupNames) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", i.getCode());
        m.put("name", i.getName());
        m.put("category", categoryNames.getOrDefault(i.getCategoryId(), ""));
        m.put("station", stationNames.getOrDefault(i.getStationId(), ""));
        m.put("localPrice", plain(i.localPrice()));
        m.put("foreignPrice", plain(i.foreignPrice()));
        m.put("active", i.isActive());
        m.put("available", i.isAvailable());
        m.put("modifierGroups", i.getModifierGroupIds().stream().map(g -> groupNames.getOrDefault(g, "")).toList());
        return m;
    }

    /** The PRICE_CHANGED audit record (shared with the import). */
    static AuditRecord priceChange(UUID itemId, BigDecimal oldLocal, BigDecimal oldForeign, BigDecimal newLocal, BigDecimal newForeign) {
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("localPrice", plain(oldLocal));
        before.put("foreignPrice", plain(oldForeign));
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("localPrice", plain(newLocal));
        after.put("foreignPrice", plain(newForeign));
        return AuditRecord.of(AuditAction.PRICE_CHANGED, "MENU_ITEM", itemId).before(before).after(after).build();
    }

    private static String plain(BigDecimal v) {
        return v == null ? null : v.toPlainString();
    }

    private static boolean sameAmount(BigDecimal a, BigDecimal b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }
}
