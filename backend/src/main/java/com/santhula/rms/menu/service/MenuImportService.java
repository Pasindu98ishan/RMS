package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.domain.ImportCounts;
import com.santhula.rms.common.domain.ImportRowError;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.menu.domain.Category;
import com.santhula.rms.menu.domain.KitchenStation;
import com.santhula.rms.menu.domain.MenuItem;
import com.santhula.rms.menu.domain.ModifierGroup;
import com.santhula.rms.menu.repo.CategoryRepository;
import com.santhula.rms.menu.repo.KitchenStationRepository;
import com.santhula.rms.menu.repo.MenuItemRepository;
import com.santhula.rms.menu.repo.ModifierGroupRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Domain side of the categories, menu items and modifier groups imports (P1-IMP-01). The file module reads
 * and type-checks the cells and hands over the rows; a cell that could not be read is null here (its error is
 * already reported) and the checks skip it. For each type there are two steps: {@code validate*} checks the
 * rows against each other and against the existing data without saving anything, and {@code import*} applies
 * them once there is no error at all.
 *
 * <p>Speed (BUG-1-008): the lookup data (categories, stations, groups, existing items) is loaded ONCE into
 * maps, nothing is queried or flushed per row, new rows are inserted in JDBC batches and everything is
 * flushed once at the end, so the time grows in proportion to the number of rows. A dry run computes the same
 * counts without writing anything.
 */
@Service
public class MenuImportService {

    /** One parsed row of the categories file (header = row 1). {@code sortOrder} is null when the cell is empty. */
    public record CategoryRow(int row, String name, Integer sortOrder) {
    }

    /** One parsed row of the menu items file. {@code foreignPrice} and {@code active} are null when empty. */
    public record ItemRow(int row, String code, String name, String category, Integer station, BigDecimal localPrice,
                          BigDecimal foreignPrice, List<String> modifierGroups, Boolean active) {
    }

    /** One parsed row of the modifier groups file: one option of a group. */
    public record GroupRow(int row, String group, Boolean required, Integer minSelect, Integer maxSelect, String option, BigDecimal priceDelta) {
    }

    private final CategoryRepository categories;
    private final MenuItemRepository items;
    private final KitchenStationRepository stations;
    private final ModifierGroupRepository groupRepository;
    private final ModifierGroupService groups;
    private final AuditService audit;
    private final RmsProperties properties;

    @SuppressWarnings("java:S107")
    public MenuImportService(CategoryRepository categories, MenuItemRepository items, KitchenStationRepository stations,
                             ModifierGroupRepository groupRepository, ModifierGroupService groups, AuditService audit,
                             RmsProperties properties) {
        this.categories = categories;
        this.items = items;
        this.stations = stations;
        this.groupRepository = groupRepository;
        this.groups = groups;
        this.audit = audit;
        this.properties = properties;
    }

    private static String key(String s) {
        return s.trim().toLowerCase(Locale.ROOT);
    }

    // ------------------------------------------------------------------ categories

    public List<ImportRowError> validateCategories(List<CategoryRow> rows) {
        List<ImportRowError> errors = new ArrayList<>();
        Map<String, Integer> firstSeen = new HashMap<>();
        for (CategoryRow r : rows) {
            if (r.name() != null) {
                if (r.name().length() > 50) {
                    errors.add(ImportRowError.cell(r.row(), "name", r.name(), "must be at most 50 characters"));
                }
                Integer first = firstSeen.putIfAbsent(key(r.name()), r.row());
                if (first != null) {
                    errors.add(ImportRowError.cell(r.row(), "name", r.name(), "duplicate category (first on row " + first + ")"));
                }
            }
            if (r.sortOrder() != null && r.sortOrder() < 0) {
                errors.add(ImportRowError.cell(r.row(), "sort_order", String.valueOf(r.sortOrder()), "cannot be negative"));
            }
        }
        return errors;
    }

    public ImportCounts importCategories(List<CategoryRow> rows) {
        return importCategories(rows, false);
    }

    /** Matches by name; the sort order only changes when the file gives one; active is kept. */
    @Transactional
    public ImportCounts importCategories(List<CategoryRow> rows, boolean dryRun) {
        UUID branch = properties.branchId();
        Map<String, Category> existing = new HashMap<>();
        int highest = 0;
        for (Category c : categories.findByBranchId(branch)) {
            existing.put(key(c.getName()), c);
            highest = Math.max(highest, c.getSortOrder());
        }
        ImportCounts counts = ImportCounts.NONE;
        List<AuditRecord> audits = new ArrayList<>();
        for (CategoryRow r : rows) {
            Category c = existing.get(key(r.name()));
            if (c == null) {
                int order = r.sortOrder() != null ? r.sortOrder() : highest + 10;
                highest = Math.max(highest, order);
                Category created = new Category(branch, r.name().trim(), order, true);
                existing.put(key(r.name()), created);
                counts = counts.addCreated();
                if (!dryRun) {
                    categories.save(created);
                    audits.add(AuditRecord.of(AuditAction.CREATE, "CATEGORY", created.getId()).after(CategoryService.snapshot(created)).build());
                }
            } else if (r.sortOrder() == null || r.sortOrder() == c.getSortOrder()) {
                counts = counts.addUnchanged();
            } else {
                counts = counts.addUpdated();
                if (!dryRun) {
                    Map<String, Object> before = CategoryService.snapshot(c);
                    c.update(c.getName(), r.sortOrder(), c.isActive());
                    audits.add(AuditRecord.of(AuditAction.UPDATE, "CATEGORY", c.getId()).before(before).after(CategoryService.snapshot(c)).build());
                }
            }
        }
        finish(dryRun, audits, () -> categories.flush());
        return counts;
    }

    // ------------------------------------------------------------------ menu items

    /** The lookup data every item row is checked against, loaded once. */
    private record Lookups(Map<String, Category> categories, Map<Integer, KitchenStation> stations, Map<String, ModifierGroup> groups) {
    }

    private Lookups lookups() {
        UUID branch = properties.branchId();
        Map<String, Category> cats = new HashMap<>();
        categories.findByBranchId(branch).forEach(c -> cats.put(key(c.getName()), c));
        Map<Integer, KitchenStation> sts = new HashMap<>();
        stations.findByBranchIdOrderByNumber(branch).forEach(s -> sts.put(s.getNumber(), s));
        Map<String, ModifierGroup> grps = new HashMap<>();
        groupRepository.findByBranchId(branch).forEach(g -> grps.put(key(g.getName()), g));
        return new Lookups(cats, sts, grps);
    }

    public List<ImportRowError> validateItems(List<ItemRow> rows) {
        List<ImportRowError> errors = new ArrayList<>();
        Lookups lookups = lookups();
        Map<String, Integer> firstSeen = new HashMap<>();
        for (ItemRow r : rows) {
            if (r.code() != null) {
                if (!MenuItemService.CODE.matcher(r.code()).matches()) {
                    errors.add(ImportRowError.cell(r.row(), "code", r.code(), "must be 1 to 20 capital letters, digits or dashes"));
                }
                Integer first = firstSeen.putIfAbsent(r.code(), r.row());
                if (first != null) {
                    errors.add(ImportRowError.cell(r.row(), "code", r.code(), "duplicate code (first on row " + first + ")"));
                }
            }
            if (r.name() != null && r.name().length() > 100) {
                errors.add(ImportRowError.cell(r.row(), "name", r.name(), "must be at most 100 characters"));
            }
            if (r.category() != null && !lookups.categories().containsKey(key(r.category()))) {
                errors.add(ImportRowError.cell(r.row(), "category", r.category(), "unknown category '" + r.category() + "'"));
            }
            if (r.station() != null) {
                KitchenStation station = lookups.stations().get(r.station());
                if (station == null) {
                    errors.add(ImportRowError.cell(r.row(), "station", String.valueOf(r.station()), "unknown kitchen station " + r.station() + " (use 1 to 3)"));
                } else if (!station.isActive()) {
                    errors.add(ImportRowError.cell(r.row(), "station", String.valueOf(r.station()), "kitchen station " + r.station() + " is switched off"));
                }
            }
            if (r.localPrice() != null && r.localPrice().signum() < 0) {
                errors.add(ImportRowError.cell(r.row(), "local_price", r.localPrice().toPlainString(), "cannot be negative"));
            }
            if (r.foreignPrice() != null && r.foreignPrice().signum() < 0) {
                errors.add(ImportRowError.cell(r.row(), "foreign_price", r.foreignPrice().toPlainString(), "cannot be negative"));
            }
            for (String g : r.modifierGroups()) {
                if (!lookups.groups().containsKey(key(g))) {
                    errors.add(ImportRowError.cell(r.row(), "modifier_groups", g, "unknown modifier group '" + g + "'"));
                }
            }
        }
        return errors;
    }

    public ImportCounts importItems(List<ItemRow> rows) {
        return importItems(rows, false);
    }

    /**
     * Matches by code. Creates, updates (auditing price changes) or finds the item unchanged. Rows are known to
     * be valid here (validateItems found nothing), so the category, station and groups they name exist.
     */
    @Transactional
    public ImportCounts importItems(List<ItemRow> rows, boolean dryRun) {
        UUID branch = properties.branchId();
        Lookups lookups = lookups();
        Map<UUID, String> categoryNames = new HashMap<>();
        lookups.categories().values().forEach(c -> categoryNames.put(c.getId(), c.getName()));
        Map<UUID, String> stationNames = new HashMap<>();
        lookups.stations().values().forEach(s -> stationNames.put(s.getId(), s.getName()));
        Map<UUID, String> groupNames = new HashMap<>();
        lookups.groups().values().forEach(g -> groupNames.put(g.getId(), g.getName()));
        Map<String, MenuItem> existing = new HashMap<>();
        items.findByBranchId(branch).forEach(i -> existing.put(i.getCode(), i));

        ImportCounts counts = ImportCounts.NONE;
        List<AuditRecord> audits = new ArrayList<>();
        for (ItemRow r : rows) {
            UUID categoryId = lookups.categories().get(key(r.category())).getId();
            UUID stationId = lookups.stations().get(r.station()).getId();
            List<UUID> groupIds = r.modifierGroups().stream().map(g -> lookups.groups().get(key(g)).getId()).distinct().toList();
            BigDecimal local = r.localPrice().setScale(2);
            BigDecimal foreign = r.foreignPrice() == null ? null : r.foreignPrice().setScale(2);
            MenuItem item = existing.get(r.code());

            if (item == null) {
                MenuItem created = new MenuItem(branch, r.code(), r.name().trim(), categoryId, stationId, r.active() == null || r.active());
                created.setPrices(local, foreign);
                created.replaceModifierGroups(groupIds);
                existing.put(r.code(), created);
                counts = counts.addCreated();
                if (!dryRun) {
                    items.save(created);
                    audits.add(AuditRecord.of(AuditAction.CREATE, "MENU_ITEM", created.getId())
                            .after(MenuItemService.snapshot(created, categoryNames, stationNames, groupNames)).build());
                }
                continue;
            }
            boolean active = r.active() == null ? item.isActive() : r.active();
            boolean same = item.getName().equals(r.name().trim()) && item.getCategoryId().equals(categoryId) && item.getStationId().equals(stationId)
                    && item.isActive() == active && item.localPrice().compareTo(local) == 0 && sameAmount(item.foreignPrice(), foreign)
                    && item.getModifierGroupIds().equals(groupIds);
            if (same) {
                counts = counts.addUnchanged();
                continue;
            }
            counts = counts.addUpdated();
            if (!dryRun) {
                Map<String, Object> before = MenuItemService.snapshot(item, categoryNames, stationNames, groupNames);
                BigDecimal oldLocal = item.localPrice();
                BigDecimal oldForeign = item.foreignPrice();
                item.update(item.getCode(), r.name().trim(), categoryId, stationId, active);
                item.setPrices(local, foreign);
                item.replaceModifierGroups(groupIds);
                audits.add(AuditRecord.of(AuditAction.UPDATE, "MENU_ITEM", item.getId()).before(before)
                        .after(MenuItemService.snapshot(item, categoryNames, stationNames, groupNames)).build());
                if (oldLocal.compareTo(local) != 0 || !sameAmount(oldForeign, foreign)) {
                    audits.add(MenuItemService.priceChange(item.getId(), oldLocal, oldForeign, local, foreign));
                }
            }
        }
        finish(dryRun, audits, () -> items.flush());
        return counts;
    }

    private static boolean sameAmount(BigDecimal a, BigDecimal b) {
        return a == null ? b == null : b != null && a.compareTo(b) == 0;
    }

    // ------------------------------------------------------------------ modifier groups

    public List<ImportRowError> validateGroups(List<GroupRow> rows) {
        List<ImportRowError> errors = new ArrayList<>();
        Map<String, List<GroupRow>> byGroup = new LinkedHashMap<>();
        for (GroupRow r : rows) {
            if (r.group() != null) {
                byGroup.computeIfAbsent(key(r.group()), k -> new ArrayList<>()).add(r);
            }
        }
        for (List<GroupRow> g : byGroup.values()) {
            if (g.stream().anyMatch(r -> r.required() == null || r.minSelect() == null || r.maxSelect() == null || r.option() == null)) {
                continue;   // a cell of this group could not be read: that error is already reported
            }
            GroupRow first = g.get(0);
            if (first.group().length() > 50) {
                errors.add(ImportRowError.cell(first.row(), "group", first.group(), "must be at most 50 characters"));
            }
            List<ModifierGroupService.OptionData> options = new ArrayList<>();
            for (GroupRow r : g) {
                if (!r.required().equals(first.required()) || !r.minSelect().equals(first.minSelect()) || !r.maxSelect().equals(first.maxSelect())) {
                    errors.add(ImportRowError.row(r.row(), "required, min_select and max_select must be the same on every row of group '"
                            + first.group() + "' (first on row " + first.row() + ")"));
                }
                if (r.option().length() > 50) {
                    errors.add(ImportRowError.cell(r.row(), "option", r.option(), "must be at most 50 characters"));
                }
                options.add(new ModifierGroupService.OptionData(null, r.option(), r.priceDelta()));
            }
            // The same rules as the editor, reported against the first row of the group.
            var data = new ModifierGroupService.GroupData(first.group(), first.required(), first.minSelect(), first.maxSelect(), true, options);
            for (FieldViolation v : ModifierGroupService.validate(data, null)) {
                errors.add(toImportError(v, g));
            }
        }
        return errors;
    }

    public ImportCounts importGroups(List<GroupRow> rows) {
        return importGroups(rows, false);
    }

    /** Groups are few, so each goes through the group service; a dry run is rolled back by the caller. */
    @Transactional
    public ImportCounts importGroups(List<GroupRow> rows, boolean dryRun) {
        Map<String, List<GroupRow>> byGroup = new LinkedHashMap<>();
        for (GroupRow r : rows) {
            byGroup.computeIfAbsent(key(r.group()), k -> new ArrayList<>()).add(r);
        }
        ImportCounts counts = ImportCounts.NONE;
        for (List<GroupRow> g : byGroup.values()) {
            GroupRow first = g.get(0);
            List<ModifierGroupService.OptionData> options = g.stream()
                    .map(r -> new ModifierGroupService.OptionData(null, r.option(), r.priceDelta())).toList();
            counts = switch (groups.importGroup(first.group(), first.required(), first.minSelect(), first.maxSelect(), options)) {
                case CREATED -> counts.addCreated();
                case UPDATED -> counts.addUpdated();
                case UNCHANGED -> counts.addUnchanged();
            };
        }
        return counts;
    }

    /** Maps a field rule of the editor to the import column and row it came from. */
    private static ImportRowError toImportError(FieldViolation v, List<GroupRow> rows) {
        GroupRow first = rows.get(0);
        String field = v.field();
        if (field.startsWith("options[")) {
            int index = Integer.parseInt(field.substring(8, field.indexOf(']')));
            GroupRow r = rows.get(index);
            String column = field.endsWith("priceDelta") ? "price_delta" : "option";
            String value = column.equals("option") ? r.option() : String.valueOf(r.priceDelta());
            return ImportRowError.cell(r.row(), column, value, v.message());
        }
        return switch (field) {
            case "minSelect" -> ImportRowError.cell(first.row(), "min_select", String.valueOf(first.minSelect()), v.message());
            case "maxSelect" -> ImportRowError.cell(first.row(), "max_select", String.valueOf(first.maxSelect()), v.message());
            default -> ImportRowError.row(first.row(), v.message());
        };
    }

    // ------------------------------------------------------------------ helpers

    /** One flush (JDBC batches) and one batch of audit rows for the whole import; a dry run writes nothing. */
    private void finish(boolean dryRun, List<AuditRecord> audits, Runnable flush) {
        if (dryRun) {
            return;
        }
        flush.run();
        audit.recordAll(audits);
    }
}
