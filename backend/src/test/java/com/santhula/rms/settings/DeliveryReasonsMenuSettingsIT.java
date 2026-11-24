package com.santhula.rms.settings;

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
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Delivery areas (P1-SET-07), reason lists (P1-SET-08) and the menu behaviour setting (P1-MENU-06).
 * 403 cases use a Manager (no SETTINGS_MANAGE) and a Kitchen user (no ORDER_CREATE / ORDER_VIEW).
 */
class DeliveryReasonsMenuSettingsIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;
    private Session cashier;
    private Session kitchen;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
        cashier = asRole(SystemRole.CASHIER);
        kitchen = asRole(SystemRole.KITCHEN);
    }

    private JsonNode area(String name, String fee) throws Exception {
        return body(doPost(owner, "/delivery-areas", Map.of("name", name, "fee", fee)).andExpect(status().isCreated()));
    }

    // ------------------------------------------------------------------ delivery areas

    @Test
    void P1_SET_07_createListGetUpdateArea_feeIsAMoneyString() throws Exception {
        JsonNode a = area("Netolpitiya", "150.00");
        assertThat(a.get("fee").asText()).isEqualTo("150.00");
        assertThat(a.get("active").asBoolean()).isTrue();
        area("Far", "500.00");
        doGet(owner, "/delivery-areas").andExpect(jsonPath("$.length()").value(2)).andExpect(jsonPath("$[0].name").value("Far"))
                .andExpect(jsonPath("$[1].fee").value("150.00"));
        String id = a.get("id").asText();
        doGet(owner, "/delivery-areas/" + id).andExpect(status().isOk());
        doPut(owner, "/delivery-areas/" + id, Map.of("name", "Netolpitiya town", "fee", "175.00", "active", true, "version", 0))
                .andExpect(status().isOk()).andExpect(jsonPath("$.fee").value("175.00")).andExpect(jsonPath("$.version").value(1));
        doGet(owner, "/audit-log?entityType=DELIVERY_AREA&entityId=" + id + "&action=UPDATE")
                .andExpect(jsonPath("$.items[0].before.fee").value("150.00")).andExpect(jsonPath("$.items[0].after.fee").value("175.00"));
    }

    @Test
    void areas_validation_duplicate_staleVersion_notFound_403() throws Exception {
        String id = area("Nearby", "300.00").get("id").asText();
        doPost(owner, "/delivery-areas", Map.of("name", "nearby", "fee", "1.00")).andExpect(problem(409, "DELIVERY_AREA_NAME_TAKEN"));
        doPost(owner, "/delivery-areas", Map.of("name", "", "fee", "1.00")).andExpect(fieldError("name"));
        doPost(owner, "/delivery-areas", Map.of("name", "X", "fee", "-1.00")).andExpect(fieldError("fee"));
        doPost(owner, "/delivery-areas", Map.of("name", "X", "fee", "150")).andExpect(fieldError("fee"));
        doPost(owner, "/delivery-areas", Map.of("name", "X")).andExpect(fieldError("fee"));
        doPut(owner, "/delivery-areas/" + id, Map.of("name", "Nearby", "fee", "300.00", "active", true, "version", 4)).andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/delivery-areas/" + id, Map.of("name", "Nearby", "fee", "-3.00", "active", true, "version", 0)).andExpect(fieldError("fee"));
        doGet(owner, "/delivery-areas/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(owner, "/delivery-areas/zzz").andExpect(malformed());
        doGet(manager, "/delivery-areas").andExpect(forbidden());
        doPost(manager, "/delivery-areas", Map.of("name", "Z", "fee", "1.00")).andExpect(forbidden());
        doPut(manager, "/delivery-areas/" + id, Map.of("name", "Nearby", "fee", "300.00", "active", true, "version", 0)).andExpect(forbidden());
    }

    @Test
    void areaOptions_areTheActiveAreas_forThePosAndNeedOrderCreate() throws Exception {
        area("Netolpitiya", "150.00");
        String far = area("Far", "500.00").get("id").asText();
        doPut(owner, "/delivery-areas/" + far, Map.of("name", "Far", "fee", "500.00", "active", false, "version", 0)).andExpect(status().isOk());

        doGet(cashier, "/delivery-areas/options").andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Netolpitiya")).andExpect(jsonPath("$[0].fee").value("150.00"));
        doGet(kitchen, "/delivery-areas/options").andExpect(forbidden());
    }

    // ------------------------------------------------------------------ reasons

    @Test
    void P1_SET_08_defaultReasonLists_areSeeded() throws Exception {
        for (String category : new String[] {"CANCEL", "VOID", "REFUND", "PETTY_CASH", "DISCOUNT_OTHER"}) {
            JsonNode list = body(doGet(owner, "/reasons?category=" + category).andExpect(status().isOk()));
            assertThat(list.size()).as(category).isGreaterThanOrEqualTo(4);
            assertThat(list.findValuesAsText("category")).containsOnly(category);
        }
        assertThat(body(doGet(owner, "/reasons")).size()).isGreaterThanOrEqualTo(20);
        assertThat(body(doGet(owner, "/reasons?category=CANCEL")).findValuesAsText("text")).contains("Customer changed mind");
    }

    @Test
    void P1_SET_08_addEditAndDeactivateAReason_withoutDeleting() throws Exception {
        JsonNode created = body(doPost(owner, "/reasons", Map.of("category", "CANCEL", "text", "Allergy")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true)).andExpect(jsonPath("$.category").value("CANCEL")));
        String id = created.get("id").asText();
        doPut(owner, "/reasons/" + id, Map.of("text", "Customer allergy", "active", true, "version", 0)).andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("Customer allergy")).andExpect(jsonPath("$.category").value("CANCEL"));
        doPut(owner, "/reasons/" + id, Map.of("text", "Customer allergy", "active", false, "version", 1)).andExpect(status().isOk());

        // the dialogs only offer active reasons
        assertThat(body(doGet(cashier, "/reasons/options?category=CANCEL")).findValuesAsText("text")).doesNotContain("Customer allergy");
        assertThat(body(doGet(owner, "/reasons?category=CANCEL")).findValuesAsText("text")).contains("Customer allergy");
        doGet(owner, "/audit-log?entityType=REASON&entityId=" + id).andExpect(jsonPath("$.totalItems").value(3));
    }

    @Test
    void reasons_duplicateInTheSameList_isRefused_butTheSameTextInAnotherListIsFine() throws Exception {
        doPost(owner, "/reasons", Map.of("category", "CANCEL", "text", "customer changed mind")).andExpect(problem(409, "REASON_TEXT_TAKEN"));
        doPost(owner, "/reasons", Map.of("category", "REFUND", "text", "Customer changed mind")).andExpect(status().isCreated());
        doPost(owner, "/reasons", Map.of("category", "REFUND", "text", "customer CHANGED mind")).andExpect(problem(409, "REASON_TEXT_TAKEN"));
        doPost(owner, "/reasons", Map.of("category", "PETTY_CASH", "text", "Customer changed mind")).andExpect(status().isCreated());
    }

    @Test
    void reasons_validation_staleVersion_notFound_403() throws Exception {
        doPost(owner, "/reasons", Map.of("category", "CANCEL", "text", "")).andExpect(fieldError("text"));
        doPost(owner, "/reasons", Map.of("category", "NOT_A_LIST", "text", "x")).andExpect(fieldError("category"));
        doPost(owner, "/reasons", Map.of("text", "x")).andExpect(fieldError("category"));
        String id = body(doPost(owner, "/reasons", Map.of("category", "VOID", "text", "Typo")).andExpect(status().isCreated())).get("id").asText();
        doPut(owner, "/reasons/" + id, Map.of("text", "Typo", "active", true, "version", 3)).andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/reasons/" + id, Map.of("text", "", "active", true, "version", 0)).andExpect(fieldError("text"));
        doPut(owner, "/reasons/" + UUID.randomUUID(), Map.of("text", "x", "active", true, "version", 0)).andExpect(problem(404, "NOT_FOUND"));
        doGet(owner, "/reasons?category=NOPE").andExpect(malformed());
        doGet(manager, "/reasons").andExpect(forbidden());
        doPost(manager, "/reasons", Map.of("category", "VOID", "text", "Sneaky")).andExpect(forbidden());
        doPut(manager, "/reasons/" + id, Map.of("text", "x", "active", true, "version", 0)).andExpect(forbidden());
    }

    @Test
    void reasonOptions_needTheCategory_andOrderView() throws Exception {
        doGet(cashier, "/reasons/options?category=VOID").andExpect(status().isOk()).andExpect(jsonPath("$[0].id").isNotEmpty())
                .andExpect(jsonPath("$[0].text").isNotEmpty());
        doGet(manager, "/reasons/options?category=REFUND").andExpect(status().isOk());
        doGet(cashier, "/reasons/options").andExpect(status().isBadRequest());
        doGet(cashier, "/reasons/options?category=NOPE").andExpect(malformed());
        doGet(kitchen, "/reasons/options?category=VOID").andExpect(forbidden());
    }

    // ------------------------------------------------------------------ menu setting

    @Test
    void P1_MENU_06_menuSetting_dailyReset_isOnByDefault_andCanBeSwitchedOff() throws Exception {
        doGet(owner, "/settings/menu").andExpect(status().isOk()).andExpect(jsonPath("$.resetAvailabilityDaily").value(true))
                .andExpect(jsonPath("$.version").value(0));
        doPut(owner, "/settings/menu", Map.of("resetAvailabilityDaily", false, "version", 0)).andExpect(status().isOk())
                .andExpect(jsonPath("$.resetAvailabilityDaily").value(false)).andExpect(jsonPath("$.version").value(1));
        doGet(owner, "/audit-log?action=SETTINGS_CHANGED&entityType=SETTING&entityId=menu")
                .andExpect(jsonPath("$.items[0].before.resetAvailabilityDaily").value(true))
                .andExpect(jsonPath("$.items[0].after.resetAvailabilityDaily").value(false));
    }

    @Test
    void menuSetting_validation_staleVersion_403() throws Exception {
        doPut(owner, "/settings/menu", Map.of("version", 0)).andExpect(fieldError("resetAvailabilityDaily"));
        doPut(owner, "/settings/menu", Map.of("resetAvailabilityDaily", "false", "version", 0)).andExpect(fieldError("resetAvailabilityDaily"));
        doPut(owner, "/settings/menu", Map.of("resetAvailabilityDaily", false, "version", 5)).andExpect(problem(409, "VERSION_CONFLICT"));
        doGet(manager, "/settings/menu").andExpect(forbidden());
        doPut(manager, "/settings/menu", Map.of("resetAvailabilityDaily", false, "version", 0)).andExpect(forbidden());
    }
}
