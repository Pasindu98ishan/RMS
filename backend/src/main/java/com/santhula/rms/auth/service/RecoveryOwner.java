package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.common.config.RmsProperties;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner recovery that needs server access (lead decision on QA Q4). If RMS_RECOVERY_OWNER_USERNAME
 * and RMS_RECOVERY_OWNER_PASSWORD are set at startup, that owner's password is reset, the account
 * and PIN are unlocked, their sessions are revoked and the reset is audit-logged. The variables
 * must be removed afterwards; a warning is logged on every start while they are set.
 */
@Component
@Order(10)
public class RecoveryOwner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RecoveryOwner.class);

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenService refreshTokens;
    private final AuditService audit;
    private final RmsProperties properties;
    private final java.time.Clock clock;

    public RecoveryOwner(AppUserRepository users, PasswordEncoder passwordEncoder, RefreshTokenService refreshTokens,
                         AuditService audit, RmsProperties properties, java.time.Clock clock) {
        this.clock = clock;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.refreshTokens = refreshTokens;
        this.audit = audit;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        RmsProperties.Recovery r = properties.recovery();
        if (r == null || isBlank(r.ownerUsername()) || isBlank(r.ownerPassword())) {
            return;
        }
        log.warn("RMS_RECOVERY_OWNER_USERNAME / RMS_RECOVERY_OWNER_PASSWORD are set. Remove them from the environment "
                + "and restart once the owner can log in again.");
        if (r.ownerPassword().length() < 8 || r.ownerPassword().length() > 72) {
            log.error("Owner recovery skipped: RMS_RECOVERY_OWNER_PASSWORD must be 8-72 characters.");
            return;
        }
        AppUser user = users.findByUsernameIgnoreCase(r.ownerUsername().trim()).orElse(null);
        if (user == null || !user.isOwner()) {
            log.error("Owner recovery skipped: '{}' is not a user with the Owner role.", r.ownerUsername().trim());
            return;
        }
        if (passwordEncoder.matches(r.ownerPassword(), user.getPasswordHash()) && !user.isLocked(java.time.Instant.now(clock))
                && user.getFailedAttempts() == 0 && user.getPinLockedUntil() == null) {
            log.info("Owner recovery: '{}' already has this password and is not locked; nothing to do.", user.getUsername());
            return;
        }
        AuditRecord.Person system = new AuditRecord.Person(null, "system", "Owner recovery (server environment)");
        user.changePasswordHash(passwordEncoder.encode(r.ownerPassword()));
        user.unlock();
        users.saveAndFlush(user);
        refreshTokens.revokeAllForUser(user.getId());
        audit.record(AuditRecord.of(AuditAction.PASSWORD_RESET, "USER", user.getId()).actor(system)
                .after(Map.of("username", user.getUsername()))
                .reason("Owner recovery via RMS_RECOVERY_OWNER_* environment variables").build());
        audit.record(AuditRecord.of(AuditAction.ACCOUNT_UNLOCKED, "USER", user.getId()).actor(system)
                .after(Map.of("username", user.getUsername()))
                .reason("Owner recovery via RMS_RECOVERY_OWNER_* environment variables").build());
        log.warn("Owner recovery: password reset and account unlocked for '{}'. REMOVE RMS_RECOVERY_OWNER_USERNAME and "
                + "RMS_RECOVERY_OWNER_PASSWORD now.", user.getUsername());
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
