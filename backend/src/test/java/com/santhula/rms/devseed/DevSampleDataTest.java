package com.santhula.rms.devseed;

import static org.assertj.core.api.Assertions.assertThat;

import com.santhula.rms.menu.service.MenuImportService.GroupRow;
import com.santhula.rms.menu.service.MenuImportService.ItemRow;
import com.santhula.rms.menu.service.MenuItemService;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;

/** The dev sample restaurant matches docs/requirements/m1.1-scope.md and is internally consistent. */
class DevSampleDataTest {

    @Test
    void onlyInTheDevProfile() {
        assertThat(DevSampleDataSeeder.class.getAnnotation(Profile.class).value()).containsExactly("dev");
    }

    @Test
    void sixCategories_threeStations_threeGroups_twelveTables_threeAreas() {
        assertThat(DevSampleData.categories()).extracting(c -> c.name())
                .containsExactly("Rice & Curry", "Short Eats", "Grill", "Beverages", "Desserts", "Liquor");
        assertThat(DevSampleData.stations()).extracting(s -> s.targetPrepMinutes()).containsExactly(15, 20, 8);
        assertThat(DevSampleData.groups().stream().map(GroupRow::group).distinct().toList()).containsExactly("Spice level", "Extras", "Size");
        assertThat(DevSampleData.tables()).hasSize(12);
        assertThat(DevSampleData.tables().stream().filter(t -> t.section().equals("Indoor")).map(t -> t.number()).toList())
                .containsExactly("1", "2", "3", "4", "5", "6", "7", "8");
        assertThat(DevSampleData.tables().stream().filter(t -> t.section().equals("Garden")).map(t -> t.number()).toList())
                .containsExactly("G1", "G2", "G3", "G4");
        assertThat(DevSampleData.deliveryAreas()).extracting(a -> a.name() + " " + a.fee())
                .containsExactly("Netolpitiya 150.00", "Nearby 300.00", "Far 500.00");
    }

    @Test
    void aboutFortyItemsAcrossThreeStations_aboutTwentyFiveWithAForeignPrice() {
        List<ItemRow> items = DevSampleData.items();
        assertThat(items.size()).isBetween(40, 50);
        assertThat(items.stream().filter(i -> i.foreignPrice() != null).count()).isBetween(20L, 30L);
        assertThat(items.stream().map(ItemRow::station).collect(Collectors.toSet())).containsExactlyInAnyOrder(1, 2, 3);
    }

    @Test
    void groupRules_matchTheScope() {
        List<GroupRow> groups = DevSampleData.groups();
        GroupRow spice = groups.stream().filter(g -> g.group().equals("Spice level")).findFirst().orElseThrow();
        GroupRow extras = groups.stream().filter(g -> g.group().equals("Extras")).findFirst().orElseThrow();
        GroupRow size = groups.stream().filter(g -> g.group().equals("Size")).findFirst().orElseThrow();
        assertThat(spice.required()).isTrue();
        assertThat(spice.minSelect()).isEqualTo(1);
        assertThat(spice.maxSelect()).isEqualTo(1);
        assertThat(extras.required()).isFalse();
        assertThat(extras.maxSelect()).isEqualTo(3);
        assertThat(groups.stream().filter(g -> g.group().equals("Extras")).allMatch(g -> g.priceDelta().signum() > 0)).isTrue();
        assertThat(size.required()).isTrue();
    }

    @Test
    void everyItemIsValid_codesAreUnique_andReferencesExist() {
        Set<String> categories = DevSampleData.categories().stream().map(c -> c.name()).collect(Collectors.toSet());
        Set<String> groups = DevSampleData.groups().stream().map(GroupRow::group).collect(Collectors.toSet());
        Set<String> codes = new HashSet<>();
        for (ItemRow i : DevSampleData.items()) {
            assertThat(MenuItemService.CODE.matcher(i.code()).matches()).as(i.code()).isTrue();
            assertThat(codes.add(i.code())).as("duplicate code " + i.code()).isTrue();
            assertThat(categories).as(i.code()).contains(i.category());
            assertThat(groups).as(i.code()).containsAll(i.modifierGroups());
            assertThat(i.localPrice().signum()).isPositive();
            assertThat(i.localPrice().scale()).isEqualTo(2);
            if (i.foreignPrice() != null) {
                assertThat(i.foreignPrice()).as(i.code() + " foreign price is higher").isGreaterThan(i.localPrice());
            }
        }
    }

    @Test
    void groupRowsPassTheEditorRules() {
        // required groups allow at least 1, optional groups 0; max is not above the number of options
        var byGroup = DevSampleData.groups().stream().collect(Collectors.groupingBy(GroupRow::group));
        byGroup.forEach((name, rows) -> {
            GroupRow first = rows.get(0);
            assertThat(first.required() ? first.minSelect() >= 1 : first.minSelect() == 0).as(name).isTrue();
            assertThat(first.maxSelect()).as(name).isBetween(Math.max(first.minSelect(), 1), rows.size());
        });
    }
}
