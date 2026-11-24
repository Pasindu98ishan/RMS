package com.santhula.rms.menu.service;

import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.menu.domain.Category;
import com.santhula.rms.menu.domain.MenuItem;
import com.santhula.rms.menu.domain.ModifierGroup;
import com.santhula.rms.menu.domain.ModifierOption;
import com.santhula.rms.menu.repo.CategoryRepository;
import com.santhula.rms.menu.repo.MenuItemRepository;
import com.santhula.rms.menu.repo.ModifierGroupRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The whole sellable menu in one read for the order screen (P1-ORD-03). Only active things are included. */
@Service
public class PosMenuService {

    public record PosOption(UUID id, String name, BigDecimal priceDelta) {
    }

    public record PosGroup(UUID id, String name, boolean required, int minSelect, int maxSelect, List<PosOption> options) {
    }

    public record PosItem(UUID id, String code, String name, UUID stationId, BigDecimal localPrice, BigDecimal foreignPrice,
                          boolean available, List<UUID> modifierGroupIds) {
    }

    public record PosCategory(UUID id, String name, int sortOrder, List<PosItem> items) {
    }

    public record PosMenu(Instant generatedAt, List<PosCategory> categories, List<PosGroup> modifierGroups,
                          List<KitchenStationService.StationInfo> kitchenStations) {
    }

    private final CategoryRepository categories;
    private final MenuItemRepository items;
    private final ModifierGroupRepository groups;
    private final KitchenStationService stations;
    private final RmsProperties properties;
    private final Clock clock;

    @SuppressWarnings("java:S107")
    public PosMenuService(CategoryRepository categories, MenuItemRepository items, ModifierGroupRepository groups,
                          KitchenStationService stations, RmsProperties properties, Clock clock) {
        this.categories = categories;
        this.items = items;
        this.groups = groups;
        this.stations = stations;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PosMenu menu() {
        List<ModifierGroup> activeGroups = groups.findByBranchIdAndActiveTrue(properties.branchId()).stream()
                .sorted(Comparator.comparing(g -> g.getName().toLowerCase(Locale.ROOT))).toList();
        java.util.Set<UUID> activeGroupIds = activeGroups.stream().map(ModifierGroup::getId).collect(Collectors.toSet());

        Map<UUID, List<MenuItem>> byCategory = items.findByBranchIdAndActiveTrue(properties.branchId()).stream()
                .collect(Collectors.groupingBy(MenuItem::getCategoryId));
        List<PosCategory> cats = categories.findByBranchIdAndActiveTrue(properties.branchId()).stream()
                .sorted(Comparator.comparingInt(Category::getSortOrder).thenComparing(c -> c.getName().toLowerCase(Locale.ROOT)))
                .map(c -> new PosCategory(c.getId(), c.getName(), c.getSortOrder(),
                        byCategory.getOrDefault(c.getId(), List.of()).stream()
                                .sorted(Comparator.comparing(i -> i.getName().toLowerCase(Locale.ROOT)))
                                .map(i -> new PosItem(i.getId(), i.getCode(), i.getName(), i.getStationId(), i.localPrice(), i.foreignPrice(),
                                        i.isAvailable(), i.getModifierGroupIds().stream().filter(activeGroupIds::contains).toList()))
                                .toList()))
                .toList();
        List<PosGroup> posGroups = activeGroups.stream()
                .map(g -> new PosGroup(g.getId(), g.getName(), g.isRequired(), g.getMinSelect(), g.getMaxSelect(),
                        g.getOptions().stream().sorted(Comparator.comparingInt(ModifierOption::getSortOrder))
                                .map(o -> new PosOption(o.getId(), o.getName(), o.getPriceDelta())).toList()))
                .toList();
        return new PosMenu(Instant.now(clock), cats, posGroups, stations.activeStations());
    }
}
