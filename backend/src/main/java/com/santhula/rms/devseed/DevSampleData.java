package com.santhula.rms.devseed;

import com.santhula.rms.floor.service.FloorImportService.TableRow;
import com.santhula.rms.menu.service.MenuImportService.CategoryRow;
import com.santhula.rms.menu.service.MenuImportService.GroupRow;
import com.santhula.rms.menu.service.MenuImportService.ItemRow;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The sample restaurant used for development and demos (docs/requirements/m1.1-scope.md "Sample data for
 * testing"): 6 categories, 46 items across the three stations (about 30 with a foreign price), 3 modifier
 * groups, 12 tables and 3 delivery areas. Pure data, no database access, so it can be unit-tested.
 */
final class DevSampleData {

    /** A kitchen station as the demo restaurant names it. */
    record StationSample(int number, String defaultName, String name, int targetPrepMinutes) {
    }

    record AreaSample(String name, String fee) {
    }

    private DevSampleData() {
    }

    static List<StationSample> stations() {
        return List.of(
                new StationSample(1, "Kitchen 1", "Kitchen 1 - Rice & Curry", 15),
                new StationSample(2, "Kitchen 2", "Kitchen 2 - Grill", 20),
                new StationSample(3, "Kitchen 3", "Kitchen 3 - Juice & Dessert", 8));
    }

    static List<CategoryRow> categories() {
        List<String> names = List.of("Rice & Curry", "Short Eats", "Grill", "Beverages", "Desserts", "Liquor");
        List<CategoryRow> rows = new ArrayList<>();
        for (int i = 0; i < names.size(); i++) {
            rows.add(new CategoryRow(i + 2, names.get(i), (i + 1) * 10));
        }
        return rows;
    }

    static List<GroupRow> groups() {
        List<GroupRow> rows = new ArrayList<>();
        int r = 2;
        // Spice level: required, pick exactly 1
        for (String o : List.of("Mild", "Medium", "Hot")) {
            rows.add(new GroupRow(r++, "Spice level", true, 1, 1, o, money("0.00")));
        }
        // Extras: optional, pick up to 3, each with a price
        rows.add(new GroupRow(r++, "Extras", false, 0, 3, "Extra egg", money("80.00")));
        rows.add(new GroupRow(r++, "Extras", false, 0, 3, "Extra cheese", money("120.00")));
        rows.add(new GroupRow(r++, "Extras", false, 0, 3, "Extra gravy", money("60.00")));
        rows.add(new GroupRow(r++, "Extras", false, 0, 3, "Papadam", money("40.00")));
        // Size: required, pick exactly 1
        rows.add(new GroupRow(r++, "Size", true, 1, 1, "Regular", money("0.00")));
        rows.add(new GroupRow(r, "Size", true, 1, 1, "Large", money("150.00")));
        return rows;
    }

    static List<ItemRow> items() {
        List<ItemRow> rows = new ArrayList<>();
        Counter row = new Counter();
        String spice = "Spice level";
        String extras = "Extras";
        String size = "Size";

        // Kitchen 1: Rice & Curry
        add(rows, row, "RC-CHK", "Chicken rice and curry", "Rice & Curry", 1, "850.00", "1200.00", spice, extras);
        add(rows, row, "RC-FSH", "Fish rice and curry", "Rice & Curry", 1, "900.00", "1250.00", spice, extras);
        add(rows, row, "RC-VEG", "Vegetable rice and curry", "Rice & Curry", 1, "650.00", "950.00", spice);
        add(rows, row, "RC-EGG", "Egg rice and curry", "Rice & Curry", 1, "700.00", null, spice, extras);
        add(rows, row, "RC-PRK", "Pork curry with rice", "Rice & Curry", 1, "950.00", null, spice);
        add(rows, row, "RC-BEF", "Beef curry with rice", "Rice & Curry", 1, "1000.00", null, spice);
        add(rows, row, "FR-CHK", "Chicken fried rice", "Rice & Curry", 1, "1100.00", "1500.00", spice, size);
        add(rows, row, "FR-EGG", "Egg fried rice", "Rice & Curry", 1, "900.00", null, size);
        add(rows, row, "FR-SEA", "Seafood fried rice", "Rice & Curry", 1, "1400.00", "1900.00", spice, size);
        add(rows, row, "NS-CHK", "Chicken nasi goreng", "Rice & Curry", 1, "1200.00", null, spice);
        add(rows, row, "KT-CHK", "Chicken kottu", "Rice & Curry", 1, "1000.00", "1400.00", spice, extras);
        add(rows, row, "KT-CHZ", "Cheese kottu", "Rice & Curry", 1, "1200.00", null, spice, extras);
        add(rows, row, "KT-VEG", "Vegetable kottu", "Rice & Curry", 1, "800.00", null, spice);

        // Kitchen 1: Short Eats
        add(rows, row, "SE-FSH", "Fish cutlet", "Short Eats", 1, "120.00", "180.00");
        add(rows, row, "SE-ROL", "Egg roll", "Short Eats", 1, "150.00", null);
        add(rows, row, "SE-PAT", "Chicken patty", "Short Eats", 1, "160.00", "230.00");
        add(rows, row, "SE-VDS", "Vegetable samosa", "Short Eats", 1, "100.00", null);
        add(rows, row, "SE-WDE", "Isso wade", "Short Eats", 1, "180.00", null);
        add(rows, row, "SE-HPR", "Hoppers (2)", "Short Eats", 1, "200.00", null);

        // Kitchen 2: Grill
        add(rows, row, "GR-CHK", "Grilled chicken", "Grill", 2, "1500.00", "2100.00", spice, size);
        add(rows, row, "GR-FSH", "Grilled fish", "Grill", 2, "1800.00", "2500.00", spice);
        add(rows, row, "GR-PRW", "Garlic prawns", "Grill", 2, "2200.00", "3000.00", spice);
        add(rows, row, "GR-BBQ", "BBQ pork ribs", "Grill", 2, "2400.00", null);
        add(rows, row, "GR-SAU", "Pork sausages", "Grill", 2, "1300.00", null);
        add(rows, row, "GR-CHS", "Cheese burger", "Grill", 2, "1400.00", null, extras);
        add(rows, row, "GR-CKB", "Chicken burger", "Grill", 2, "1300.00", null, extras);
        add(rows, row, "GR-STK", "Beef steak", "Grill", 2, "2800.00", "3800.00");

        // Kitchen 3: Beverages, Desserts, Liquor
        add(rows, row, "BV-LIM", "Fresh lime juice", "Beverages", 3, "350.00", "500.00", size);
        add(rows, row, "BV-WAT", "Watermelon juice", "Beverages", 3, "400.00", null, size);
        add(rows, row, "BV-MNG", "Mango juice", "Beverages", 3, "450.00", "600.00", size);
        add(rows, row, "BV-PAP", "Papaya juice", "Beverages", 3, "380.00", null, size);
        add(rows, row, "BV-TEA", "Ceylon tea", "Beverages", 3, "200.00", "300.00");
        add(rows, row, "BV-COF", "Coffee", "Beverages", 3, "300.00", "450.00");
        add(rows, row, "BV-KOT", "King coconut", "Beverages", 3, "280.00", "400.00");
        add(rows, row, "BV-SDA", "Soft drink", "Beverages", 3, "250.00", null);
        add(rows, row, "BV-WTR", "Bottled water", "Beverages", 3, "150.00", null);
        add(rows, row, "DS-WTL", "Watalappan", "Desserts", 3, "350.00", "500.00");
        add(rows, row, "DS-ICE", "Ice cream (2 scoops)", "Desserts", 3, "400.00", "550.00");
        add(rows, row, "DS-FRT", "Fruit salad", "Desserts", 3, "450.00", null);
        add(rows, row, "DS-CRD", "Curd and treacle", "Desserts", 3, "300.00", null);
        add(rows, row, "DS-BRN", "Chocolate brownie", "Desserts", 3, "500.00", "700.00");
        add(rows, row, "LQ-LIO", "Lion lager", "Liquor", 3, "650.00", "900.00");
        add(rows, row, "LQ-VOD", "Vodka (shot)", "Liquor", 3, "700.00", "950.00");
        add(rows, row, "LQ-ARK", "Arrack (shot)", "Liquor", 3, "600.00", "850.00");
        add(rows, row, "LQ-WIN", "House wine (glass)", "Liquor", 3, "1100.00", "1500.00");
        add(rows, row, "LQ-WHK", "Whisky (shot)", "Liquor", 3, "900.00", "1200.00");
        return rows;
    }

    static List<TableRow> tables() {
        List<TableRow> rows = new ArrayList<>();
        int r = 2;
        int[] indoorSeats = {2, 2, 4, 4, 4, 6, 6, 8};
        for (int i = 0; i < indoorSeats.length; i++) {
            rows.add(new TableRow(r++, String.valueOf(i + 1), "Indoor", indoorSeats[i]));
        }
        int[] gardenSeats = {4, 4, 6, 6};
        for (int i = 0; i < gardenSeats.length; i++) {
            rows.add(new TableRow(r++, "G" + (i + 1), "Garden", gardenSeats[i]));
        }
        return rows;
    }

    static List<AreaSample> deliveryAreas() {
        return List.of(new AreaSample("Netolpitiya", "150.00"), new AreaSample("Nearby", "300.00"), new AreaSample("Far", "500.00"));
    }

    // ------------------------------------------------------------------ helpers

    private static final class Counter {
        int next = 2;
    }

    private static void add(List<ItemRow> rows, Counter row, String code, String name, String category, int station, String local,
                            String foreign, String... groups) {
        rows.add(new ItemRow(row.next++, code, name, category, station, money(local), foreign == null ? null : money(foreign),
                Arrays.asList(groups), true));
    }

    private static BigDecimal money(String v) {
        return new BigDecimal(v);
    }
}
