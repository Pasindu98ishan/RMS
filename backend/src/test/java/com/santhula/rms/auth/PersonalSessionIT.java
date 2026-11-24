package com.santhula.rms.auth;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Personal sessions without a terminal (client decision #9, ADR-008; P1-AUTH-03, P1-AUTH-04, P1-AUD-01):
 * who may log in without a terminal, lock counting, the header rules, refresh, the personal idle timeout and
 * client_info on audit rows.
 */
class PersonalSessionIT extends IntegrationTestBase {

    private Session owner;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
    }

    private ResultActions refresh(String refreshToken, UUID terminalId) throws Exception {
        var req = post(API + "/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", refreshToken)));
        if (terminalId != null) {
            req.header("X-Terminal-Id", terminalId.toString());
        }
        return mvc.perform(req);
    }

    private static JsonNode claims(String jwt) throws Exception {
        String payload = jwt.split("\\.")[1];
        return new com.fasterxml.jackson.databind.ObjectMapper().readTree(Base64.getUrlDecoder().decode(payload));
    }

    // ------------------------------------------------------------------ who may log in without a terminal

    @Test
    void ADR008_personalLogin_allowedForOwnerManagerRiderInventoryHr() throws Exception {
        personalLoginRequest(OWNER, OWNER_PASSWORD)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionType").value("PERSONAL"))
                .andExpect(jsonPath("$.terminal").doesNotExist())
                .andExpect(jsonPath("$.idleTimeoutMinutes").value(30))
                .andExpect(jsonPath("$.permissions", org.hamcrest.Matchers.hasItem("LOGIN_ANY_DEVICE")));
        for (SystemRole role : List.of(SystemRole.MANAGER, SystemRole.RIDER, SystemRole.INVENTORY, SystemRole.HR)) {
            String user = createUser(owner, role, null);
            Session s = loginPersonal(user, PASSWORD);
            assertThat(s.body().get("sessionType").asText()).as(role.name()).isEqualTo("PERSONAL");
            assertThat(claims(s.accessToken()).has("tid")).as("no terminal claim for " + role).isFalse();
            doGet(s, "/auth/me")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.sessionType").value("PERSONAL"))
                    .andExpect(jsonPath("$.terminal").doesNotExist())
                    .andExpect(jsonPath("$.idleTimeoutMinutes").value(30));
        }
    }

    @Test
    void ADR008_cashierReceptionKitchen_needATerminal_butStillLogInOnOne() throws Exception {
        for (SystemRole role : List.of(SystemRole.CASHIER, SystemRole.RECEPTIONIST, SystemRole.KITCHEN)) {
            String user = createUser(owner, role, null);
            personalLoginRequest(user, PASSWORD)
                    .andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"))
                    .andExpect(jsonPath("$.detail").value("This account can only sign in on a registered counter or kitchen device."));
            TerminalKey device = registerTerminal(role == SystemRole.KITCHEN ? "KITCHEN" : "CASHIER_POS");
            loginRequest(user, PASSWORD, device)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.sessionType").value("TERMINAL"))
                    .andExpect(jsonPath("$.terminal.id").value(device.id().toString()));
        }
        // A terminal login of a personal-capable user is still a TERMINAL session.
        assertThat(owner.body().get("sessionType").asText()).isEqualTo("TERMINAL");
        doGet(owner, "/auth/me").andExpect(jsonPath("$.sessionType").value("TERMINAL")).andExpect(jsonPath("$.terminal.id").exists());
    }

    @Test
    void ADR008_terminalRequiredForUser_doesNotCountTowardsTheLock_butWrongPasswordsDo() throws Exception {
        String cashier = createUser(owner, SystemRole.CASHIER, null);
        for (int i = 0; i < 6; i++) {
            personalLoginRequest(cashier, PASSWORD).andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"));
        }
        UUID id = userId(owner, cashier);
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.locked").value(false));
        loginRequest(cashier, PASSWORD, registerTerminal("CASHIER_POS")).andExpect(status().isOk());

        // Q39: the refused login had the RIGHT password, so it resets the failed-attempt counter like any correct check.
        for (int i = 1; i <= 3; i++) {
            personalLoginRequest(cashier, "wrong-wrong").andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        personalLoginRequest(cashier, PASSWORD).andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"));

        // Wrong passwords without a terminal count exactly as before: the 5th locks.
        for (int i = 1; i <= 4; i++) {
            personalLoginRequest(cashier, "wrong-wrong").andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        personalLoginRequest(cashier, "wrong-wrong").andExpect(problem(423, "ACCOUNT_LOCKED"));
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.locked").value(true));

        String manager = createUser(owner, SystemRole.MANAGER, null);
        for (int i = 1; i <= 4; i++) {
            personalLoginRequest(manager, "wrong-wrong").andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        personalLoginRequest(manager, "wrong-wrong").andExpect(problem(423, "ACCOUNT_LOCKED"));
        personalLoginRequest(manager, PASSWORD).andExpect(problem(423, "ACCOUNT_LOCKED"));
    }

    @Test
    void ADR008_headerAndDeviceToken_bothOrNeither() throws Exception {
        TerminalKey pos = registerTerminal("CASHIER_POS");
        mvc.perform(post(API + "/auth/login").header("X-Terminal-Id", pos.id().toString()).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", OWNER, "password", OWNER_PASSWORD))))
                .andExpect(fieldError("deviceToken"));
        mvc.perform(post(API + "/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", OWNER, "password", OWNER_PASSWORD, "deviceToken", pos.deviceToken()))))
                .andExpect(fieldError("deviceToken"));
    }

    @Test
    void BUG_1_009_headerWithEmptyBody_reportsDeviceTokenWithTheOtherFieldErrors() throws Exception {
        TerminalKey pos = registerTerminal("CASHIER_POS");
        mvc.perform(post(API + "/auth/login").header("X-Terminal-Id", pos.id().toString())
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(problem(422, "VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors.length()").value(3))
                .andExpect(jsonPath("$.fieldErrors[*].field", org.hamcrest.Matchers.containsInAnyOrder("username", "password", "deviceToken")));
        // No header and no device token: a personal login, so only the missing credentials are reported.
        mvc.perform(post(API + "/auth/login").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(problem(422, "VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[*].field", org.hamcrest.Matchers.containsInAnyOrder("username", "password")));
        // A device token without the header, with a missing password: both reported.
        mvc.perform(post(API + "/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", OWNER, "deviceToken", pos.deviceToken()))))
                .andExpect(jsonPath("$.fieldErrors[*].field", org.hamcrest.Matchers.containsInAnyOrder("password", "deviceToken")));
    }

    // ------------------------------------------------------------------ header rules

    @Test
    void ADR008_headerMustMatchTheSessionKind_bothWays() throws Exception {
        Session personal = loginPersonal(OWNER, OWNER_PASSWORD);
        doGet(personal, "/users").andExpect(status().isOk());            // unmarked operations work in a personal session
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer " + personal.accessToken())
                        .header("X-Terminal-Id", owner.terminalId().toString()))
                .andExpect(problem(403, "TERMINAL_MISMATCH"));
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer " + owner.accessToken()))
                .andExpect(problem(403, "TERMINAL_MISMATCH"));
    }

    // ------------------------------------------------------------------ refresh

    @Test
    void ADR008_refresh_mustMatchTheSessionKind() throws Exception {
        Session personal = loginPersonal(OWNER, OWNER_PASSWORD);
        refresh(personal.refreshToken(), owner.terminalId()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));

        // Q41: a refresh refused only for the header is a malformed request, not theft: the token still works.
        JsonNode next = body(refresh(personal.refreshToken(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionType").value("PERSONAL"))
                .andExpect(jsonPath("$.terminal").doesNotExist())
                .andExpect(jsonPath("$.idleTimeoutMinutes").value(30)));
        assertThat(claims(next.get("accessToken").asText()).has("tid")).isFalse();

        Session terminal = login(OWNER, OWNER_PASSWORD, registerTerminal("ADMIN"));
        refresh(terminal.refreshToken(), null).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        refresh(terminal.refreshToken(), UUID.randomUUID()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        refresh(terminal.refreshToken(), terminal.terminalId()).andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionType").value("TERMINAL"));
    }

    @Test
    void ADR008_refresh_afterLoginAnyDeviceIsRevoked_endsThePersonalSession() throws Exception {
        JsonNode role = body(doPost(owner, "/roles", Map.of("name", unique("Remote "), "permissionCodes", List.of("LOGIN_ANY_DEVICE", "AUDIT_VIEW")))
                .andExpect(status().isCreated()));
        String username = uniqueUsername("rem");
        doPost(owner, "/users", Map.of("username", username, "fullName", "Remote worker", "password", PASSWORD,
                "roleIds", List.of(role.get("id").asText()))).andExpect(status().isCreated());
        Session s = loginPersonal(username, PASSWORD);
        JsonNode first = body(refresh(s.refreshToken(), null).andExpect(status().isOk()));

        doPut(owner, "/roles/" + role.get("id").asText(), Map.of("name", role.get("name").asText(),
                "permissionCodes", List.of("AUDIT_VIEW"), "version", role.get("version").asInt())).andExpect(status().isOk());

        refresh(first.get("refreshToken").asText(), null).andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"));
        // Q40: the access token already issued stays valid until it expires (<= 15 min, as ADR-006 #11).
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer " + first.get("accessToken").asText()))
                .andExpect(status().isOk());
        // The session has ended: nothing issued for it works any more.
        refresh(first.get("refreshToken").asText(), null).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        personalLoginRequest(username, PASSWORD).andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"));
    }

    // ------------------------------------------------------------------ idle timeout setting

    @Test
    void ADR008_personalIdleTimeout_isASetting_default30() throws Exception {
        JsonNode settings = body(doGet(owner, "/settings/idle-timeouts")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idleTimeoutPersonalMinutes").value(30)));
        List<Map<String, Object>> rules = List.of(
                Map.of("terminalType", "CASHIER_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "RECEPTION_POS", "idleTimeoutMinutes", 10),
                Map.of("terminalType", "ADMIN", "idleTimeoutMinutes", 30));
        int v = settings.get("version").asInt();
        doPut(owner, "/settings/idle-timeouts", Map.of("rules", rules, "idleTimeoutPersonalMinutes", 45, "version", v))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idleTimeoutPersonalMinutes").value(45));
        personalLoginRequest(OWNER, OWNER_PASSWORD).andExpect(jsonPath("$.idleTimeoutMinutes").value(45));
        // Absent: the personal value is kept.
        doPut(owner, "/settings/idle-timeouts", Map.of("rules", rules, "version", v + 1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idleTimeoutPersonalMinutes").value(45));
        doPut(owner, "/settings/idle-timeouts", Map.of("rules", rules, "idleTimeoutPersonalMinutes", 0, "version", v + 2))
                .andExpect(fieldError("idleTimeoutPersonalMinutes"));
    }

    // ------------------------------------------------------------------ audit

    @Test
    void ADR008_auditRows_storeClientInfo_andNoTerminalInAPersonalSession() throws Exception {
        String manager = createUser(owner, SystemRole.MANAGER, null);
        mvc.perform(post(API + "/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .header("User-Agent", "JUnit-Browser/1.0 (Test)")
                        .with(r -> {
                            r.setRemoteAddr("203.0.113.9");
                            return r;
                        })
                        .content(json.writeValueAsString(Map.of("username", manager, "password", PASSWORD))))
                .andExpect(status().isOk());
        UUID id = userId(owner, manager);
        doGet(owner, "/audit-log?action=LOGIN&userId=" + id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].clientInfo").value("203.0.113.9 | JUnit-Browser/1.0 (Test)"))
                .andExpect(jsonPath("$.items[0].terminal").doesNotExist());

        // Terminal sessions store it too, next to the terminal.
        String cashier = createUser(owner, SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        loginRequest(cashier, PASSWORD, pos).andExpect(status().isOk());
        doGet(owner, "/audit-log?action=LOGIN&userId=" + userId(owner, cashier))
                .andExpect(jsonPath("$.items[0].clientInfo").value("127.0.0.1"))
                .andExpect(jsonPath("$.items[0].terminal.id").value(pos.id().toString()));

        // A refused personal login is audited with the reason.
        personalLoginRequest(cashier, PASSWORD).andExpect(problem(403, "TERMINAL_REQUIRED_FOR_USER"));
        doGet(owner, "/audit-log?action=LOGIN_FAILED&userId=" + userId(owner, cashier))
                .andExpect(jsonPath("$.items[0].reason").value("TERMINAL_REQUIRED_FOR_USER"))
                .andExpect(jsonPath("$.items[0].clientInfo").exists());
    }
}
