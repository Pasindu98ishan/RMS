package com.santhula.rms.devseed;

import com.santhula.rms.common.domain.ImportCounts;
import com.santhula.rms.common.domain.ImportRowError;
import com.santhula.rms.floor.service.FloorImportService;
import com.santhula.rms.floor.service.FloorService;
import com.santhula.rms.menu.service.CategoryService;
import com.santhula.rms.menu.service.KitchenStationService;
import com.santhula.rms.menu.service.MenuImportService;
import com.santhula.rms.menu.service.MenuItemService;
import com.santhula.rms.menu.service.ModifierGroupService;
import com.santhula.rms.settings.service.DeliveryAreaService;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Loads the sample restaurant of {@link DevSampleData} (docs/requirements/m1.1-scope.md). Spring profile
 * {@code dev} ONLY: the class is not a bean in any other profile (DevSampleDataAbsentIT). It only ever
 * CREATES what is missing and never changes what exists, so a developer's own edits (a new price, a renamed
 * station) survive a restart and running it twice creates nothing the second time. It goes through the same
 * services and validation as the import screen and logs what it did.
 */
@Component
@Profile("dev")
@Order(30)
public class DevSampleDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevSampleDataSeeder.class);

    private final KitchenStationService stations;
    private final CategoryService categories;
    private final ModifierGroupService groups;
    private final MenuItemService items;
    private final MenuImportService menuImport;
    private final FloorService floor;
    private final FloorImportService floorImport;
    private final DeliveryAreaService deliveryAreas;

    @SuppressWarnings("java:S107")
    public DevSampleDataSeeder(KitchenStationService stations, CategoryService categories, ModifierGroupService groups,
                               MenuItemService items, MenuImportService menuImport, FloorService floor,
                               FloorImportService floorImport, DeliveryAreaService deliveryAreas) {
        this.stations = stations;
        this.categories = categories;
        this.groups = groups;
        this.items = items;
        this.menuImport = menuImport;
        this.floor = floor;
        this.floorImport = floorImport;
        this.deliveryAreas = deliveryAreas;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int stationsRenamed = nameStations();
        ImportCounts cat = seed("categories", DevSampleData.categories().stream()
                .filter(r -> categories.idByName(r.name()).isEmpty()).toList(), menuImport::validateCategories, menuImport::importCategories);
        ImportCounts grp = seed("modifier groups", DevSampleData.groups().stream()
                .filter(r -> groups.idByName(r.group()).isEmpty()).toList(), menuImport::validateGroups, menuImport::importGroups);
        ImportCounts itm = seed("menu items", DevSampleData.items().stream()
                .filter(r -> !items.codeExists(r.code())).toList(), menuImport::validateItems, menuImport::importItems);
        ImportCounts tbl = seed("tables", DevSampleData.tables().stream()
                .filter(r -> !floor.numberExists(r.number())).toList(), floorImport::validate, floorImport::apply);
        int areas = seedDeliveryAreas();
        log.info("Dev sample data: {} station(s) named, {} categories, {} modifier groups, {} menu items, {} tables, {} delivery areas created "
                        + "(existing records are never changed)", stationsRenamed, cat.created(), grp.created(), itm.created(), tbl.created(), areas);
    }

    /** Gives a station the demo name only while it still has its factory name, so a developer's rename is kept. */
    private int nameStations() {
        int changed = 0;
        for (DevSampleData.StationSample sample : DevSampleData.stations()) {
            if (stations.renameIfFactoryName(sample.number(), sample.defaultName(), sample.name(), sample.targetPrepMinutes())) {
                changed++;
            }
        }
        return changed;
    }

    private int seedDeliveryAreas() {
        int created = 0;
        for (DevSampleData.AreaSample a : DevSampleData.deliveryAreas()) {
            if (!deliveryAreas.nameExists(a.name())) {
                deliveryAreas.create(a.name(), new BigDecimal(a.fee()), true);
                created++;
            }
        }
        return created;
    }

    private <R> ImportCounts seed(String what, List<R> rows, java.util.function.Function<List<R>, List<ImportRowError>> validate,
                                  java.util.function.Function<List<R>, ImportCounts> apply) {
        if (rows.isEmpty()) {
            return ImportCounts.NONE;
        }
        List<ImportRowError> errors = new ArrayList<>(validate.apply(rows));
        if (!errors.isEmpty()) {
            String detail = errors.stream().map(e -> "row " + e.row() + " " + e.column() + ": " + e.message()).collect(Collectors.joining("; "));
            log.error("Dev sample data: the {} could not be loaded: {}", what, detail);
            return ImportCounts.NONE;
        }
        return apply.apply(rows);
    }
}
