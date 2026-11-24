package com.santhula.rms.auth;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static com.santhula.rms.support.ProblemMatchers.problem;
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
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** /terminals (P1-AUTH-04, ADR-006, lead decision on QA Q4). 403 cases use a Manager. */
class TerminalsApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;

    @BeforeEach
    void sessions() throws Exception {
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
    }

    private ResultActions register(String username, String password, String name, String type, String ip) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("credentials", Map.of("username", username, "password", password));
        body.put("name", name);
        body.put("type", type);
        return mvc.perform(post(API + "/terminals").with(r -> {
                    r.setRemoteAddr(ip);
                    return r;
                })
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }

    @Test
    void P1_AUTH_04_registerTerminal_withOwnerCredentials_noToken() throws Exception {
        String name = unique("Cashier POS ");
        register(OWNER, OWNER_PASSWORD, name, "CASHIER_POS", randomIp())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.terminal.name").value(name))
                .andExpect(jsonPath("$.terminal.type").value("CASHIER_POS"))
                .andExpect(jsonPath("$.terminal.active").value(true))
                .andExpect(jsonPath("$.terminal.version").value(0))
                .andExpect(jsonPath("$.deviceToken", Matchers.hasLength(43)));
    }

    @Test
    void registerTerminal_validation_and_duplicateName() throws Exception {
        register(OWNER, OWNER_PASSWORD, unique("K "), "KITCHEN", randomIp()).andExpect(fieldError("kitchenStationId"));
        register(OWNER, OWNER_PASSWORD, "", "ADMIN", randomIp()).andExpect(fieldError("name"));
        register(OWNER, OWNER_PASSWORD, unique("X "), "TOASTER", randomIp()).andExpect(fieldError("type"));
        String name = unique("Dup ");
        register(OWNER, OWNER_PASSWORD, name, "ADMIN", randomIp()).andExpect(status().isCreated());
        register(OWNER, OWNER_PASSWORD, name.toLowerCase(), "ADMIN", randomIp()).andExpect(problem(409, "TERMINAL_NAME_TAKEN"));
    }

    @Test
    void registerTerminal_withoutTerminalManage_is403() throws Exception {
        register(manager.username(), PASSWORD, unique("M "), "ADMIN", randomIp()).andExpect(forbidden());
    }

    @Test
    void QA_Q4_wrongCredentials_doNotLockTheOwner_butFiveFailuresFromOneIpGive429() throws Exception {
        String ip = randomIp();
        for (int i = 0; i < 5; i++) {
            register(OWNER, "wrong-password", unique("A "), "ADMIN", ip).andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        register(OWNER, OWNER_PASSWORD, unique("A "), "ADMIN", ip)
                .andExpect(problem(429, "TOO_MANY_ATTEMPTS"))
                .andExpect(header().exists("Retry-After"));
        // Another device is not affected, and the owner account is not locked.
        register(OWNER, OWNER_PASSWORD, unique("A "), "ADMIN", randomIp()).andExpect(status().isCreated());
        login(OWNER, OWNER_PASSWORD, registerTerminal("ADMIN"));
        doGet(owner, "/users/" + owner.userId()).andExpect(jsonPath("$.locked").value(false));
    }

    @Test
    void listTerminals_filtered_400_403() throws Exception {
        TerminalKey kitchen = registerTerminal("KITCHEN");
        JsonNode list = body(doGet(owner, "/terminals?type=KITCHEN&active=true").andExpect(status().isOk()));
        org.assertj.core.api.Assertions.assertThat(list.findValuesAsText("type")).containsOnly("KITCHEN");
        org.assertj.core.api.Assertions.assertThat(list.findValuesAsText("id")).contains(kitchen.id().toString());
        org.assertj.core.api.Assertions.assertThat(list.get(0).get("kitchenStationId")).isNotNull();
        doGet(owner, "/terminals?type=TOASTER").andExpect(malformed());
        doGet(manager, "/terminals").andExpect(forbidden());
    }

    @Test
    void getTerminal_ok_404_403() throws Exception {
        TerminalKey t = registerTerminal("RECEPTION_POS");
        doGet(owner, "/terminals/" + t.id()).andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("RECEPTION_POS"))
                .andExpect(jsonPath("$.deviceToken").doesNotExist());
        doGet(owner, "/terminals/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(manager, "/terminals/" + t.id()).andExpect(forbidden());
    }

    @Test
    void updateTerminal_ok_validation_staleVersion_403() throws Exception {
        TerminalKey t = registerTerminal("CASHIER_POS");
        String name = unique("Renamed ");
        String orderingPoint = body(doGet(owner, "/ordering-points")).get(1).get("id").asText();
        doPut(owner, "/terminals/" + t.id(), Map.of("name", name, "type", "RECEPTION_POS", "orderingPointId", orderingPoint, "version", 0))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value(name))
                .andExpect(jsonPath("$.type").value("RECEPTION_POS"))
                .andExpect(jsonPath("$.version").value(1));
        doPut(owner, "/terminals/" + t.id(), Map.of("name", name, "type", "ADMIN", "orderingPointId", UUID.randomUUID(), "version", 1))
                .andExpect(fieldError("orderingPointId"));
        doPut(owner, "/terminals/" + t.id(), Map.of("name", name, "type", "ADMIN", "version", 0))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(manager, "/terminals/" + t.id(), Map.of("name", name, "type", "ADMIN", "version", 1)).andExpect(forbidden());
    }

    @Test
    void deactivateTerminal_blocksLoginAndRefresh_403() throws Exception {
        TerminalKey t = registerTerminal("CASHIER_POS");
        Session s = login(OWNER, OWNER_PASSWORD, t);
        doPost(manager, "/terminals/" + t.id() + "/deactivate", null).andExpect(forbidden());
        doPost(owner, "/terminals/" + t.id() + "/deactivate", null).andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        loginRequest(OWNER, OWNER_PASSWORD, t).andExpect(problem(403, "TERMINAL_INACTIVE"));
        mvc.perform(post(API + "/auth/refresh").header("X-Terminal-Id", t.id().toString()).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("refreshToken", s.refreshToken()))))
                .andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        doPost(owner, "/terminals/bad/deactivate", null).andExpect(malformed());
    }
}
