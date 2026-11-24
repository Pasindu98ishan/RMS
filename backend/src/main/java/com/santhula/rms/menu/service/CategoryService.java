package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.menu.domain.Category;
import com.santhula.rms.menu.repo.CategoryRepository;
import com.santhula.rms.menu.repo.MenuItemRepository;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Categories (P1-MENU-01). Never deleted, only deactivated; an inactive category hides its items from the POS. */
@Service
public class CategoryService {

    public record CategoryView(Category category, long itemCount) {
    }

    private final CategoryRepository categories;
    private final MenuItemRepository items;
    private final AuditService audit;
    private final RmsProperties properties;

    public CategoryService(CategoryRepository categories, MenuItemRepository items, AuditService audit, RmsProperties properties) {
        this.categories = categories;
        this.items = items;
        this.audit = audit;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<CategoryView> list() {
        Map<UUID, Long> counts = items.toMap(items.countByCategory(properties.branchId()));
        return categories.findByBranchId(properties.branchId()).stream()
                .sorted(Comparator.comparingInt(Category::getSortOrder).thenComparing(c -> c.getName().toLowerCase(Locale.ROOT)))
                .map(c -> new CategoryView(c, counts.getOrDefault(c.getId(), 0L))).toList();
    }

    @Transactional(readOnly = true)
    public CategoryView get(UUID id) {
        Category c = find(id);
        return new CategoryView(c, items.countByCategoryId(id));
    }

    @Transactional
    public CategoryView create(String name, Integer sortOrder, Boolean active) {
        String trimmed = name.trim();
        if (categories.existsByBranchIdAndNameIgnoreCase(properties.branchId(), trimmed)) {
            throw nameTaken(trimmed);
        }
        int order = sortOrder != null ? sortOrder : categories.maxSortOrder(properties.branchId()) + 10;
        Category c = new Category(properties.branchId(), trimmed, order, active == null || active);
        categories.saveAndFlush(c);
        audit.record(AuditRecord.of(AuditAction.CREATE, "CATEGORY", c.getId()).after(snapshot(c)).build());
        return new CategoryView(c, 0);
    }

    @Transactional
    public CategoryView update(UUID id, String name, int sortOrder, boolean active, int expectedVersion) {
        Category c = find(id);
        if (c.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("category");
        }
        String trimmed = name.trim();
        if (categories.existsByBranchIdAndNameIgnoreCaseAndIdNot(properties.branchId(), trimmed, id)) {
            throw nameTaken(trimmed);
        }
        Map<String, Object> before = snapshot(c);
        c.update(trimmed, sortOrder, active);
        categories.saveAndFlush(c);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "CATEGORY", id).before(before).after(snapshot(c)).build());
        return new CategoryView(c, items.countByCategoryId(id));
    }

    /** Lookup by name for the import and the dev seeder. */
    @Transactional(readOnly = true)
    public java.util.Optional<UUID> idByName(String name) {
        return categories.findByBranchIdAndNameIgnoreCase(properties.branchId(), name.trim()).map(Category::getId);
    }

    private Category find(UUID id) {
        return categories.findById(id).orElseThrow(() -> ApiException.notFound("This category"));
    }

    private static ApiException nameTaken(String name) {
        return ApiException.conflict("CATEGORY_NAME_TAKEN", "Category name taken", "A category called '" + name + "' already exists.");
    }

    static Map<String, Object> snapshot(Category c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", c.getName());
        m.put("sortOrder", c.getSortOrder());
        m.put("active", c.isActive());
        return m;
    }
}
