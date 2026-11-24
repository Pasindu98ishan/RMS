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
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** /auth/* (P1-AUTH-01..05, P1-RBAC-02). */
class AuthApiIT extends IntegrationTestBase {

    // ------------------------------------------------------------------ login

    @Test
    void P1_AUTH_01_login_returnsTokensPermissionsTerminalAndIdleTimeout() throws Exception {
        TerminalKey admin = registerTerminal("ADMIN");
        loginRequest(OWNER, OWNER_PASSWORD, admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.refreshExpiresIn").value(43200))
                .andExpect(jsonPath("$.user.username").value(OWNER))
                .andExpect(jsonPath("$.user.pinSet").value(true))
                .andExpect(jsonPath("$.permissions", Matchers.hasItems("USER_MANAGE", "AUDIT_VIEW", "BILL_VOID")))
                .andExpect(jsonPath("$.permissions.length()").value(38))
                .andExpect(jsonPath("$.terminal.id").value(admin.id().toString()))
                .andExpect(jsonPath("$.terminal.type").value("ADMIN"))
                .andExpect(jsonPath("$.idleTimeoutMinutes").value(30));
    }

    @Test
    void P1_AUTH_03_kitchenTerminal_hasNoIdleTimeout() throws Exception {
        Session owner = asOwner();
        String cook = createUser(owner, SystemRole.KITCHEN, null);
        loginRequest(cook, PASSWORD, registerTerminal("KITCHEN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idleTimeoutMinutes").doesNotExist())
                .andExpect(jsonPath("$.permissions", Matchers.contains("KDS_OPERATE")));
    }

    @Test
    void login_validationError() throws Exception {
        TerminalKey t = registerTerminal("CASHIER_POS");
        mvc.perform(post(API + "/auth/login").header("X-Terminal-Id", t.id().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("password", "x", "deviceToken", t.deviceToken()))))
                .andExpect(fieldError("username"));
    }

    @Test
    void P1_AUTH_04_login_fromUnregisteredDevice_isRefused() throws Exception {
        TerminalKey real = registerTerminal("CASHIER_POS");
        loginRequest(OWNER, OWNER_PASSWORD, new TerminalKey(UUID.randomUUID(), real.deviceToken()))
                .andExpect(problem(403, "TERMINAL_NOT_REGISTERED"));
        loginRequest(OWNER, OWNER_PASSWORD, new TerminalKey(real.id(), "wrong-device-token"))
                .andExpect(problem(403, "TERMINAL_NOT_REGISTERED"));
        mvc.perform(post(API + "/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", OWNER, "password", OWNER_PASSWORD, "deviceToken", "x"))))
                .andExpect(fieldError("deviceToken"));   // a device token without the terminal header (ADR-008)
    }

    @Test
    void P1_AUTH_01_wrongPassword_fiveTimesLocksFor15Minutes_ownerCanUnlock() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");

        loginRequest(user, "nope-nope", pos).andExpect(problem(401, "INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.detail").value("Wrong username or password."));
        loginRequest("nobody-here", "nope-nope", pos).andExpect(problem(401, "INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.detail").value("Wrong username or password."));
        for (int i = 2; i <= 4; i++) {
            loginRequest(user, "nope-nope", pos).andExpect(problem(401, "INVALID_CREDENTIALS"));
        }
        loginRequest(user, "nope-nope", pos).andExpect(problem(423, "ACCOUNT_LOCKED"));
        loginRequest(user, PASSWORD, pos).andExpect(problem(423, "ACCOUNT_LOCKED"));

        UUID id = userId(owner, user);
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.locked").value(true)).andExpect(jsonPath("$.lockedUntil").exists());
        doPost(owner, "/users/" + id + "/unlock", null).andExpect(status().isOk()).andExpect(jsonPath("$.locked").value(false));
        loginRequest(user, PASSWORD, pos).andExpect(status().isOk());
    }

    @Test
    void P1_AUTH_01_lockExpiresAfter15Minutes() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        for (int i = 1; i <= 5; i++) {
            loginRequest(user, "nope-nope", pos);
        }
        loginRequest(user, PASSWORD, pos).andExpect(problem(423, "ACCOUNT_LOCKED"));
        clock.advance(Duration.ofMinutes(14));
        loginRequest(user, PASSWORD, pos).andExpect(problem(423, "ACCOUNT_LOCKED"));
        clock.advance(Duration.ofMinutes(2));
        loginRequest(user, PASSWORD, pos).andExpect(status().isOk());
    }

    @Test
    void deactivatedUser_cannotLogIn() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        doPost(owner, "/users/" + userId(owner, user) + "/deactivate", null).andExpect(status().isOk());
        loginRequest(user, PASSWORD, registerTerminal("CASHIER_POS")).andExpect(problem(401, "INVALID_CREDENTIALS"));
    }

    // ------------------------------------------------------------------ refresh

    @Test
    void P1_AUTH_02_refresh_rotatesTokens_andReuseRevokesTheFamily() throws Exception {
        Session s = asOwner();
        JsonNode first = body(refresh(s.terminalId(), s.refreshToken()).andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.permissions", Matchers.hasItem("USER_MANAGE"))));
        String next = first.get("refreshToken").asText();
        assertThat(next).isNotEqualTo(s.refreshToken());

        // The old token was used: presenting it again is treated as theft.
        refresh(s.terminalId(), s.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        refresh(s.terminalId(), next).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
    }

    @Test
    void replayedRefreshToken_endsOnlyThatSession_notTheUsersOtherSessionOnTheSameTerminal() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        Session stolen = login(user, PASSWORD, pos);
        Session other = login(user, PASSWORD, pos);

        String rotated = body(refresh(pos.id(), stolen.refreshToken()).andExpect(status().isOk())).get("refreshToken").asText();
        refresh(pos.id(), stolen.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));   // replay
        refresh(pos.id(), rotated).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));                  // that session is over
        refresh(pos.id(), other.refreshToken()).andExpect(status().isOk());                           // the other one lives
    }

    @Test
    void refresh_validationError() throws Exception {
        mvc.perform(post(API + "/auth/refresh").header("X-Terminal-Id", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(fieldError("refreshToken"));
    }

    @Test
    void refresh_fromAnotherTerminal_isRefused() throws Exception {
        Session s = asOwner();
        refresh(registerTerminal("ADMIN").id(), s.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
    }

    @Test
    void refresh_afterTwelveHours_isRefused() throws Exception {
        Session s = asOwner();
        clock.advance(Duration.ofHours(12).plusMinutes(1));
        refresh(s.terminalId(), s.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
    }

    @Test
    void P1_RBAC_02_roleChange_takesEffectOnNextRefresh() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        Session cashier = login(user, PASSWORD, registerTerminal("CASHIER_POS"));
        doGet(cashier, "/audit-log").andExpect(status().isForbidden());

        UUID id = userId(owner, user);
        int version = body(doGet(owner, "/users/" + id)).get("version").asInt();
        doPut(owner, "/users/" + id + "/roles", Map.of("roleIds", List.of(SystemRole.MANAGER.id()), "version", version))
                .andExpect(status().isOk());

        JsonNode refreshed = body(refresh(cashier.terminalId(), cashier.refreshToken()).andExpect(status().isOk()));
        assertThat(refreshed.get("permissions").toString()).contains("BILL_VOID").doesNotContain("USER_MANAGE");
    }

    // ------------------------------------------------------------------ access token

    @Test
    void P1_AUTH_02_accessToken_expiresAfter15Minutes() throws Exception {
        Session s = asOwner();
        doGet(s, "/auth/me").andExpect(status().isOk());
        clock.advance(Duration.ofMinutes(16));
        doGet(s, "/auth/me").andExpect(problem(401, "TOKEN_EXPIRED"));
    }

    @Test
    void ADR006_wrongTerminalHeader_isRefused() throws Exception {
        Session s = asOwner();
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer " + s.accessToken())
                        .header("X-Terminal-Id", UUID.randomUUID().toString()))
                .andExpect(problem(403, "TERMINAL_MISMATCH"));
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer " + s.accessToken()))
                .andExpect(problem(403, "TERMINAL_MISMATCH"));
    }

    // ------------------------------------------------------------------ logout

    @Test
    void logout_revokesRefreshToken() throws Exception {
        Session s = asOwner();
        doPost(s, "/auth/logout", Map.of("refreshToken", s.refreshToken(), "reason", "IDLE_TIMEOUT"))
                .andExpect(status().isNoContent());
        refresh(s.terminalId(), s.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        // Idempotent.
        doPost(s, "/auth/logout", Map.of("refreshToken", s.refreshToken())).andExpect(status().isNoContent());
    }

    @Test
    void logout_validationError_and_401() throws Exception {
        Session s = asOwner();
        doPost(s, "/auth/logout", Map.of("reason", "SOMETHING_ELSE", "refreshToken", "x")).andExpect(fieldError("reason"));
        doPost(s, "/auth/logout", Map.of()).andExpect(fieldError("refreshToken"));
        doPost(null, "/auth/logout", Map.of("refreshToken", "x")).andExpect(problem(401, "UNAUTHENTICATED"));
    }

    // ------------------------------------------------------------------ me

    @Test
    void me_returnsUserPermissionsAndTerminal() throws Exception {
        Session cashier = asRole(SystemRole.CASHIER);
        doGet(cashier, "/auth/me")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username").value(cashier.username()))
                .andExpect(jsonPath("$.user.roles[0].name").value("Cashier"))
                .andExpect(jsonPath("$.user.pinSet").value(false))
                .andExpect(jsonPath("$.permissions", Matchers.hasItem("BILL_PAY")))
                .andExpect(jsonPath("$.permissions", Matchers.not(Matchers.hasItem("BILL_VOID"))))
                .andExpect(jsonPath("$.terminal.type").value("CASHIER_POS"))
                .andExpect(jsonPath("$.idleTimeoutMinutes").value(10));
    }

    @Test
    void me_withoutToken_is401() throws Exception {
        doGet(null, "/auth/me").andExpect(problem(401, "UNAUTHENTICATED"));
        mvc.perform(get(API + "/auth/me").header("Authorization", "Bearer not.a.jwt"))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ own password / PIN

    @Test
    void changeOwnPassword_works_andOtherTerminalsAreLoggedOut() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        Session here = login(user, PASSWORD, registerTerminal("CASHIER_POS"));
        Session elsewhere = login(user, PASSWORD, registerTerminal("CASHIER_POS"));

        doPost(here, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", "New-pass-456"))
                .andExpect(status().isNoContent());
        loginRequest(user, PASSWORD, registerTerminal("CASHIER_POS")).andExpect(status().isUnauthorized());
        login(user, "New-pass-456", registerTerminal("CASHIER_POS"));
        refresh(here.terminalId(), here.refreshToken()).andExpect(status().isOk());
        refresh(elsewhere.terminalId(), elsewhere.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
    }

    @Test
    void BUG_1_003_changingOwnPassword_revokesOtherSessions_evenOnTheSameTerminal() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        Session first = login(user, PASSWORD, pos);
        Session second = login(user, PASSWORD, pos);   // same user, same terminal: a different session

        doPost(second, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", "New-pass-456"))
                .andExpect(status().isNoContent());

        refresh(pos.id(), first.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        refresh(pos.id(), second.refreshToken()).andExpect(status().isOk());   // the calling session stays
    }

    @Test
    void BUG_1_003_aRefreshedSessionIsStillTheCallersSession() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        Session other = login(user, PASSWORD, pos);
        Session caller = login(user, PASSWORD, pos);
        // The caller rotates its tokens first; the new access token must still identify the same session.
        JsonNode rotated = body(refresh(pos.id(), caller.refreshToken()).andExpect(status().isOk()));
        Session rotatedCaller = new Session(rotated.get("accessToken").asText(), rotated.get("refreshToken").asText(),
                pos.id(), caller.userId(), user, rotated);

        doPost(rotatedCaller, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", "New-pass-456"))
                .andExpect(status().isNoContent());

        refresh(pos.id(), other.refreshToken()).andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        refresh(pos.id(), rotatedCaller.refreshToken()).andExpect(status().isOk());
    }

    @Test
    void changeOwnPassword_validation_wrongCurrent_and401() throws Exception {
        Session s = asRole(SystemRole.CASHIER);
        doPost(s, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", "short")).andExpect(fieldError("newPassword"));
        doPost(s, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", s.username()))
                .andExpect(fieldError("newPassword"));
        doPost(s, "/auth/me/password", Map.of("currentPassword", "wrong-one", "newPassword", "New-pass-456"))
                .andExpect(fieldError("currentPassword"));
        doPost(null, "/auth/me/password", Map.of("currentPassword", PASSWORD, "newPassword", "New-pass-456"))
                .andExpect(problem(401, "UNAUTHENTICATED"));
    }

    @Test
    void changeOwnPassword_wrongCurrentCountsTowardsTheLock() throws Exception {
        Session s = asRole(SystemRole.CASHIER);
        for (int i = 1; i <= 4; i++) {
            doPost(s, "/auth/me/password", Map.of("currentPassword", "wrong-one", "newPassword", "New-pass-456"))
                    .andExpect(status().isUnprocessableEntity());
        }
        doPost(s, "/auth/me/password", Map.of("currentPassword", "wrong-one", "newPassword", "New-pass-456"))
                .andExpect(problem(423, "ACCOUNT_LOCKED"));
    }

    @Test
    void P1_AUTH_05_setOwnPin_works() throws Exception {
        Session s = asRole(SystemRole.MANAGER);
        doGet(s, "/auth/me").andExpect(jsonPath("$.user.pinSet").value(false));
        doPost(s, "/auth/me/pin", Map.of("currentPassword", PASSWORD, "newPin", "4321")).andExpect(status().isNoContent());
        doGet(s, "/auth/me").andExpect(jsonPath("$.user.pinSet").value(true));
    }

    @Test
    void setOwnPin_validation_and401() throws Exception {
        Session s = asRole(SystemRole.MANAGER);
        doPost(s, "/auth/me/pin", Map.of("currentPassword", PASSWORD, "newPin", "12a4")).andExpect(fieldError("newPin"));
        doPost(s, "/auth/me/pin", Map.of("currentPassword", PASSWORD, "newPin", "1234567")).andExpect(fieldError("newPin"));
        doPost(s, "/auth/me/pin", Map.of("currentPassword", "wrong-one", "newPin", "1234")).andExpect(fieldError("currentPassword"));
        doPost(null, "/auth/me/pin", Map.of("currentPassword", PASSWORD, "newPin", "1234")).andExpect(problem(401, "UNAUTHENTICATED"));
    }

    private org.springframework.test.web.servlet.ResultActions refresh(UUID terminalId, String refreshToken) throws Exception {
        return mvc.perform(post(API + "/auth/refresh").header("X-Terminal-Id", terminalId.toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", refreshToken))));
    }
}
