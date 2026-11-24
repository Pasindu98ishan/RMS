package com.santhula.rms.menu;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Menu API (P1-MENU-01..07, P1-SET-05): stations, categories, items with LOCAL / FOREIGN prices, availability,
 * modifier groups and the POS menu. 403 cases use a Cashier (no MENU_MANAGE, but MENU_AVAILABILITY) or a
 * Kitchen user (no ORDER_CREATE).
 */
class MenuApiIT extends IntegrationTestBase {

    private Session owner;
    private Session cashier;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
        cashier = asRole(SystemRole.CASHIER);
    }

    // ------------------------------------------------------------------ helpers

    private JsonNode stations() throws Exception {
        return body(doGet(owner, "/kitchen-stations").andExpect(status().isOk()));
    }

    private String stationId(int number) throws Exception {
        for (JsonNode s : stations()) {
            if (s.get("number").asInt() == number) {
                return s.get("id").asText();
            }
        }
        throw new AssertionError("no station " + number);
    }

    private JsonNode category(String name) throws Exception {
        return body(doPost(owner, "/categories", Map.of("name", name)).andExpect(status().isCreated()));
    }

    private Map<String, Object> itemBody(String code, String categoryId, String stationId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("code", code);
        b.put("name", "Item " + code);
        b.put("categoryId", categoryId);
        b.put("stationId", stationId);
        b.put("localPrice", "450.00");
        return b;
    }

    private JsonNode item(String code, String categoryId, String stationId) throws Exception {
        return body(doPost(owner, "/menu-items", itemBody(code, categoryId, stationId)).andExpect(status().isCreated()));
    }

    private JsonNode group(String name, int min, int max, List<Map<String, Object>> options) throws Exception {
        return body(doPost(owner, "/modifier-groups", Map.of("name", name, "required", min >= 1, "minSelect", min, "maxSelect", max,
                "options", options)).andExpect(status().isCreated()));
    }

    private static Map<String, Object> option(String name, String delta) {
        return Map.of("name", name, "priceDelta", delta);
    }

    // ------------------------------------------------------------------ kitchen stations (P1-MENU-07, P1-SET-05)

    @Test
    void P1_MENU_07_threeSeededStations_withTargetTimes() throws Exception {
        JsonNode list = stations();
        assertThat(list).hasSize(3);
        assertThat(list.findValuesAsText("name")).containsExactly("Kitchen 1", "Kitchen 2", "Kitchen 3");
        assertThat(list.get(0).get("targetPrepMinutes").asInt()).isEqualTo(15);
        assertThat(list.get(0).get("activeItemCount").asInt()).isZero();
        doGet(owner, "/kitchen-stations/" + stationId(2)).andExpect(status().isOk()).andExpect(jsonPath("$.number").value(2));
        doGet(owner, "/kitchen-stations/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(cashier, "/kitchen-stations").andExpect(forbidden());
    }

    @Test
    void P1_SET_05_updateStation_nameAndTargetTime_audited() throws Exception {
        String id = stationId(1);
        int v = body(doGet(owner, "/kitchen-stations/" + id)).get("version").asInt();
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "Kitchen 1 - Rice & Curry", "targetPrepMinutes", 12, "active", true, "version", v))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Kitchen 1 - Rice & Curry"))
                .andExpect(jsonPath("$.targetPrepMinutes").value(12))
                .andExpect(jsonPath("$.version").value(v + 1));
        doGet(owner, "/audit-log?entityType=KITCHEN_STATION&entityId=" + id + "&action=UPDATE")
                .andExpect(jsonPath("$.items[0].before.name").value("Kitchen 1"))
                .andExpect(jsonPath("$.items[0].after.targetPrepMinutes").value(12));
    }

    @Test
    void updateStation_validation_duplicateName_staleVersion_403() throws Exception {
        String id = stationId(1);
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "Kitchen 2", "targetPrepMinutes", 10, "active", true, "version", 0))
                .andExpect(problem(409, "STATION_NAME_TAKEN"));
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "Kitchen 1", "targetPrepMinutes", 10, "active", true, "version", 5))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "", "targetPrepMinutes", 0, "active", true, "version", 0))
                .andExpect(fieldError("targetPrepMinutes"));
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "X", "targetPrepMinutes", 241, "active", true, "version", 0))
                .andExpect(fieldError("targetPrepMinutes"));
        doPut(cashier, "/kitchen-stations/" + id, Map.of("name", "X", "targetPrepMinutes", 10, "active", true, "version", 0)).andExpect(forbidden());
    }

    @Test
    void deactivatingAStationWithActiveItems_is409_andWorksOnceItsItemsMoved() throws Exception {
        String cat = category("Grill").get("id").asText();
        String station2 = stationId(2);
        JsonNode created = item("GR-1", cat, station2);
        doPut(owner, "/kitchen-stations/" + station2, Map.of("name", "Kitchen 2", "targetPrepMinutes", 20, "active", false, "version", 0))
                .andExpect(problem(409, "STATION_IN_USE"));

        Map<String, Object> move = itemBody("GR-1", cat, stationId(3));
        move.put("active", true);
        move.put("version", created.get("version").asInt());
        doPut(owner, "/menu-items/" + created.get("id").asText(), move).andExpect(status().isOk());
        doPut(owner, "/kitchen-stations/" + station2, Map.of("name", "Kitchen 2", "targetPrepMinutes", 20, "active", false, "version", 0))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        // An inactive station is not offered to terminal setup or the POS.
        doGet(owner, "/kitchen-stations/options").andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void stationOptions_areForTerminalManagers_notMenuManagers() throws Exception {
        doGet(owner, "/kitchen-stations/options").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3)).andExpect(jsonPath("$[0].number").value(1));
        doGet(asRole(SystemRole.MANAGER), "/kitchen-stations/options").andExpect(forbidden());
    }

    // ------------------------------------------------------------------ categories (P1-MENU-01)

    @Test
    void P1_MENU_01_categories_createListGetUpdate_withOrderAndActiveFlag() throws Exception {
        JsonNode a = category("Rice & Curry");
        JsonNode b = body(doPost(owner, "/categories", Map.of("name", "Beverages", "sortOrder", 5, "active", false)).andExpect(status().isCreated())
                .andExpect(jsonPath("$.sortOrder").value(5)).andExpect(jsonPath("$.active").value(false)).andExpect(jsonPath("$.itemCount").value(0)));
        assertThat(a.get("sortOrder").asInt()).isGreaterThan(0);
        // Sorted by sortOrder: Beverages (5) before Rice & Curry (10)
        doGet(owner, "/categories").andExpect(jsonPath("$[0].name").value("Beverages")).andExpect(jsonPath("$[1].name").value("Rice & Curry"));
        doGet(owner, "/categories/" + a.get("id").asText()).andExpect(status().isOk());

        doPut(owner, "/categories/" + b.get("id").asText(), Map.of("name", "Drinks", "sortOrder", 50, "active", true, "version", 0))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Drinks")).andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void categories_duplicate_validation_staleVersion_notFound_403() throws Exception {
        String id = category("Desserts").get("id").asText();
        doPost(owner, "/categories", Map.of("name", "DESSERTS")).andExpect(problem(409, "CATEGORY_NAME_TAKEN"));
        doPost(owner, "/categories", Map.of("name", "")).andExpect(fieldError("name"));
        doPost(owner, "/categories", Map.of("name", "X", "sortOrder", -1)).andExpect(fieldError("sortOrder"));
        doPut(owner, "/categories/" + id, Map.of("name", "Desserts", "sortOrder", 1, "active", true, "version", 9)).andExpect(problem(409, "VERSION_CONFLICT"));
        doGet(owner, "/categories/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(owner, "/categories/not-a-uuid").andExpect(malformed());
        doGet(cashier, "/categories").andExpect(forbidden());
        doPost(cashier, "/categories", Map.of("name", "Sneaky")).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ modifier groups (P1-MENU-03)

    @Test
    void P1_MENU_03_createGroup_keepsOptionOrder_andPrices() throws Exception {
        JsonNode g = group("Extras", 0, 3, List.of(option("Extra egg", "80.00"), option("Extra cheese", "120.00"), option("Papadam", "40.00")));
        assertThat(g.get("options").findValuesAsText("name")).containsExactly("Extra egg", "Extra cheese", "Papadam");
        assertThat(g.get("options").get(1).get("priceDelta").asText()).isEqualTo("120.00");
        assertThat(g.get("required").asBoolean()).isFalse();
        assertThat(g.get("itemCount").asInt()).isZero();
        doGet(owner, "/modifier-groups/" + g.get("id").asText()).andExpect(status().isOk());
        doGet(owner, "/modifier-groups").andExpect(jsonPath("$[0].name").value("Extras"));
    }

    @Test
    void P1_MENU_03_groupRules_areEnforced() throws Exception {
        // required without a minimum
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", true, "minSelect", 0, "maxSelect", 1, "options", List.of(option("x", "0.00"))))
                .andExpect(fieldError("minSelect"));
        // optional with a minimum
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 1, "maxSelect", 1, "options", List.of(option("x", "0.00"))))
                .andExpect(fieldError("minSelect"));
        // max more than the options
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 0, "maxSelect", 3, "options", List.of(option("x", "0.00"))))
                .andExpect(fieldError("maxSelect"));
        // max below min
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", true, "minSelect", 2, "maxSelect", 1,
                "options", List.of(option("x", "0.00"), option("y", "0.00")))).andExpect(fieldError("maxSelect"));
        // negative price, duplicate option names
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 0, "maxSelect", 1,
                "options", List.of(option("x", "-1.00")))).andExpect(fieldError("options[0].priceDelta"));
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 0, "maxSelect", 1,
                "options", List.of(option("x", "0.00"), option("X", "5.00")))).andExpect(fieldError("options[1].name"));
        // no options
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 0, "maxSelect", 1, "options", List.of()))
                .andExpect(fieldError("options"));
        // a price that is not money text
        doPost(owner, "/modifier-groups", Map.of("name", "A", "required", false, "minSelect", 0, "maxSelect", 1,
                "options", List.of(option("x", "5")))).andExpect(fieldError("options[0].priceDelta"));
    }

    @Test
    void groups_duplicateName_403_notFound() throws Exception {
        group("Size", 1, 1, List.of(option("Regular", "0.00"), option("Large", "150.00")));
        doPost(owner, "/modifier-groups", Map.of("name", "size", "required", false, "minSelect", 0, "maxSelect", 1,
                "options", List.of(option("x", "0.00")))).andExpect(problem(409, "MODIFIER_GROUP_NAME_TAKEN"));
        doGet(cashier, "/modifier-groups").andExpect(forbidden());
        doPost(cashier, "/modifier-groups", Map.of("name", "Z", "required", false, "minSelect", 0, "maxSelect", 1,
                "options", List.of(option("x", "0.00")))).andExpect(forbidden());
        doGet(owner, "/modifier-groups/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
    }

    @Test
    void updateGroup_keepsOptionIds_removesOmitted_rejectsForeignIds_andStaleVersions() throws Exception {
        JsonNode g = group("Extras", 0, 2, List.of(option("Egg", "80.00"), option("Cheese", "120.00"), option("Gravy", "60.00")));
        String id = g.get("id").asText();
        String eggId = g.get("options").get(0).get("id").asText();

        List<Map<String, Object>> options = new ArrayList<>();
        options.add(Map.of("id", eggId, "name", "Fried egg", "priceDelta", "90.00"));   // renamed and repriced, same identity
        options.add(Map.of("name", "Bacon", "priceDelta", "200.00"));                    // new; Cheese and Gravy are dropped
        JsonNode updated = body(doPut(owner, "/modifier-groups/" + id, Map.of("name", "Extras", "required", false, "minSelect", 0,
                "maxSelect", 2, "active", true, "options", options, "version", 0)).andExpect(status().isOk()));
        assertThat(updated.get("options").findValuesAsText("name")).containsExactly("Fried egg", "Bacon");
        assertThat(updated.get("options").get(0).get("id").asText()).isEqualTo(eggId);
        assertThat(updated.get("options").get(0).get("priceDelta").asText()).isEqualTo("90.00");
        assertThat(updated.get("version").asInt()).isEqualTo(1);

        doPut(owner, "/modifier-groups/" + id, Map.of("name", "Extras", "required", false, "minSelect", 0, "maxSelect", 1, "active", true,
                "options", List.of(Map.of("id", UUID.randomUUID().toString(), "name", "Ghost", "priceDelta", "1.00")), "version", 1))
                .andExpect(fieldError("options[0].id"));
        doPut(owner, "/modifier-groups/" + id, Map.of("name", "Extras", "required", false, "minSelect", 0, "maxSelect", 1, "active", true,
                "options", options, "version", 0)).andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(cashier, "/modifier-groups/" + id, Map.of("name", "Extras", "required", false, "minSelect", 0, "maxSelect", 1, "active", true,
                "options", options, "version", 1)).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ menu items (P1-MENU-02, 04, 05)

    @Test
    void P1_MENU_02_createItem_withBothPriceLists_station_andOrderedModifierGroups() throws Exception {
        String cat = category("Rice & Curry").get("id").asText();
        String station = stationId(1);
        String spice = group("Spice level", 1, 1, List.of(option("Mild", "0.00"), option("Hot", "0.00"))).get("id").asText();
        String extras = group("Extras", 0, 1, List.of(option("Egg", "80.00"))).get("id").asText();

        Map<String, Object> b = itemBody("RC-CHK", cat, station);
        b.put("localPrice", "850.00");
        b.put("foreignPrice", "1200.00");
        b.put("modifierGroupIds", List.of(extras, spice));     // display order: Extras first
        JsonNode created = body(doPost(owner, "/menu-items", b).andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value("RC-CHK"))
                .andExpect(jsonPath("$.localPrice").value("850.00"))
                .andExpect(jsonPath("$.foreignPrice").value("1200.00"))
                .andExpect(jsonPath("$.categoryName").value("Rice & Curry"))
                .andExpect(jsonPath("$.stationId").value(station))
                .andExpect(jsonPath("$.stationName").value("Kitchen 1"))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.version").value(0)));
        assertThat(created.get("modifierGroups").findValuesAsText("name")).containsExactly("Extras", "Spice level");

        doGet(owner, "/menu-items/" + created.get("id").asText()).andExpect(jsonPath("$.modifierGroups[0].name").value("Extras"));
        doGet(owner, "/modifier-groups/" + spice).andExpect(jsonPath("$.itemCount").value(1));
        doGet(owner, "/kitchen-stations/" + station).andExpect(jsonPath("$.activeItemCount").value(1));
        doGet(owner, "/categories/" + cat).andExpect(jsonPath("$.itemCount").value(1));
    }

    /** BUG-1-007: every way of changing the attached groups works in a single PUT, including reordering. */
    @Test
    void BUG_1_007_modifierGroups_canBeReordered_added_removed_andReplaced_inOnePut() throws Exception {
        String cat = category("Rice & Curry").get("id").asText();
        String station = stationId(1);
        List<String> g = new ArrayList<>();
        for (String name : List.of("Spice level", "Extras", "Size", "Sauce")) {
            g.add(group(name, 0, 1, List.of(option("a", "0.00"))).get("id").asText());
        }
        Map<String, Object> create = itemBody("RC-1", cat, station);
        create.put("modifierGroupIds", List.of(g.get(0), g.get(1)));
        JsonNode created = body(doPost(owner, "/menu-items", create).andExpect(status().isCreated()));
        String id = created.get("id").asText();
        int version = created.get("version").asInt();

        // each step is one PUT with the version of the previous result
        List<List<String>> steps = List.of(
                List.of(g.get(1), g.get(0)),                          // swap the two
                List.of(g.get(1), g.get(0)),                          // same order again (a price edit)
                List.of(g.get(2), g.get(1), g.get(0)),                // add one in front
                List.of(g.get(1), g.get(0), g.get(2)),                // rotate three
                List.of(g.get(2), g.get(0)),                          // remove one and reorder the rest
                List.of(g.get(3), g.get(2), g.get(0), g.get(1)),      // add two, reverse
                List.of(g.get(3)),                                    // replace by one of them
                List.of(g.get(0), g.get(1)),                          // replace by different ones
                List.of());                                           // detach all
        for (List<String> order : steps) {
            Map<String, Object> put = itemBody("RC-1", cat, station);
            put.put("active", true);
            put.put("modifierGroupIds", order);
            put.put("version", version);
            JsonNode saved = body(doPut(owner, "/menu-items/" + id, put).andExpect(status().isOk()));
            version = saved.get("version").asInt();
            List<String> stored = new ArrayList<>();
            saved.get("modifierGroups").forEach(m -> stored.add(m.get("id").asText()));
            assertThat(stored).as("order after saving %s", order).isEqualTo(order);
            // and it is what a fresh read returns, and what the POS shows
            List<String> read = new ArrayList<>();
            body(doGet(owner, "/menu-items/" + id)).get("modifierGroups").forEach(m -> read.add(m.get("id").asText()));
            assertThat(read).isEqualTo(order);
        }
    }

    @Test
    void foreignPrice_isOptional_andMoneyIsAlwaysATwoDecimalString() throws Exception {
        String cat = category("Beverages").get("id").asText();
        JsonNode created = item("BV-TEA", cat, stationId(3));
        assertThat(created.has("foreignPrice")).isFalse();
        assertThat(created.get("localPrice").asText()).isEqualTo("450.00");
        doGet(owner, "/menu-items?search=BV-TEA").andExpect(jsonPath("$.items[0].localPrice").isString())
                .andExpect(jsonPath("$.items[0].foreignPrice").doesNotExist());
    }

    @Test
    void P1_MENU_02_anItemNeedsExactlyOneStation_andValidReferences() throws Exception {
        String cat = category("Grill").get("id").asText();
        Map<String, Object> noStation = itemBody("GR-1", cat, stationId(2));
        noStation.remove("stationId");
        doPost(owner, "/menu-items", noStation).andExpect(fieldError("stationId"));
        doPost(owner, "/menu-items", itemBody("GR-1", cat, UUID.randomUUID().toString())).andExpect(fieldError("stationId"));
        doPost(owner, "/menu-items", itemBody("GR-1", UUID.randomUUID().toString(), stationId(2))).andExpect(fieldError("categoryId"));
        Map<String, Object> badGroup = itemBody("GR-1", cat, stationId(2));
        badGroup.put("modifierGroupIds", List.of(UUID.randomUUID().toString()));
        doPost(owner, "/menu-items", badGroup).andExpect(fieldError("modifierGroupIds[0]"));
        doGet(owner, "/menu-items?search=GR-1").andExpect(jsonPath("$.totalItems").value(0));
    }

    @Test
    void items_validation_duplicateCode_notFound_403() throws Exception {
        String cat = category("Grill").get("id").asText();
        String station = stationId(2);
        item("GR-1", cat, station);
        doPost(owner, "/menu-items", itemBody("GR-1", cat, station)).andExpect(problem(409, "ITEM_CODE_TAKEN"));
        doPost(owner, "/menu-items", itemBody("gr-2", cat, station)).andExpect(fieldError("code"));
        doPost(owner, "/menu-items", itemBody("A".repeat(21), cat, station)).andExpect(fieldError("code"));
        Map<String, Object> negative = itemBody("GR-3", cat, station);
        negative.put("localPrice", "-5.00");
        doPost(owner, "/menu-items", negative).andExpect(fieldError("localPrice"));
        Map<String, Object> badMoney = itemBody("GR-3", cat, station);
        badMoney.put("localPrice", "450");
        doPost(owner, "/menu-items", badMoney).andExpect(fieldError("localPrice"));
        Map<String, Object> negativeForeign = itemBody("GR-3", cat, station);
        negativeForeign.put("foreignPrice", "-1.00");
        doPost(owner, "/menu-items", negativeForeign).andExpect(fieldError("foreignPrice"));
        Map<String, Object> noName = itemBody("GR-3", cat, station);
        noName.put("name", "");
        doPost(owner, "/menu-items", noName).andExpect(fieldError("name"));
        doGet(owner, "/menu-items/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doPost(cashier, "/menu-items", itemBody("GR-9", cat, station)).andExpect(forbidden());
        doGet(cashier, "/menu-items").andExpect(forbidden());
        doGet(cashier, "/menu-items/" + UUID.randomUUID()).andExpect(forbidden());
    }

    @Test
    void P1_MENU_05_priceChange_isAudited_withBeforeAndAfter() throws Exception {
        String cat = category("Rice & Curry").get("id").asText();
        JsonNode created = item("RC-1", cat, stationId(1));
        String id = created.get("id").asText();

        Map<String, Object> update = itemBody("RC-1", cat, stationId(1));
        update.put("localPrice", "500.00");
        update.put("foreignPrice", "700.00");
        update.put("active", true);
        update.put("version", 0);
        doPut(owner, "/menu-items/" + id, update).andExpect(status().isOk())
                .andExpect(jsonPath("$.localPrice").value("500.00")).andExpect(jsonPath("$.foreignPrice").value("700.00"))
                .andExpect(jsonPath("$.version").value(1));

        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + id + "&action=PRICE_CHANGED")
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].before.localPrice").value("450.00"))
                .andExpect(jsonPath("$.items[0].after.localPrice").value("500.00"))
                .andExpect(jsonPath("$.items[0].after.foreignPrice").value("700.00"));

        // An update that does not touch the prices writes UPDATE but no PRICE_CHANGED.
        update.put("name", "Renamed");
        update.put("version", 1);
        doPut(owner, "/menu-items/" + id, update).andExpect(status().isOk());
        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + id + "&action=PRICE_CHANGED").andExpect(jsonPath("$.totalItems").value(1));
        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + id + "&action=UPDATE").andExpect(jsonPath("$.totalItems").value(2));
    }

    @Test
    void updateItem_removesForeignPrice_whenOmitted_staleVersion_duplicateCode() throws Exception {
        String cat = category("Grill").get("id").asText();
        Map<String, Object> b = itemBody("GR-1", cat, stationId(2));
        b.put("foreignPrice", "900.00");
        String id = body(doPost(owner, "/menu-items", b).andExpect(status().isCreated())).get("id").asText();
        item("GR-2", cat, stationId(2));

        Map<String, Object> update = itemBody("GR-1", cat, stationId(2));
        update.put("active", true);
        update.put("version", 0);
        doPut(owner, "/menu-items/" + id, update).andExpect(status().isOk()).andExpect(jsonPath("$.foreignPrice").doesNotExist());
        doPut(owner, "/menu-items/" + id, update).andExpect(problem(409, "VERSION_CONFLICT"));      // version is 1 now
        update.put("version", 1);
        update.put("code", "GR-2");
        doPut(owner, "/menu-items/" + id, update).andExpect(problem(409, "ITEM_CODE_TAKEN"));
        update.put("code", "GR-1");
        doPut(cashier, "/menu-items/" + id, update).andExpect(forbidden());
    }

    @Test
    void listItems_pagedFilteredSearchedAndSorted() throws Exception {
        String grill = category("Grill").get("id").asText();
        String drinks = category("Beverages").get("id").asText();
        for (int i = 1; i <= 5; i++) {
            Map<String, Object> b = itemBody("GR-" + i, grill, stationId(2));
            b.put("name", "Grill item " + (6 - i));
            b.put("localPrice", (100 * i) + ".00");
            doPost(owner, "/menu-items", b).andExpect(status().isCreated());
        }
        item("BV-1", drinks, stationId(3));

        doGet(owner, "/menu-items?size=2&page=0").andExpect(jsonPath("$.totalItems").value(6)).andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].code").value("BV-1")).andExpect(jsonPath("$.items[1].code").value("GR-1"));
        doGet(owner, "/menu-items?size=2&page=2").andExpect(jsonPath("$.items.length()").value(2)).andExpect(jsonPath("$.page").value(2));
        doGet(owner, "/menu-items?categoryId=" + grill + "&sort=localPrice,desc&size=3").andExpect(jsonPath("$.totalItems").value(5))
                .andExpect(jsonPath("$.items[0].code").value("GR-5")).andExpect(jsonPath("$.items[2].code").value("GR-3"));
        doGet(owner, "/menu-items?categoryId=" + grill + "&sort=name,asc").andExpect(jsonPath("$.items[0].name").value("Grill item 1"));
        doGet(owner, "/menu-items?stationId=" + stationId(3)).andExpect(jsonPath("$.totalItems").value(1));
        doGet(owner, "/menu-items?search=item 3").andExpect(jsonPath("$.totalItems").value(1)).andExpect(jsonPath("$.items[0].code").value("GR-3"));
        doGet(owner, "/menu-items?search=bv-").andExpect(jsonPath("$.totalItems").value(1));
        doGet(owner, "/menu-items?active=false").andExpect(jsonPath("$.totalItems").value(0));
        doGet(owner, "/menu-items?available=false").andExpect(jsonPath("$.totalItems").value(0));
        doGet(owner, "/menu-items?size=500").andExpect(fieldError("size"));
        doGet(owner, "/menu-items?sort=cost,asc").andExpect(fieldError("sort"));
        doGet(owner, "/menu-items?categoryId=nope").andExpect(malformed());
    }

    // ------------------------------------------------------------------ availability (P1-MENU-06)

    @Test
    void P1_MENU_06_aCashier_canMarkItemsSoldOut_withoutEditRights() throws Exception {
        String cat = category("Beverages").get("id").asText();
        JsonNode created = item("BV-1", cat, stationId(3));
        String id = created.get("id").asText();

        doPut(cashier, "/menu-items/" + id + "/availability", Map.of("available", false)).andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(false)).andExpect(jsonPath("$.code").value("BV-1"));
        doGet(owner, "/menu-items/" + id).andExpect(jsonPath("$.available").value(false)).andExpect(jsonPath("$.version").value(0));
        doGet(owner, "/menu-items?available=false").andExpect(jsonPath("$.totalItems").value(1));
        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + id + "&action=UPDATE")
                .andExpect(jsonPath("$.items[0].before.available").value(true)).andExpect(jsonPath("$.items[0].after.available").value(false))
                .andExpect(jsonPath("$.items[0].user.username").value(cashier.username()));
        // Idempotent: the same value again changes nothing and is not audited twice.
        doPut(cashier, "/menu-items/" + id + "/availability", Map.of("available", false)).andExpect(status().isOk());
        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + id + "&action=UPDATE").andExpect(jsonPath("$.totalItems").value(1));
        doPut(cashier, "/menu-items/" + id + "/availability", Map.of("available", true)).andExpect(jsonPath("$.available").value(true));
    }

    @Test
    void aSoldOutToggle_neitherBreaksNorUndoesAnAdminsOpenEditForm() throws Exception {
        String cat = category("Beverages").get("id").asText();
        JsonNode created = item("BV-1", cat, stationId(3));
        String id = created.get("id").asText();

        // The admin opens the item (version 0); meanwhile a cashier marks it sold out.
        doPut(cashier, "/menu-items/" + id + "/availability", Map.of("available", false)).andExpect(status().isOk());

        Map<String, Object> save = itemBody("BV-1", cat, stationId(3));
        save.put("name", "Lime juice");
        save.put("active", true);
        save.put("version", 0);
        doPut(owner, "/menu-items/" + id, save).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Lime juice"))
                .andExpect(jsonPath("$.available").value(false));     // the admin's save did not bring the item back
    }

    @Test
    void availability_validation_notFound_403() throws Exception {
        String cat = category("Beverages").get("id").asText();
        String id = item("BV-1", cat, stationId(3)).get("id").asText();
        doPut(owner, "/menu-items/" + id + "/availability", Map.of()).andExpect(fieldError("available"));
        doPut(owner, "/menu-items/" + id + "/availability", Map.of("available", "false")).andExpect(fieldError("available"));
        doPut(owner, "/menu-items/" + UUID.randomUUID() + "/availability", Map.of("available", false)).andExpect(problem(404, "NOT_FOUND"));
        Session kitchen = asRole(SystemRole.KITCHEN);
        doPut(kitchen, "/menu-items/" + id + "/availability", Map.of("available", false)).andExpect(forbidden());
        doGet(kitchen, "/menu/availability").andExpect(forbidden());
    }

    @Test
    void availabilityBoard_listsActiveItemsOfActiveCategories_forPeopleWhoMayToggle() throws Exception {
        String drinks = category("Beverages").get("id").asText();
        String hidden = category("Old").get("id").asText();
        item("BV-1", drinks, stationId(3));
        JsonNode retired = item("BV-2", drinks, stationId(3));
        item("OL-1", hidden, stationId(3));
        Map<String, Object> off = itemBody("BV-2", drinks, stationId(3));
        off.put("active", false);
        off.put("version", retired.get("version").asInt());
        doPut(owner, "/menu-items/" + retired.get("id").asText(), off).andExpect(status().isOk());
        doPut(owner, "/categories/" + hidden, Map.of("name", "Old", "sortOrder", 99, "active", false, "version", 0)).andExpect(status().isOk());

        doGet(cashier, "/menu/availability").andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].code").value("BV-1")).andExpect(jsonPath("$[0].categoryName").value("Beverages"))
                .andExpect(jsonPath("$[0].available").value(true));
    }

    // ------------------------------------------------------------------ POS menu

    @Test
    void posMenu_hasOnlySellableThings_pricesStationsAndGroups() throws Exception {
        String rice = category("Rice & Curry").get("id").asText();
        String hidden = category("Old").get("id").asText();
        String spice = group("Spice level", 1, 1, List.of(option("Mild", "0.00"), option("Hot", "0.00"))).get("id").asText();
        JsonNode inactiveGroup = group("Retired", 0, 1, List.of(option("x", "1.00")));
        doPut(owner, "/modifier-groups/" + inactiveGroup.get("id").asText(), Map.of("name", "Retired", "required", false, "minSelect", 0,
                "maxSelect", 1, "active", false, "options", List.of(Map.of("id", inactiveGroup.get("options").get(0).get("id").asText(),
                        "name", "x", "priceDelta", "1.00")), "version", 0)).andExpect(status().isOk());

        Map<String, Object> b = itemBody("RC-1", rice, stationId(1));
        b.put("foreignPrice", "600.00");
        b.put("modifierGroupIds", List.of(spice, inactiveGroup.get("id").asText()));
        String soldOut = body(doPost(owner, "/menu-items", b).andExpect(status().isCreated())).get("id").asText();
        item("RC-2", rice, stationId(1));
        item("OL-1", hidden, stationId(1));
        doPut(cashier, "/menu-items/" + soldOut + "/availability", Map.of("available", false)).andExpect(status().isOk());
        doPut(owner, "/categories/" + hidden, Map.of("name", "Old", "sortOrder", 99, "active", false, "version", 0)).andExpect(status().isOk());

        JsonNode menu = body(doGet(cashier, "/menu/pos").andExpect(status().isOk()).andExpect(jsonPath("$.generatedAt").isNotEmpty()));
        assertThat(menu.get("categories")).hasSize(1);                                   // the inactive category is gone
        JsonNode items = menu.get("categories").get(0).get("items");
        assertThat(items).hasSize(2);
        JsonNode rc1 = items.get(0).get("code").asText().equals("RC-1") ? items.get(0) : items.get(1);
        assertThat(rc1.get("localPrice").asText()).isEqualTo("450.00");
        assertThat(rc1.get("foreignPrice").asText()).isEqualTo("600.00");
        assertThat(rc1.get("available").asBoolean()).isFalse();                          // sold out, but still listed
        assertThat(rc1.get("stationId").asText()).isEqualTo(stationId(1));
        assertThat(rc1.get("modifierGroupIds")).hasSize(1);                              // the inactive group is dropped
        assertThat(menu.get("modifierGroups")).hasSize(1);
        assertThat(menu.get("modifierGroups").get(0).get("options").get(0).get("name").asText()).isEqualTo("Mild");
        assertThat(menu.get("modifierGroups").get(0).get("required").asBoolean()).isTrue();
        assertThat(menu.get("kitchenStations")).hasSize(3);
    }

    @Test
    void posMenu_needsOrderCreate() throws Exception {
        doGet(asRole(SystemRole.KITCHEN), "/menu/pos").andExpect(forbidden());
        doGet(asRole(SystemRole.RECEPTIONIST), "/menu/pos").andExpect(status().isOk()).andExpect(jsonPath("$.categories").isArray());
        doGet(null, "/menu/pos").andExpect(problem(401, "UNAUTHENTICATED"));
    }

    @Test
    void menuChangesAreVisibleToThePosAtOnce() throws Exception {
        String cat = category("Beverages").get("id").asText();
        doGet(cashier, "/menu/pos").andExpect(jsonPath("$.categories[0].items.length()").value(0));
        item("BV-1", cat, stationId(3));
        doGet(cashier, "/menu/pos").andExpect(jsonPath("$.categories[0].items.length()").value(1))
                .andExpect(jsonPath("$.categories[0].items[0].code").value("BV-1"));
    }
}
