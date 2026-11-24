package com.santhula.rms.audit;

import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/**
 * P1-AUD-03-T12 / QA Q31: an export with more rows than {@code rms.audit.export-max-rows} is
 * refused with 422 EXPORT_TOO_LARGE; a narrower filter works. The limit is 3 here (default 50,000).
 */
@TestPropertySource(properties = "rms.audit.export-max-rows=3")
class AuditExportLimitIT extends IntegrationTestBase {

    private org.springframework.test.web.servlet.ResultActions export(Session s, String query) throws Exception {
        return mvc.perform(get(API + "/audit-log/export" + query)
                .header("Authorization", "Bearer " + s.accessToken())
                .header("X-Terminal-Id", s.terminalId().toString()));
    }

    @Test
    void QA_Q31_exportOverTheLimit_is422_andANarrowerFilterWorks() throws Exception {
        Session owner = asOwner();
        String name = createUser(owner, SystemRole.CASHIER, null);          // 1 CREATE row for this user
        UUID id = userId(owner, name);
        for (String pin : new String[] {"1111", "2222", "3333"}) {          // 3 PIN_RESET rows
            doPost(owner, "/users/" + id + "/reset-pin", java.util.Map.of("newPin", pin)).andExpect(status().isNoContent());
        }

        // 4 matching rows > limit 3
        export(owner, "?entityType=USER&entityId=" + id)
                .andExpect(problem(422, "EXPORT_TOO_LARGE"))
                .andExpect(jsonPath("$.detail").value(Matchers.containsString("limit is 3")));
        // 3 matching rows = limit: allowed
        export(owner, "?entityType=USER&entityId=" + id + "&action=PIN_RESET")
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", Matchers.containsString(".xlsx")));
        // The search endpoint is not limited by the export limit.
        doGet(owner, "/audit-log?entityType=USER&entityId=" + id).andExpect(jsonPath("$.totalItems").value(4));
    }
}
