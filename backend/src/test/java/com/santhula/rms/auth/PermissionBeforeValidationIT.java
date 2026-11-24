package com.santhula.rms.auth;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Lead decision on QA Q17: a caller without the permission gets 403 even when the request is
 * invalid or malformed. 403 comes before 400 / 422 (PermissionInterceptor runs before binding).
 */
class PermissionBeforeValidationIT extends IntegrationTestBase {

    @Test
    void QA_Q17_invalidBody_withoutPermission_is403_notThe422() throws Exception {
        Session cashier = asRole(SystemRole.CASHIER);
        doPost(cashier, "/users", Map.of("username", "Bad Name!")).andExpect(forbidden());
        doPut(cashier, "/settings/tax", Map.of("rate", "999")).andExpect(forbidden());
        doPost(cashier, "/roles", Map.of()).andExpect(forbidden());
    }

    @Test
    void QA_Q17_malformedJsonOrBadParams_withoutPermission_is403_notThe400() throws Exception {
        Session cashier = asRole(SystemRole.CASHIER);
        doPut(cashier, "/settings/restaurant", "{this is not json").andExpect(forbidden());
        doGet(cashier, "/users?size=9999&roleId=not-a-uuid").andExpect(forbidden());
        doGet(cashier, "/audit-log?from=yesterday").andExpect(forbidden());
        doPost(cashier, "/users/" + UUID.randomUUID() + "/reset-pin", "[]").andExpect(forbidden());
    }

    @Test
    void withThePermission_theSameRequestsAreValidated() throws Exception {
        Session owner = asOwner();
        doPost(owner, "/users", Map.of("username", "Bad Name!")).andExpect(fieldError("username"));
        doPut(owner, "/settings/restaurant", "{this is not json").andExpect(malformed());
    }
}
