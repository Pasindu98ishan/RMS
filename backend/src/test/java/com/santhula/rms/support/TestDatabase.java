package com.santhula.rms.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

/**
 * One Postgres 16 container for the whole test run. Flyway migrates as the container superuser
 * (schema owner); the app connects as the restricted rms_app role, exactly like production.
 */
public final class TestDatabase {

    public static final String APP_USER = "rms_app";
    public static final String APP_PASSWORD = "rms_app_test";

    @SuppressWarnings("resource")
    public static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("rms")
            .withCopyFileToContainer(MountableFile.forClasspathResource("db/test-init.sql"), "/docker-entrypoint-initdb.d/01-app-role.sql");

    static {
        POSTGRES.start();
    }

    private TestDatabase() {
    }

    public static void register(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> APP_USER);
        registry.add("spring.datasource.password", () -> APP_PASSWORD);
        registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
        registry.add("spring.flyway.user", POSTGRES::getUsername);
        registry.add("spring.flyway.password", POSTGRES::getPassword);
        registry.add("spring.flyway.placeholders.appDbUser", () -> APP_USER);
    }
}
