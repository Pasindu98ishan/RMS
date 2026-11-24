package com.santhula.rms.auth;

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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** /roles and /permissions (P1-RBAC-01/02). 403 cases use a Manager (no ROLE_MANAGE). */
class RolesApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;

    @BeforeEach
    void sessions() throws Exception {
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
    }

    private JsonNode createRole(String name, List<String> codes) throws Exception {
        return body(doPost(owner, "/roles", Map.of("name", name, "description", "test", "permissionCodes", codes))
                .andExpect(status().isCreated()));
    }

    @Test
    void P1_RBAC_01_listRoles_systemRolesFirst_withCounts() throws Exception {
        JsonNode roles = body(doGet(owner, "/roles").andExpect(status().isOk()));
        List<String> names = new ArrayList<>();
        roles.forEach(r -> names.add(r.get("name").asText()));
        assertThat(names.subList(0, 8)).containsExactly("Owner", "Manager", "Cashier", "Receptionist", "Kitchen", "Rider", "Inventory", "HR");
        assertThat(roles.get(0).get("permissionCount").asInt()).isEqualTo(38);
        assertThat(roles.get(0).get("userCount").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(roles.get(0).get("system").asBoolean()).isTrue();
        doGet(manager, "/roles").andExpect(forbidden());
    }

    @Test
    void P1_RBAC_01_seededGrantsMatchThePermissionMatrix() throws Exception {
        doGet(owner, "/roles/" + SystemRole.CASHIER.id())
                .andExpect(jsonPath("$.permissionCodes.length()").value(16))
                .andExpect(jsonPath("$.permissionCodes", Matchers.hasItems("BILL_PAY", "DISCOUNT_STAFF", "KDS_VIEW_ALL", "SHIFT_OPERATE")))
                .andExpect(jsonPath("$.permissionCodes", Matchers.not(Matchers.hasItems("BILL_VOID", "REFUND", "USER_MANAGE"))));
        doGet(owner, "/roles/" + SystemRole.MANAGER.id())
                .andExpect(jsonPath("$.permissionCodes.length()").value(30))
                .andExpect(jsonPath("$.permissionCodes", Matchers.hasItems("BILL_VOID", "REFUND", "DAY_END", "SHIFT_APPROVE")))
                .andExpect(jsonPath("$.permissionCodes", Matchers.not(Matchers.hasItems("DISCOUNT_OWNER", "SETTINGS_MANAGE", "AUDIT_VIEW"))));
        doGet(owner, "/roles/" + SystemRole.RECEPTIONIST.id()).andExpect(jsonPath("$.permissionCodes.length()").value(13));
        doGet(owner, "/roles/" + SystemRole.KITCHEN.id()).andExpect(jsonPath("$.permissionCodes", Matchers.contains("KDS_OPERATE")));
        doGet(owner, "/roles/" + SystemRole.RIDER.id()).andExpect(jsonPath("$.permissionCodes", Matchers.contains("LOGIN_ANY_DEVICE")));
    }

    @Test
    void P1_RBAC_02_createRole_ok_duplicate_validation_403() throws Exception {
        String name = unique("Senior Cashier ");
        JsonNode role = createRole(name, List.of("ORDER_CREATE", "FLOOR_MANAGE"));
        assertThat(role.get("system").asBoolean()).isFalse();
        assertThat(role.get("permissionCodes").toString()).contains("ORDER_CREATE", "FLOOR_MANAGE");
        assertThat(role.get("version").asInt()).isZero();

        doPost(owner, "/roles", Map.of("name", name.toUpperCase(), "permissionCodes", List.of())).andExpect(problem(409, "ROLE_NAME_TAKEN"));
        doPost(owner, "/roles", Map.of("name", "", "permissionCodes", List.of())).andExpect(fieldError("name"));
        doPost(owner, "/roles", Map.of("name", unique("R"), "permissionCodes", List.of("NOT_A_PERMISSION")))
                .andExpect(fieldError("permissionCodes[0]"));
        doPost(owner, "/roles", Map.of("name", unique("R"))).andExpect(fieldError("permissionCodes"));
        doPost(manager, "/roles", Map.of("name", unique("R"), "permissionCodes", List.of())).andExpect(forbidden());
    }

    @Test
    void getRole_ok_404_400_403() throws Exception {
        doGet(owner, "/roles/" + SystemRole.OWNER.id()).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Owner"));
        doGet(owner, "/roles/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));
        doGet(owner, "/roles/abc").andExpect(malformed());
        doGet(manager, "/roles/" + SystemRole.OWNER.id()).andExpect(forbidden());
    }

    @Test
    void updateRole_ok_staleVersion_validation_403() throws Exception {
        JsonNode role = createRole(unique("Floor "), List.of("FLOOR_MANAGE"));
        String id = role.get("id").asText();
        String renamed = unique("Floor lead ");
        doPut(owner, "/roles/" + id, Map.of("name", renamed, "permissionCodes", List.of("FLOOR_MANAGE", "ORDER_VIEW"), "version", 0))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value(renamed))
                .andExpect(jsonPath("$.permissionCodes.length()").value(2))
                .andExpect(jsonPath("$.version").value(1));
        doPut(owner, "/roles/" + id, Map.of("name", renamed, "permissionCodes", List.of(), "version", 0))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doPut(owner, "/roles/" + id, Map.of("name", renamed, "permissionCodes", List.of())).andExpect(fieldError("version"));
        doPut(manager, "/roles/" + id, Map.of("name", renamed, "permissionCodes", List.of(), "version", 1)).andExpect(forbidden());
    }

    @Test
    void systemRoles_keepTheirName_butPermissionsCanChange_exceptOwner() throws Exception {
        JsonNode rider = body(doGet(owner, "/roles/" + SystemRole.RIDER.id()));
        int v = rider.get("version").asInt();
        doPut(owner, "/roles/" + SystemRole.RIDER.id(), Map.of("name", "Delivery", "permissionCodes", List.of(), "version", v))
                .andExpect(problem(409, "SYSTEM_ROLE_READ_ONLY"));
        doPut(owner, "/roles/" + SystemRole.RIDER.id(), Map.of("name", "Rider", "permissionCodes", List.of("ORDER_VIEW"), "version", v))
                .andExpect(status().isOk()).andExpect(jsonPath("$.permissionCodes", Matchers.contains("ORDER_VIEW")));
        // Back to the seeded grants (V9), so the matrix test sees them whatever the order.
        doPut(owner, "/roles/" + SystemRole.RIDER.id(), Map.of("name", "Rider", "permissionCodes", List.of("LOGIN_ANY_DEVICE"), "version", v + 1))
                .andExpect(status().isOk());

        int ownerVersion = body(doGet(owner, "/roles/" + SystemRole.OWNER.id())).get("version").asInt();
        doPut(owner, "/roles/" + SystemRole.OWNER.id(), Map.of("name", "Owner", "permissionCodes", List.of(), "version", ownerVersion))
                .andExpect(problem(409, "OWNER_ROLE_READ_ONLY"));
    }

    @Test
    void deleteRole_ok_system_inUse_403() throws Exception {
        String unused = createRole(unique("Temp "), List.of()).get("id").asText();
        doDelete(manager, "/roles/" + unused).andExpect(forbidden());
        doDelete(owner, "/roles/" + unused).andExpect(status().isNoContent());
        doGet(owner, "/roles/" + unused).andExpect(problem(404, "NOT_FOUND"));

        doDelete(owner, "/roles/" + SystemRole.HR.id()).andExpect(problem(409, "SYSTEM_ROLE_READ_ONLY"));

        String used = createRole(unique("Used "), List.of("ORDER_VIEW")).get("id").asText();
        doPost(owner, "/users", Map.of("username", uniqueUsername("ru"), "fullName", "X", "password", PASSWORD,
                "roleIds", List.of(used))).andExpect(status().isCreated());
        doDelete(owner, "/roles/" + used).andExpect(problem(409, "ROLE_IN_USE"));
        doDelete(owner, "/roles/zzz").andExpect(malformed());
    }

    @Test
    void listRoleOptions_forUserManagers_withStableKeys() throws Exception {
        String custom = unique("Option ");
        createRole(custom, List.of());
        JsonNode options = body(doGet(owner, "/roles/options").andExpect(status().isOk()));
        assertThat(options.get(0).get("key").asText()).isEqualTo("OWNER");
        assertThat(options.get(7).get("key").asText()).isEqualTo("HR");
        JsonNode customOption = null;
        for (JsonNode o : options) {
            if (o.get("name").asText().equals(custom)) {
                customOption = o;
            }
        }
        assertThat(customOption).isNotNull();
        assertThat(customOption.has("key")).isFalse();
        assertThat(customOption.has("permissionCodes")).isFalse();
        // USER_MANAGE, not ROLE_MANAGE: a Manager has neither.
        doGet(manager, "/roles/options").andExpect(forbidden());
    }

    @Test
    void roleKey_isOnRoleSummaryRoleAndRoleRef() throws Exception {
        doGet(owner, "/roles").andExpect(jsonPath("$[2].key").value("CASHIER"));
        doGet(owner, "/roles/" + SystemRole.KITCHEN.id()).andExpect(jsonPath("$.key").value("KITCHEN"));
        doGet(owner, "/auth/me").andExpect(jsonPath("$.user.roles[0].key").value("OWNER"));
    }

    @Test
    void listPermissions_all38_groupedByModule_403() throws Exception {
        doGet(owner, "/permissions")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(38))
                .andExpect(jsonPath("$[0].code").value("USER_MANAGE"))
                .andExpect(jsonPath("$[0].module").value("ADMIN"))
                .andExpect(jsonPath("$[0].description").isNotEmpty());
        doGet(manager, "/permissions").andExpect(forbidden());
    }
}
