package com.santhula.rms.auth;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** /users (P1-RBAC-01/02, P1-AUTH-01, P1-AUTH-05). 403 cases use a Cashier (no USER_MANAGE). */
class UsersApiIT extends IntegrationTestBase {

    private Session owner;
    private Session cashier;

    @BeforeEach
    void sessions() throws Exception {
        owner = asOwner();
        cashier = asRole(SystemRole.CASHIER);
    }

    private Map<String, Object> newUser(String username) {
        return Map.of("username", username, "fullName", "Nimal Perera", "password", PASSWORD,
                "roleIds", List.of(SystemRole.CASHIER.id().toString()));
    }

    private UUID create(String username) throws Exception {
        return UUID.fromString(body(doPost(owner, "/users", newUser(username)).andExpect(status().isCreated())).get("id").asText());
    }

    private int version(UUID id) throws Exception {
        return body(doGet(owner, "/users/" + id)).get("version").asInt();
    }

    // ------------------------------------------------------------------ list

    @Test
    void listUsers_pagedAndFiltered() throws Exception {
        String name = uniqueUsername("lst");
        create(name);
        doGet(owner, "/users?search=" + name + "&active=true&roleId=" + SystemRole.CASHIER.id() + "&sort=username,asc&size=10")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(10))
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].username").value(name))
                .andExpect(jsonPath("$.items[0].roles[0].name").value("Cashier"))
                .andExpect(jsonPath("$.items[0].locked").value(false));
        doGet(owner, "/users?search=" + name + "&active=false").andExpect(jsonPath("$.totalItems").value(0));
        doGet(owner, "/users?search=" + name + "&roleId=" + SystemRole.MANAGER.id()).andExpect(jsonPath("$.totalItems").value(0));
    }

    @Test
    void listUsers_showsPinFlags() throws Exception {
        String name = uniqueUsername("pin");
        create(name);
        doGet(owner, "/users?search=" + name)
                .andExpect(jsonPath("$.items[0].pinSet").value(false))
                .andExpect(jsonPath("$.items[0].pinLocked").value(false))
                .andExpect(jsonPath("$.items[0].roles[0].key").value("CASHIER"));
    }

    @Test
    void listUserOptions_forAuditViewers_includesDeactivatedUsers() throws Exception {
        String name = uniqueUsername("opt");
        UUID id = create(name);
        doPost(owner, "/users/" + id + "/deactivate", null).andExpect(status().isOk());
        JsonNode options = body(doGet(owner, "/users/options").andExpect(status().isOk()));
        JsonNode mine = null;
        for (JsonNode o : options) {
            if (o.get("username").asText().equals(name)) {
                mine = o;
            }
        }
        org.assertj.core.api.Assertions.assertThat(mine).isNotNull();
        org.assertj.core.api.Assertions.assertThat(mine.get("id").asText()).isEqualTo(id.toString());
        org.assertj.core.api.Assertions.assertThat(mine.get("fullName").asText()).isEqualTo("Nimal Perera");
        org.assertj.core.api.Assertions.assertThat(mine.has("roles")).isFalse();
        // AUDIT_VIEW, not USER_MANAGE: a Cashier has neither.
        doGet(cashier, "/users/options").andExpect(forbidden());
    }

    @Test
    void listUsers_validation() throws Exception {
        doGet(owner, "/users?size=500").andExpect(fieldError("size"));
        doGet(owner, "/users?sort=password,asc").andExpect(fieldError("sort"));
        doGet(owner, "/users?roleId=not-a-uuid").andExpect(malformed());
    }

    @Test
    void listUsers_forbiddenForCashier() throws Exception {
        doGet(cashier, "/users").andExpect(forbidden());
    }

    // ------------------------------------------------------------------ create

    @Test
    void createUser_returns201_withoutSecrets() throws Exception {
        String name = uniqueUsername("new");
        doPost(owner, "/users", Map.of("username", name, "fullName", "Nimal Perera", "phone", "+94 77 123 4567",
                        "password", PASSWORD, "pin", "5555", "roleIds", List.of(SystemRole.MANAGER.id().toString())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(name))
                .andExpect(jsonPath("$.phone").value("+94 77 123 4567"))
                .andExpect(jsonPath("$.pinSet").value(true))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.roles[0].name").value("Manager"))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.lockedUntil").doesNotExist());
        login(name, PASSWORD, registerTerminal("CASHIER_POS"));
    }

    @Test
    void createUser_validation() throws Exception {
        doPost(owner, "/users", Map.of("username", "Bad Name!", "fullName", "X", "password", PASSWORD,
                "roleIds", List.of(SystemRole.CASHIER.id().toString()))).andExpect(fieldError("username"));
        doPost(owner, "/users", Map.of("username", uniqueUsername("v"), "fullName", "X", "password", "short",
                "roleIds", List.of(SystemRole.CASHIER.id().toString()))).andExpect(fieldError("password"));
        doPost(owner, "/users", Map.of("username", uniqueUsername("v"), "fullName", "X", "password", PASSWORD,
                "roleIds", List.of())).andExpect(fieldError("roleIds"));
        doPost(owner, "/users", Map.of("username", uniqueUsername("v"), "fullName", "X", "password", PASSWORD,
                "roleIds", List.of(UUID.randomUUID().toString()))).andExpect(fieldError("roleIds"));
        doPost(owner, "/users", Map.of("username", uniqueUsername("v"), "fullName", "X", "password", PASSWORD, "pin", "12",
                "roleIds", List.of(SystemRole.CASHIER.id().toString()))).andExpect(fieldError("pin"));
        doPost(owner, "/users", "{not json").andExpect(malformed());
    }

    @Test
    void createUser_duplicateUsername_is409() throws Exception {
        String name = uniqueUsername("dup");
        create(name);
        doPost(owner, "/users", newUser(name)).andExpect(problem(409, "USERNAME_TAKEN"));
    }

    @Test
    void createUser_forbiddenForCashier() throws Exception {
        doPost(cashier, "/users", newUser(uniqueUsername("f"))).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ get

    @Test
    void getUser_ok_404_400_403() throws Exception {
        UUID id = create(uniqueUsername("get"));
        doGet(owner, "/users/" + id).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()));
        doGet(owner, "/users/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(owner, "/users/not-a-uuid").andExpect(malformed());
        doGet(cashier, "/users/" + id).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ update

    @Test
    void updateUser_ok_staleVersion_validation_403() throws Exception {
        UUID id = create(uniqueUsername("upd"));
        int v = version(id);
        doPut(owner, "/users/" + id, Map.of("fullName", "Sunil Fernando", "phone", "0771234567", "version", v))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Sunil Fernando"))
                .andExpect(jsonPath("$.version").value(v + 1));
        doPut(owner, "/users/" + id, Map.of("fullName", "Again", "version", v)).andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/users/" + id, Map.of("fullName", "", "version", v + 1)).andExpect(fieldError("fullName"));
        doPut(owner, "/users/" + id, Map.of("fullName", "X")).andExpect(fieldError("version"));
        doPut(cashier, "/users/" + id, Map.of("fullName", "X", "version", v + 1)).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ deactivate / activate

    @Test
    void deactivateAndActivate() throws Exception {
        String name = uniqueUsername("act");
        UUID id = create(name);
        Session s = login(name, PASSWORD, registerTerminal("CASHIER_POS"));
        doPost(owner, "/users/" + id + "/deactivate", null).andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));
        // Sessions are revoked.
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(API + "/auth/refresh")
                        .header("X-Terminal-Id", s.terminalId().toString())
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("refreshToken", s.refreshToken()))))
                .andExpect(problem(401, "REFRESH_TOKEN_INVALID"));
        doGet(owner, "/users?active=false&search=" + name).andExpect(jsonPath("$.totalItems").value(1));

        doPost(owner, "/users/" + id + "/activate", null).andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true));
        login(name, PASSWORD, registerTerminal("CASHIER_POS"));
    }

    @Test
    void deactivate_self_is409() throws Exception {
        doPost(owner, "/users/" + owner.userId() + "/deactivate", null).andExpect(problem(409, "CANNOT_DEACTIVATE_SELF"));
    }

    @Test
    void deactivate_activate_400_404_403() throws Exception {
        UUID id = create(uniqueUsername("da"));
        doPost(owner, "/users/xyz/deactivate", null).andExpect(malformed());
        doPost(owner, "/users/" + UUID.randomUUID() + "/activate", null).andExpect(problem(404, "NOT_FOUND"));
        doPost(cashier, "/users/" + id + "/deactivate", null).andExpect(forbidden());
        doPost(cashier, "/users/" + id + "/activate", null).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ unlock

    @Test
    void unlockUser_ok_400_403() throws Exception {
        String name = uniqueUsername("unl");
        UUID id = create(name);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        for (int i = 0; i < 5; i++) {
            loginRequest(name, "wrong-pass", pos);
        }
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.locked").value(true));
        doPost(cashier, "/users/" + id + "/unlock", null).andExpect(forbidden());
        doPost(owner, "/users/" + id + "/unlock", null).andExpect(status().isOk()).andExpect(jsonPath("$.locked").value(false));
        doPost(owner, "/users/nope/unlock", null).andExpect(malformed());
    }

    // ------------------------------------------------------------------ reset password / PIN

    @Test
    void resetUserPassword_ok_validation_403() throws Exception {
        String name = uniqueUsername("rpw");
        UUID id = create(name);
        doPost(owner, "/users/" + id + "/reset-password", Map.of("newPassword", "Reset-pass-1")).andExpect(status().isNoContent());
        login(name, "Reset-pass-1", registerTerminal("CASHIER_POS"));
        doPost(owner, "/users/" + id + "/reset-password", Map.of("newPassword", "short")).andExpect(fieldError("newPassword"));
        doPost(owner, "/users/" + id + "/reset-password", Map.of("newPassword", name)).andExpect(fieldError("newPassword"));
        doPost(cashier, "/users/" + id + "/reset-password", Map.of("newPassword", "Reset-pass-2")).andExpect(forbidden());
    }

    @Test
    void resetUserPin_ok_validation_403() throws Exception {
        UUID id = create(uniqueUsername("rpn"));
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.pinSet").value(false));
        doPost(owner, "/users/" + id + "/reset-pin", Map.of("newPin", "8642")).andExpect(status().isNoContent());
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.pinSet").value(true));
        doPost(owner, "/users/" + id + "/reset-pin", Map.of("newPin", "abcd")).andExpect(fieldError("newPin"));
        doPost(cashier, "/users/" + id + "/reset-pin", Map.of("newPin", "8642")).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ roles

    @Test
    void assignUserRoles_ok_validation_staleVersion_403() throws Exception {
        UUID id = create(uniqueUsername("rol"));
        int v = version(id);
        JsonNode updated = body(doPut(owner, "/users/" + id + "/roles",
                Map.of("roleIds", List.of(SystemRole.MANAGER.id(), SystemRole.KITCHEN.id()), "version", v))
                .andExpect(status().isOk()));
        org.assertj.core.api.Assertions.assertThat(updated.get("roles").findValuesAsText("name")).containsExactly("Kitchen", "Manager");
        doPut(owner, "/users/" + id + "/roles", Map.of("roleIds", List.of(SystemRole.CASHIER.id()), "version", v))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/users/" + id + "/roles", Map.of("roleIds", List.of(), "version", v + 1)).andExpect(fieldError("roleIds"));
        doPut(cashier, "/users/" + id + "/roles", Map.of("roleIds", List.of(SystemRole.OWNER.id()), "version", v + 1))
                .andExpect(forbidden());
    }

    @Test
    void assignUserRoles_removingTheLastOwner_is409() throws Exception {
        int v = version(owner.userId());
        doPut(owner, "/users/" + owner.userId() + "/roles", Map.of("roleIds", List.of(SystemRole.MANAGER.id()), "version", v))
                .andExpect(problem(409, "LAST_OWNER"));
        doGet(owner, "/users/" + owner.userId()).andExpect(jsonPath("$.roles[*].name", Matchers.hasItem("Owner")));
    }

    @Test
    void auditTrail_isWrittenForUserChanges() throws Exception {
        UUID id = create(uniqueUsername("aud"));
        doPost(owner, "/users/" + id + "/reset-pin", Map.of("newPin", "8642"));
        mvc.perform(get(API + "/audit-log").param("entityType", "USER").param("entityId", id.toString())
                        .header("Authorization", "Bearer " + owner.accessToken())
                        .header("X-Terminal-Id", owner.terminalId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].action", Matchers.hasItems("CREATE", "PIN_RESET")))
                .andExpect(jsonPath("$.items[0].user.username").value(OWNER))
                .andExpect(jsonPath("$.items[0].terminal.id").value(owner.terminalId().toString()))
                .andExpect(jsonPath("$..pinHash").doesNotExist())
                .andExpect(jsonPath("$..passwordHash").doesNotExist());
    }
}
