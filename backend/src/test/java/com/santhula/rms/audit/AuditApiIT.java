package com.santhula.rms.audit;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.dhatim.fastexcel.reader.ReadableWorkbook;
import org.dhatim.fastexcel.reader.Row;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** /audit-log (P1-AUD-01..03). 403 cases use a Manager (no AUDIT_VIEW). */
class AuditApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;

    @BeforeEach
    void sessions() throws Exception {
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
    }

    private String today() {
        return LocalDate.now(ZoneId.of("Asia/Colombo")).toString();
    }

    @Test
    void P1_AUD_01_loginAndFailedLoginAreLogged_withUserAndTerminal() throws Exception {
        TerminalKey pos = registerTerminal("CASHIER_POS");
        String name = createUser(owner, SystemRole.CASHIER, null);
        loginRequest(name, "wrong-pass", pos).andExpect(status().isUnauthorized());
        Session s = login(name, PASSWORD, pos);

        doGet(owner, "/audit-log?userId=" + s.userId() + "&from=" + today() + "&to=" + today())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].action", Matchers.hasItems("LOGIN", "LOGIN_FAILED")))
                .andExpect(jsonPath("$.items[0].action").value("LOGIN"))  // newest first
                .andExpect(jsonPath("$.items[0].terminal.id").value(pos.id().toString()))
                .andExpect(jsonPath("$.items[0].user.username").value(name));
    }

    @Test
    void P1_AUD_03_searchFiltersByActionAndEntity_paged() throws Exception {
        String name = createUser(owner, SystemRole.CASHIER, null);
        UUID id = userId(owner, name);
        doGet(owner, "/audit-log?action=CREATE&entityType=USER&entityId=" + id + "&size=5&sort=at,desc")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.size").value(5))
                .andExpect(jsonPath("$.items[0].after.username").value(name))
                .andExpect(jsonPath("$.items[0].before").doesNotExist());
    }

    @Test
    void QA_Q8_terminalRegistration_isAuditedWithTheOwnerAsActor_andTheNewTerminalAsEntity() throws Exception {
        TerminalKey terminal = registerTerminal("CASHIER_POS");
        doGet(owner, "/audit-log?action=TERMINAL_REGISTERED&entityType=TERMINAL&entityId=" + terminal.id())
                .andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].user.username").value(OWNER))
                .andExpect(jsonPath("$.items[0].terminal.id").value(terminal.id().toString()))
                .andExpect(jsonPath("$.items[0].after.type").value("CASHIER_POS"));
    }

    @Test
    void searchAuditLog_validation() throws Exception {
        doGet(owner, "/audit-log?from=2026-11-30&to=2026-11-01").andExpect(fieldError("to"));
        doGet(owner, "/audit-log?sort=username,asc").andExpect(fieldError("sort"));
        doGet(owner, "/audit-log?size=0").andExpect(fieldError("size"));
        doGet(owner, "/audit-log?entityType=lower").andExpect(fieldError("entityType"));
        doGet(owner, "/audit-log?action=EAT_CAKE").andExpect(malformed());
        doGet(owner, "/audit-log?from=yesterday").andExpect(malformed());
    }

    @Test
    void searchAuditLog_forbiddenForManager() throws Exception {
        doGet(manager, "/audit-log").andExpect(forbidden());
    }

    @Test
    void P1_AUD_03_exportToExcel_andTheExportIsAudited() throws Exception {
        String name = createUser(owner, SystemRole.CASHIER, null);
        UUID id = userId(owner, name);
        byte[] xlsx = mvc.perform(get(API + "/audit-log/export").param("entityType", "USER").param("entityId", id.toString())
                        .header("Authorization", "Bearer " + owner.accessToken())
                        .header("X-Terminal-Id", owner.terminalId().toString()))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .andExpect(header().string("Content-Disposition", Matchers.containsString(".xlsx")))
                .andReturn().getResponse().getContentAsByteArray();

        try (ReadableWorkbook wb = new ReadableWorkbook(new ByteArrayInputStream(xlsx))) {
            List<Row> rows = wb.getFirstSheet().read();
            assertThat(rows.get(0).getCellText(0)).isEqualTo("Time (Asia/Colombo)");
            assertThat(rows).hasSize(2);
            assertThat(rows.get(1).getCellText(4)).isEqualTo("CREATE");
            assertThat(rows.get(1).getCellText(8)).contains(name);
        }
        doGet(owner, "/audit-log?action=AUDIT_EXPORTED&userId=" + owner.userId())
                .andExpect(jsonPath("$.items[0].after.entityId").value(id.toString()))
                .andExpect(jsonPath("$.items[0].after.rows").value(1));
    }

    @Test
    void exportAuditLog_validation_and403() throws Exception {
        doGet(owner, "/audit-log/export?from=2026-11-30&to=2026-11-01").andExpect(fieldError("to"));
        doGet(manager, "/audit-log/export").andExpect(forbidden());
    }

    @Test
    void P1_AUD_02_thereIsNoWayToChangeTheLogThroughTheApi() throws Exception {
        doPut(owner, "/audit-log", Map.of()).andExpect(status().isMethodNotAllowed());
        doDelete(owner, "/audit-log").andExpect(status().isMethodNotAllowed());
        doPost(owner, "/audit-log", Map.of()).andExpect(status().isMethodNotAllowed());
    }

    @SuppressWarnings("unused")
    private static String joined(List<String> s) {
        return s.stream().collect(Collectors.joining(","));
    }
}
