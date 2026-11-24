package com.santhula.rms.testsupport;

import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** QA helpers under the `test` profile (lead decision on QA Q26). */
class TestSupportIT extends IntegrationTestBase {

    @Test
    void QA_Q26_clockAdvance_letsQaPassTheAccountLock() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        for (int i = 0; i < 5; i++) {
            loginRequest(user, "wrong-pass", pos);
        }
        loginRequest(user, PASSWORD, pos).andExpect(problem(423, "ACCOUNT_LOCKED"));
        doPost(null, "/test/clock/advance", Map.of("minutes", 16))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offsetMinutes").value(16));
        loginRequest(user, PASSWORD, pos).andExpect(status().isOk());
        doPost(null, "/test/clock/reset", null).andExpect(jsonPath("$.offsetMinutes").value(0));
    }

    @Test
    void QA_Q26_reset_emptiesDataAndReseeds_ownerCanStartAgain() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);

        doPost(null, "/test/reset", null).andExpect(status().isNoContent());

        // Old terminals and sessions are gone; the seed and the bootstrap owner are back.
        loginRequest(OWNER, OWNER_PASSWORD, new TerminalKey(owner.terminalId(), "x")).andExpect(problem(403, "TERMINAL_NOT_REGISTERED"));
        Session fresh = asOwner();
        doGet(fresh, "/users?search=" + user).andExpect(jsonPath("$.totalItems").value(0));
        doGet(fresh, "/permissions").andExpect(jsonPath("$.length()").value(38));
        doGet(fresh, "/roles").andExpect(jsonPath("$.length()").value(8));
        doGet(fresh, "/settings/tax").andExpect(jsonPath("$.enabled").value(false));
        doGet(fresh, "/audit-log?action=LOGIN").andExpect(jsonPath("$.totalItems").value(1));
    }
}
