package com.santhula.rms.common.config;

import java.time.Duration;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** All `rms.*` settings from application.yml. */
@ConfigurationProperties(prefix = "rms")
public record RmsProperties(
        UUID branchId,
        @DefaultValue("Asia/Colombo") ZoneId timeZone,
        Security security,
        Bootstrap bootstrap,
        Audit audit,
        Recovery recovery,
        List<String> corsAllowedOrigins) {

    /** Owner recovery from the server environment (RMS_RECOVERY_OWNER_*). */
    public record Recovery(String ownerUsername, String ownerPassword) {
    }

    public record Security(
            String jwtSecret,
            @DefaultValue("15m") Duration accessTokenTtl,
            @DefaultValue("12h") Duration refreshTokenTtl,
            @DefaultValue("10") int bcryptStrength,
            @DefaultValue("5") int loginMaxAttempts,
            @DefaultValue("15m") Duration loginLockDuration,
            @DefaultValue("3") int pinMaxAttempts,
            @DefaultValue("5m") Duration pinLockDuration) {
    }

    public record Bootstrap(
            String ownerUsername,
            String ownerPassword,
            String ownerPin,
            @DefaultValue("Owner") String ownerFullName) {
    }

    public record Audit(@DefaultValue("50000") int exportMaxRows) {
    }
}
