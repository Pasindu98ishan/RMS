package com.santhula.rms.auth;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * M1.1 terminal registration against real stations and ordering points (P1-AUTH-04, P1-MENU-07, P1-FLOOR-02):
 * the token-less setup lookup, KITCHEN needs an active station, unknown references are 422, names in responses.
 */
class TerminalSetupIT extends IntegrationTestBase {

    private Session owner;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
    }

    private ResultActions setupOptions(String username, String password, String ip) throws Exception {
        return mvc.perform(post(API + "/terminals/setup-options").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", username, "password", password)))
                .with(r -> {
                    r.setRemoteAddr(ip);
                    return r;
                }));
    }

    private ResultActions register(Map<String, Object> details) throws Exception {
        return registerFrom(randomIp(), details);
    }

    private ResultActions registerFrom(String ip, Map<String, Object> details) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>(details);
        body.put("credentials", Map.of("username", OWNER, "password", OWNER_PASSWORD));
        return mvc.perform(post(API + "/terminals").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))
                .with(r -> {
                    r.setRemoteAddr(ip);
                    return r;
                }));
    }

    private JsonNode options() throws Exception {
        return body(setupOptions(OWNER, OWNER_PASSWORD, randomIp()).andExpect(status().isOk()));
    }

    // ------------------------------------------------------------------ setup-options (no token)

    @Test
    void setupOptions_workWithoutAToken_forTheOwner() throws Exception {
        setupOptions(OWNER, OWNER_PASSWORD, randomIp()).andExpect(status().isOk())
                .andExpect(jsonPath("$.kitchenStations.length()").value(3))
                .andExpect(jsonPath("$.kitchenStations[0].number").value(1))
                .andExpect(jsonPath("$.kitchenStations[0].name").value("Kitchen 1"))
                .andExpect(jsonPath("$.orderingPoints.length()").value(2))
                .andExpect(jsonPath("$.orderingPoints[0].name").value("Cashier"));
    }

    @Test
    void setupOptions_wrongCredentials_401_noPermission_403_validation_422() throws Exception {
        setupOptions(OWNER, "wrong-password", randomIp()).andExpect(problem(401, "INVALID_CREDENTIALS"));
        setupOptions("nobody", "whatever-1", randomIp()).andExpect(problem(401, "INVALID_CREDENTIALS"));
        String manager = createUser(owner, SystemRole.MANAGER, null);
        setupOptions(manager, PASSWORD, randomIp()).andExpect(forbidden());
        mvc.perform(post(API + "/terminals/setup-options").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(fieldError("username"));
    }

    @Test
    void setupOptions_shareTheRegistrationRateLimit_andNeverLockTheOwner() throws Exception {
        String ip = randomIp();
        for (int i = 0; i < 5; i++) {
            setupOptions(OWNER, "wrong-password", ip).andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        setupOptions(OWNER, OWNER_PASSWORD, ip).andExpect(problem(429, "TOO_MANY_ATTEMPTS")).andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.matchesPattern(".*\\d.*"))));
        // The same IP is blocked from registering too; another device is fine, and the owner can still log in.
        registerFrom(ip, Map.of("name", unique("Blocked "), "type", "ADMIN")).andExpect(problem(429, "TOO_MANY_ATTEMPTS"));
        register(Map.of("name", unique("Other "), "type", "ADMIN")).andExpect(status().isCreated());
        login(OWNER, OWNER_PASSWORD, registerTerminal("ADMIN"));
    }

    // ------------------------------------------------------------------ KITCHEN needs a station

    @Test
    void P1_AUTH_04_kitchenTerminal_registersWithAStation_andTheResponseNamesIt() throws Exception {
        JsonNode station = options().get("kitchenStations").get(1);
        JsonNode res = body(register(Map.of("name", unique("KDS "), "type", "KITCHEN", "kitchenStationId", station.get("id").asText()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.terminal.kitchenStationId").value(station.get("id").asText()))
                .andExpect(jsonPath("$.terminal.kitchenStationName").value("Kitchen 2")));
        String terminalId = res.at("/terminal/id").asText();
        doGet(owner, "/terminals/" + terminalId).andExpect(jsonPath("$.kitchenStationName").value("Kitchen 2"));
        doGet(owner, "/terminals?type=KITCHEN").andExpect(jsonPath("$[0].kitchenStationName").value("Kitchen 2"));
    }

    @Test
    void kitchenTerminal_withoutAStation_oranUnknownOne_isRefused() throws Exception {
        register(Map.of("name", unique("KDS "), "type", "KITCHEN")).andExpect(fieldError("kitchenStationId"));
        register(Map.of("name", unique("KDS "), "type", "KITCHEN", "kitchenStationId", UUID.randomUUID().toString()))
                .andExpect(fieldError("kitchenStationId"));
        register(Map.of("name", unique("POS "), "type", "CASHIER_POS", "kitchenStationId", options().get("kitchenStations").get(0).get("id").asText()))
                .andExpect(fieldError("kitchenStationId"));
    }

    @Test
    void aSwitchedOffStation_cannotBeChosen_andDropsOutOfTheSetupChoices() throws Exception {
        JsonNode station = options().get("kitchenStations").get(2);
        String id = station.get("id").asText();
        doPut(owner, "/kitchen-stations/" + id, Map.of("name", "Kitchen 3", "targetPrepMinutes", 10, "active", false, "version", 0)).andExpect(status().isOk());

        register(Map.of("name", unique("KDS "), "type", "KITCHEN", "kitchenStationId", id)).andExpect(fieldError("kitchenStationId"));
        assertThat(options().get("kitchenStations")).hasSize(2);
    }

    @Test
    void updatingATerminal_checksTheStationAgain_andShowsTheNewName() throws Exception {
        JsonNode stations = options().get("kitchenStations");
        String terminalId = body(register(Map.of("name", unique("KDS "), "type", "KITCHEN", "kitchenStationId", stations.get(0).get("id").asText()))
                .andExpect(status().isCreated())).at("/terminal/id").asText();
        Map<String, Object> update = new LinkedHashMap<>();
        update.put("name", unique("KDS moved "));
        update.put("type", "KITCHEN");
        update.put("kitchenStationId", stations.get(2).get("id").asText());
        update.put("version", 0);
        doPut(owner, "/terminals/" + terminalId, update).andExpect(status().isOk()).andExpect(jsonPath("$.kitchenStationName").value("Kitchen 3"));
        update.put("kitchenStationId", UUID.randomUUID().toString());
        update.put("version", 1);
        doPut(owner, "/terminals/" + terminalId, update).andExpect(fieldError("kitchenStationId"));
    }

    // ------------------------------------------------------------------ ordering points

    @Test
    void posTerminal_withAnOrderingPoint_isRegistered_andTheSessionKnowsIt() throws Exception {
        JsonNode reception = options().get("orderingPoints").get(1);
        JsonNode res = body(register(Map.of("name", unique("POS "), "type", "RECEPTION_POS", "orderingPointId", reception.get("id").asText()))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.terminal.orderingPointName").value("Reception")));
        TerminalKey key = new TerminalKey(UUID.fromString(res.at("/terminal/id").asText()), res.get("deviceToken").asText());
        String user = createUser(owner, SystemRole.RECEPTIONIST, null);

        loginRequest(user, PASSWORD, key).andExpect(status().isOk())
                .andExpect(jsonPath("$.terminal.orderingPointId").value(reception.get("id").asText()))
                .andExpect(jsonPath("$.terminal.orderingPointName").value("Reception"));
        Session session = login(user, PASSWORD, key);
        doGet(session, "/auth/me").andExpect(jsonPath("$.terminal.orderingPointName").value("Reception"));
    }

    @Test
    void anUnknownOrderingPoint_orOneOnANonPosTerminal_isRefused() throws Exception {
        register(Map.of("name", unique("POS "), "type", "CASHIER_POS", "orderingPointId", UUID.randomUUID().toString()))
                .andExpect(fieldError("orderingPointId"));
        register(Map.of("name", unique("ADM "), "type", "ADMIN", "orderingPointId", options().get("orderingPoints").get(0).get("id").asText()))
                .andExpect(fieldError("orderingPointId"));
    }

    @Test
    void terminalSetupStillWorksWithoutAnOrderingPoint() throws Exception {
        register(Map.of("name", unique("POS "), "type", "CASHIER_POS")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.terminal.orderingPointId").doesNotExist());
    }
}
