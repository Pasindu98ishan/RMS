package com.santhula.rms.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.santhula.rms.support.IntegrationTestBase;
import com.santhula.rms.support.TestDatabase;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * P1-AUD-02 / QA Q18: connected as the application's DB role, the audit log can be read and
 * appended to, but not updated, deleted or truncated.
 */
class AuditLogImmutabilityIT extends IntegrationTestBase {

    private Connection appConnection() throws SQLException {
        return DriverManager.getConnection(TestDatabase.POSTGRES.getJdbcUrl(), TestDatabase.APP_USER, TestDatabase.APP_PASSWORD);
    }

    @Test
    void P1_AUD_02_appRole_canSelectAndInsert_only() throws Exception {
        asOwner(); // makes sure there are rows (LOGIN)
        try (Connection c = appConnection(); Statement st = c.createStatement()) {
            try (ResultSet rs = st.executeQuery("select count(*) from audit_log")) {
                rs.next();
                assertThat(rs.getLong(1)).isPositive();
            }
            st.executeUpdate("insert into audit_log (id, branch_id, at, action, entity_type) values ('" + UUID.randomUUID()
                    + "', '00000000-0000-0000-0000-000000000001', now(), 'UPDATE', 'TEST')");

            assertDenied(st, "update audit_log set reason = 'tampered'");
            assertDenied(st, "delete from audit_log");
            assertDenied(st, "truncate audit_log");
        }
    }

    @Test
    void appRole_cannotTouchTheMigrationHistory() throws Exception {
        try (Connection c = appConnection(); Statement st = c.createStatement()) {
            assertDenied(st, "delete from flyway_schema_history");
        }
    }

    @Test
    void appRole_privilegesOnAuditLog_areExactlySelectAndInsert() throws Exception {
        try (Connection c = appConnection(); Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("""
                     select string_agg(privilege_type, ',' order by privilege_type)
                       from information_schema.role_table_grants
                      where table_name = 'audit_log' and grantee = 'rms_app'""")) {
            rs.next();
            assertThat(rs.getString(1)).isEqualTo("INSERT,SELECT");
        }
    }

    private static void assertDenied(Statement st, String sql) {
        assertThatThrownBy(() -> st.executeUpdate(sql))
                .isInstanceOf(SQLException.class)
                .hasMessageContaining("permission denied");
    }
}
