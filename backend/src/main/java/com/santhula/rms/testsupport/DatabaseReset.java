package com.santhula.rms.testsupport;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.flyway.FlywayProperties;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.stereotype.Component;

/**
 * Truncates all tables and re-runs the seed migrations (V2, V6, V9). Uses the migration (schema owner) credentials,
 * because the app role may not TRUNCATE (and the audit log is append-only for it).
 */
@Component
@Profile("test")
public class DatabaseReset {

    /** Seed migrations re-run after truncating (they only INSERT). */
    static final List<String> SEEDS = List.of(
            "db/migration/V2__seed_branch_permissions_roles_settings.sql",
            "db/migration/V6__seed_menu_floor.sql",
            "db/migration/V9__seed_login_any_device.sql");

    private final DataSource ownerDataSource;

    public DatabaseReset(FlywayProperties flyway, DataSourceProperties datasource) {
        String url = flyway.getUrl() != null ? flyway.getUrl() : datasource.determineUrl();
        String user = flyway.getUser() != null ? flyway.getUser() : datasource.determineUsername();
        String password = flyway.getPassword() != null ? flyway.getPassword() : datasource.determinePassword();
        this.ownerDataSource = new DriverManagerDataSource(url, user, password);
    }

    public synchronized void truncateAndSeed() {
        JdbcTemplate jdbc = new JdbcTemplate(ownerDataSource);
        List<String> tables = jdbc.queryForList("""
                select quote_ident(table_name) from information_schema.tables
                 where table_schema = current_schema() and table_type = 'BASE TABLE'
                   and table_name <> 'flyway_schema_history'""", String.class);
        if (!tables.isEmpty()) {
            jdbc.execute("TRUNCATE TABLE " + tables.stream().collect(Collectors.joining(", ")) + " CASCADE");
        }
        try (Connection c = ownerDataSource.getConnection()) {
            for (String seed : SEEDS) {
                ScriptUtils.executeSqlScript(c, new ClassPathResource(seed));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Re-seeding failed", e);
        }
    }
}
