package com.santhula.rms.settings;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** /settings/* (P1-SET-01..04, P1-AUTH-03). 403 cases use a Manager (no SETTINGS_MANAGE). */
class SettingsApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;

    @BeforeEach
    void sessions() throws Exception {
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
    }

    private int version(String path) throws Exception {
        return body(doGet(owner, path).andExpect(status().isOk())).get("version").asInt();
    }

    // ------------------------------------------------------------------ restaurant

    @Test
    void P1_SET_03_restaurantDetails_getUpdate() throws Exception {
        doGet(owner, "/settings/restaurant").andExpect(status().isOk()).andExpect(jsonPath("$.name").isNotEmpty());
        int v = version("/settings/restaurant");
        doPut(owner, "/settings/restaurant", Map.of("name", "Santhula Hotel", "address", "No. 12, Main Street\nNetolpitiya",
                        "phone", "+94 47 222 3344", "receiptFooter", "Thank you!", "version", v))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.address").value("No. 12, Main Street\nNetolpitiya"))
                .andExpect(jsonPath("$.receiptFooter").value("Thank you!"))
                .andExpect(jsonPath("$.version").value(v + 1))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());
        doGet(owner, "/audit-log?action=SETTINGS_CHANGED&entityType=SETTING&entityId=restaurant")
                .andExpect(jsonPath("$.items[0].after.phone").value("+94 47 222 3344"))
                .andExpect(jsonPath("$.items[0].before").exists());
    }

    @Test
    void restaurantDetails_validation_staleVersion_403() throws Exception {
        int v = version("/settings/restaurant");
        doPut(owner, "/settings/restaurant", Map.of("name", "", "address", "a", "phone", "1", "version", v)).andExpect(fieldError("name"));
        doPut(owner, "/settings/restaurant", Map.of("name", "n", "address", "a", "phone", "1", "version", v - 1 < 0 ? 999 : v - 1))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doGet(manager, "/settings/restaurant").andExpect(forbidden());
        doPut(manager, "/settings/restaurant", Map.of("name", "n", "address", "a", "phone", "1", "version", v)).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ service charge

    @Test
    void P1_SET_01_serviceCharges_getUpdate_moneyAsStrings() throws Exception {
        doGet(owner, "/settings/service-charges")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules.length()").value(3))
                .andExpect(jsonPath("$.rules[0].orderType").value("DINE_IN"))
                .andExpect(jsonPath("$.rules[0].rate").isString());
        int v = version("/settings/service-charges");
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                        Map.of("orderType", "DINE_IN", "rate", "10.00"),
                        Map.of("orderType", "TAKEAWAY", "rate", "0.00"),
                        Map.of("orderType", "DELIVERY", "rate", "2.50"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[0].rate").value("10.00"))
                .andExpect(jsonPath("$.rules[1].rate").value("0.00"))
                .andExpect(jsonPath("$.rules[2].rate").value("2.50"))
                .andExpect(jsonPath("$.version").value(v + 1));
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                        Map.of("orderType", "DINE_IN", "rate", "1.00"),
                        Map.of("orderType", "TAKEAWAY", "rate", "0.00"),
                        Map.of("orderType", "DELIVERY", "rate", "0.00"))))
                .andExpect(problem(409, "VERSION_CONFLICT"));
    }

    @Test
    void serviceCharges_validation_403() throws Exception {
        int v = version("/settings/service-charges");
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                Map.of("orderType", "DINE_IN", "rate", "10.00"),
                Map.of("orderType", "DINE_IN", "rate", "0.00"),
                Map.of("orderType", "DELIVERY", "rate", "0.00")))).andExpect(fieldError("rules[1].orderType"));
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                Map.of("orderType", "DINE_IN", "rate", "100.01"),
                Map.of("orderType", "TAKEAWAY", "rate", "0.00"),
                Map.of("orderType", "DELIVERY", "rate", "0.00")))).andExpect(fieldError("rules[0].rate"));
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                Map.of("orderType", "DINE_IN", "rate", "1.00")))).andExpect(fieldError("rules"));
        doGet(manager, "/settings/service-charges").andExpect(forbidden());
    }

    // ------------------------------------------------------------------ BUG-1-005: what the contract forbids is rejected

    @Test
    void BUG_1_005_serviceChargeRate_mustBeATextWithExactlyTwoDecimals() throws Exception {
        int v = version("/settings/service-charges");
        for (Object bad : new Object[] {"5", "1e2", "5.0", "10.555", "", " 5.00", 5, 5.0}) {
            doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                            Map.of("orderType", "DINE_IN", "rate", bad),
                            Map.of("orderType", "TAKEAWAY", "rate", "0.00"),
                            Map.of("orderType", "DELIVERY", "rate", "0.00"))))
                    .andExpect(fieldError("rules[0].rate"));
        }
        // Nothing was stored by the rejected calls.
        doGet(owner, "/settings/service-charges").andExpect(jsonPath("$.version").value(v));
        doPut(owner, "/settings/service-charges", Map.of("version", v, "rules", List.of(
                        Map.of("orderType", "DINE_IN", "rate", "5.00"),
                        Map.of("orderType", "TAKEAWAY", "rate", "0.00"),
                        Map.of("orderType", "DELIVERY", "rate", "0.00"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.rules[0].rate").value("5.00"));
    }

    @Test
    void BUG_1_005_taxRate_isCheckedTheSameWay() throws Exception {
        int v = version("/settings/tax");
        doPut(owner, "/settings/tax", Map.of("enabled", false, "rate", "5", "version", v)).andExpect(fieldError("rate"));
        doPut(owner, "/settings/tax", Map.of("enabled", false, "rate", 0, "version", v)).andExpect(fieldError("rate"));
    }

    @Test
    void BUG_1_005_idleTimeout_mustBeAnInteger_7point5IsNotCutTo7() throws Exception {
        int v = version("/settings/idle-timeouts");
        for (String bad : new String[] {"7.5", "7.0", "\"7\""}) {
            doPut(owner, "/settings/idle-timeouts", """
                    {"version": %d, "rules": [
                      {"terminalType": "CASHIER_POS", "idleTimeoutMinutes": %s},
                      {"terminalType": "RECEPTION_POS", "idleTimeoutMinutes": 10},
                      {"terminalType": "ADMIN", "idleTimeoutMinutes": 30}]}""".formatted(v, bad))
                    .andExpect(fieldError("rules[0].idleTimeoutMinutes"));
        }
        doGet(owner, "/settings/idle-timeouts").andExpect(jsonPath("$.version").value(v));
    }

    @Test
    void BUG_1_005_aVersionSentAsTextOrFraction_isRejected() throws Exception {
        int v = version("/settings/business-day");
        doPut(owner, "/settings/business-day", "{\"dayStartTime\": \"06:00\", \"version\": \"" + v + "\"}").andExpect(fieldError("version"));
        doPut(owner, "/settings/business-day", "{\"dayStartTime\": \"06:00\", \"version\": " + v + ".5}").andExpect(fieldError("version"));
    }

    // ------------------------------------------------------------------ tax

    @Test
    void P1_SET_02_tax_isOffWithRateZero_andCannotBeEnabled() throws Exception {
        doGet(owner, "/settings/tax").andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.rate").value("0.00"));
        int v = version("/settings/tax");
        doPut(owner, "/settings/tax", Map.of("enabled", false, "rate", "0.00", "label", "VAT", "version", v))
                .andExpect(status().isOk()).andExpect(jsonPath("$.label").value("VAT"));
        doPut(owner, "/settings/tax", Map.of("enabled", true, "rate", "18.00", "version", v + 1))
                .andExpect(problem(409, "TAX_NOT_SUPPORTED"));
        doPut(owner, "/settings/tax", Map.of("enabled", false, "rate", "-1.00", "version", v + 1)).andExpect(fieldError("rate"));
        doPut(owner, "/settings/tax", Map.of("rate", "0.00", "version", v + 1)).andExpect(fieldError("enabled"));
        doGet(manager, "/settings/tax").andExpect(forbidden());
        doPut(manager, "/settings/tax", Map.of("enabled", false, "rate", "0", "version", v + 1)).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ business day

    @Test
    void P1_SET_04_businessDay_getUpdate_validation_403() throws Exception {
        doGet(owner, "/settings/business-day").andExpect(status().isOk())
                .andExpect(jsonPath("$.timeZone").value("Asia/Colombo"))
                .andExpect(jsonPath("$.dayStartTime", Matchers.matchesPattern("\\d\\d:\\d\\d")));
        int v = version("/settings/business-day");
        doPut(owner, "/settings/business-day", Map.of("dayStartTime", "05:30", "version", v))
                .andExpect(status().isOk()).andExpect(jsonPath("$.dayStartTime").value("05:30"));
        doPut(owner, "/settings/business-day", Map.of("dayStartTime", "25:00", "version", v + 1)).andExpect(fieldError("dayStartTime"));
        doGet(manager, "/settings/business-day").andExpect(forbidden());
        doPut(manager, "/settings/business-day", Map.of("dayStartTime", "06:00", "version", v + 1)).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ idle timeouts

    @Test
    void P1_AUTH_03_idleTimeouts_getUpdate_andLoginReflectsThem() throws Exception {
        JsonNode current = body(doGet(owner, "/settings/idle-timeouts").andExpect(status().isOk())
                .andExpect(jsonPath("$.rules.length()").value(5))
                .andExpect(jsonPath("$.rules[?(@.terminalType=='KITCHEN')].exempt").value(Matchers.contains(true)))
                .andExpect(jsonPath("$.rules[?(@.terminalType=='KITCHEN')].idleTimeoutMinutes").isEmpty()));
        int v = current.get("version").asInt();
        doPut(owner, "/settings/idle-timeouts", Map.of("version", v, "rules", List.of(
                        Map.of("terminalType", "CASHIER_POS", "idleTimeoutMinutes", 12),
                        Map.of("terminalType", "RECEPTION_POS", "idleTimeoutMinutes", 10),
                        Map.of("terminalType", "ADMIN", "idleTimeoutMinutes", 30))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[?(@.terminalType=='CASHIER_POS')].idleTimeoutMinutes").value(Matchers.contains(12)));
        loginRequest(OWNER, OWNER_PASSWORD, registerTerminal("CASHIER_POS")).andExpect(jsonPath("$.idleTimeoutMinutes").value(12));

        doPut(owner, "/settings/idle-timeouts", Map.of("version", v + 1, "rules", List.of(
                Map.of("terminalType", "CASHIER_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "RECEPTION_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "ADMIN", "idleTimeoutMinutes", 30)))).andExpect(status().isOk());
    }

    @Test
    void idleTimeouts_validation_403() throws Exception {
        int v = version("/settings/idle-timeouts");
        doPut(owner, "/settings/idle-timeouts", Map.of("version", v, "rules", List.of(
                Map.of("terminalType", "KITCHEN", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "RECEPTION_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "ADMIN", "idleTimeoutMinutes", 30)))).andExpect(fieldError("rules[0].terminalType"));
        doPut(owner, "/settings/idle-timeouts", Map.of("version", v, "rules", List.of(
                Map.of("terminalType", "CASHIER_POS", "idleTimeoutMinutes", 0),
                Map.of("terminalType", "RECEPTION_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "ADMIN", "idleTimeoutMinutes", 30)))).andExpect(fieldError("rules[0].idleTimeoutMinutes"));
        doGet(manager, "/settings/idle-timeouts").andExpect(forbidden());
        doPut(manager, "/settings/idle-timeouts", Map.of("version", v, "rules", List.of())).andExpect(forbidden());
    }
}
