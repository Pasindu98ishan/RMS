package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.common.validation.Amounts;
import com.santhula.rms.menu.domain.ModifierGroup;
import com.santhula.rms.menu.domain.ModifierOption;
import com.santhula.rms.menu.repo.MenuItemRepository;
import com.santhula.rms.menu.repo.ModifierGroupRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Modifier groups and their options (P1-MENU-03). Never deleted, only deactivated. */
@Service
public class ModifierGroupService {

    /** An option as sent by the client; {@code id} is set for an existing option that is kept. */
    public record OptionData(UUID id, String name, BigDecimal priceDelta) {
    }

    public record GroupData(String name, boolean required, int minSelect, int maxSelect, boolean active, List<OptionData> options) {
    }

    public record GroupView(ModifierGroup group, long itemCount) {
    }

    public enum UpsertResult { CREATED, UPDATED, UNCHANGED }

    private final ModifierGroupRepository groups;
    private final MenuItemRepository items;
    private final AuditService audit;
    private final RmsProperties properties;

    public ModifierGroupService(ModifierGroupRepository groups, MenuItemRepository items, AuditService audit, RmsProperties properties) {
        this.groups = groups;
        this.items = items;
        this.audit = audit;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<GroupView> list() {
        Map<UUID, Long> counts = items.toMap(items.countByModifierGroup(properties.branchId()));
        return groups.findByBranchId(properties.branchId()).stream()
                .sorted(java.util.Comparator.comparing(g -> g.getName().toLowerCase(Locale.ROOT)))
                .map(g -> new GroupView(g, counts.getOrDefault(g.getId(), 0L))).toList();
    }

    @Transactional(readOnly = true)
    public GroupView get(UUID id) {
        ModifierGroup g = find(id);
        return new GroupView(g, items.countUsingGroup(id));
    }

    @Transactional
    public GroupView create(GroupData data) {
        List<FieldViolation> errors = validate(data, null);
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
        String name = data.name().trim();
        if (groups.existsByBranchIdAndNameIgnoreCase(properties.branchId(), name)) {
            throw nameTaken(name);
        }
        ModifierGroup g = new ModifierGroup(properties.branchId(), name, data.required(), data.minSelect(), data.maxSelect(), data.active());
        int order = 0;
        for (OptionData o : data.options()) {
            g.getOptions().add(new ModifierOption(o.name().trim(), Amounts.nonNegative(o.priceDelta(), "options", "Price"), order++));
        }
        groups.saveAndFlush(g);
        audit.record(AuditRecord.of(AuditAction.CREATE, "MODIFIER_GROUP", g.getId()).after(snapshot(g)).build());
        return new GroupView(g, 0);
    }

    @Transactional
    public GroupView update(UUID id, GroupData data, int expectedVersion) {
        ModifierGroup g = find(id);
        if (g.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("modifier group");
        }
        List<FieldViolation> errors = validate(data, g);
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
        String name = data.name().trim();
        if (groups.existsByBranchIdAndNameIgnoreCaseAndIdNot(properties.branchId(), name, id)) {
            throw nameTaken(name);
        }
        Map<String, Object> before = snapshot(g);
        applyTo(g, data);
        groups.saveAndFlush(g);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "MODIFIER_GROUP", id).before(before).after(snapshot(g)).build());
        return new GroupView(g, items.countUsingGroup(id));
    }

    /**
     * Import: matches by name and replaces required / min / max and the options (matched by option name, so
     * option ids are kept). Active is kept. Returns what changed.
     */
    @Transactional
    public UpsertResult importGroup(String name, boolean required, int minSelect, int maxSelect, List<OptionData> options) {
        ModifierGroup existing = groups.findByBranchIdAndNameIgnoreCase(properties.branchId(), name.trim()).orElse(null);
        if (existing == null) {
            create(new GroupData(name, required, minSelect, maxSelect, true, options));
            return UpsertResult.CREATED;
        }
        Map<String, UUID> idByName = new HashMap<>();
        existing.getOptions().forEach(o -> idByName.put(o.getName().toLowerCase(Locale.ROOT), o.getId()));
        List<OptionData> withIds = options.stream()
                .map(o -> new OptionData(idByName.get(o.name().trim().toLowerCase(Locale.ROOT)), o.name(), o.priceDelta())).toList();
        GroupData data = new GroupData(existing.getName(), required, minSelect, maxSelect, existing.isActive(), withIds);
        if (snapshotOf(data).equals(snapshot(existing))) {
            return UpsertResult.UNCHANGED;
        }
        update(existing.getId(), data, existing.getVersion());
        return UpsertResult.UPDATED;
    }

    @Transactional(readOnly = true)
    public java.util.Optional<UUID> idByName(String name) {
        return groups.findByBranchIdAndNameIgnoreCase(properties.branchId(), name.trim()).map(ModifierGroup::getId);
    }

    @Transactional(readOnly = true)
    public Map<UUID, String> namesById(java.util.Collection<UUID> ids) {
        Map<UUID, String> m = new HashMap<>();
        groups.findAllById(ids).forEach(g -> m.put(g.getId(), g.getName()));
        return m;
    }

    /** Which of the given ids are existing groups. */
    @Transactional(readOnly = true)
    public Set<UUID> existingIds(java.util.Collection<UUID> ids) {
        Set<UUID> found = new HashSet<>();
        groups.findAllById(ids).forEach(g -> found.add(g.getId()));
        return found;
    }

    // ------------------------------------------------------------------ rules

    /** Field errors for a group definition (create, update and import share them). */
    static List<FieldViolation> validate(GroupData d, ModifierGroup existing) {
        List<FieldViolation> errors = new ArrayList<>();
        if (d.required() && d.minSelect() < 1) {
            errors.add(new FieldViolation("minSelect", "A required group must allow at least 1 choice"));
        }
        if (!d.required() && d.minSelect() != 0) {
            errors.add(new FieldViolation("minSelect", "An optional group must have a minimum of 0"));
        }
        if (d.maxSelect() < Math.max(d.minSelect(), 1)) {
            errors.add(new FieldViolation("maxSelect", "The maximum must be at least the minimum (and at least 1)"));
        }
        if (d.options() == null || d.options().isEmpty()) {
            errors.add(new FieldViolation("options", "Add at least one option"));
            return errors;
        }
        if (d.maxSelect() > d.options().size()) {
            errors.add(new FieldViolation("maxSelect", "The maximum cannot be more than the number of options"));
        }
        Set<UUID> known = new HashSet<>();
        if (existing != null) {
            existing.getOptions().forEach(o -> known.add(o.getId()));
        }
        Set<String> names = new HashSet<>();
        Set<UUID> usedIds = new HashSet<>();
        for (int i = 0; i < d.options().size(); i++) {
            OptionData o = d.options().get(i);
            if (o.name() == null || o.name().isBlank()) {
                errors.add(new FieldViolation("options[" + i + "].name", "Option name is required"));
            } else if (!names.add(o.name().trim().toLowerCase(Locale.ROOT))) {
                errors.add(new FieldViolation("options[" + i + "].name", "This option name is used twice in the group"));
            }
            if (o.priceDelta() == null) {
                errors.add(new FieldViolation("options[" + i + "].priceDelta", "Price is required"));
            } else if (o.priceDelta().signum() < 0) {
                errors.add(new FieldViolation("options[" + i + "].priceDelta", "Price cannot be negative"));
            }
            if (o.id() != null && (!known.contains(o.id()) || !usedIds.add(o.id()))) {
                errors.add(new FieldViolation("options[" + i + "].id", "This option does not belong to the group"));
            }
        }
        return errors;
    }

    private static void applyTo(ModifierGroup g, GroupData data) {
        g.update(data.name().trim(), data.required(), data.minSelect(), data.maxSelect(), data.active());
        Map<UUID, ModifierOption> byId = new HashMap<>();
        g.getOptions().forEach(o -> byId.put(o.getId(), o));
        List<ModifierOption> next = new ArrayList<>();
        int order = 0;
        for (OptionData o : data.options()) {
            BigDecimal price = Amounts.nonNegative(o.priceDelta(), "options", "Price");
            ModifierOption option = o.id() == null ? null : byId.get(o.id());
            if (option == null) {
                option = new ModifierOption(o.name().trim(), price, order);
            } else {
                option.update(o.name().trim(), price, order);
            }
            next.add(option);
            order++;
        }
        g.getOptions().clear();
        g.getOptions().addAll(next);
    }

    private ModifierGroup find(UUID id) {
        return groups.findById(id).orElseThrow(() -> ApiException.notFound("This modifier group"));
    }

    private static ApiException nameTaken(String name) {
        return ApiException.conflict("MODIFIER_GROUP_NAME_TAKEN", "Group name taken", "A modifier group called '" + name + "' already exists.");
    }

    private static Map<String, Object> snapshot(ModifierGroup g) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", g.getName());
        m.put("required", g.isRequired());
        m.put("minSelect", g.getMinSelect());
        m.put("maxSelect", g.getMaxSelect());
        m.put("active", g.isActive());
        List<Map<String, Object>> options = new ArrayList<>();
        for (ModifierOption o : g.getOptions()) {
            options.add(Map.of("name", o.getName(), "priceDelta", o.getPriceDelta().toPlainString()));
        }
        m.put("options", options);
        return m;
    }

    private static Map<String, Object> snapshotOf(GroupData d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", d.name().trim());
        m.put("required", d.required());
        m.put("minSelect", d.minSelect());
        m.put("maxSelect", d.maxSelect());
        m.put("active", d.active());
        List<Map<String, Object>> options = new ArrayList<>();
        for (OptionData o : d.options()) {
            options.add(Map.of("name", o.name().trim(), "priceDelta", o.priceDelta().setScale(2).toPlainString()));
        }
        m.put("options", options);
        return m;
    }
}
