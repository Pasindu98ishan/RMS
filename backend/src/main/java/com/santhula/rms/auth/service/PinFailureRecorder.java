package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.AuthAttemptsRepository;
import com.santhula.rms.common.config.RmsProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records a wrong approval PIN in its own transaction, so the count survives the rollback of
 * the action that asked for approval (e.g. a void that is then refused).
 */
@Component
class PinFailureRecorder {

    private final AuthAttemptsRepository attempts;
    private final AppUserRepository users;
    private final AuditService audit;
    private final int maxAttempts;
    private final Duration lockDuration;
    private final Clock clock;

    PinFailureRecorder(AuthAttemptsRepository attempts, AppUserRepository users, AuditService audit,
                       RmsProperties properties, Clock clock) {
        this.attempts = attempts;
        this.users = users;
        this.audit = audit;
        this.maxAttempts = properties.security().pinMaxAttempts();
        this.lockDuration = properties.security().pinLockDuration();
        this.clock = clock;
    }

    /**
     * Counts one wrong PIN with a single atomic UPDATE (BUG-1-002: parallel guesses all count).
     *
     * @return when the PIN is now locked until, or null if the PIN is not locked after this failure
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Instant recordFailure(UUID approverId, String forPermission) {
        AppUser user = users.findById(approverId).orElseThrow();
        Instant now = Instant.now(clock);
        AuthAttemptsRepository.Result result = attempts.registerPinFailure(approverId, now, maxAttempts, lockDuration);
        audit.record(AuditRecord.of(AuditAction.PIN_FAILED, "USER", user.getId())
                .approver(AuthSnapshots.person(user))
                .after(Map.of("permission", forPermission))
                .reason("Wrong approval PIN").build());
        if (result.justLocked()) {
            audit.record(AuditRecord.of(AuditAction.PIN_LOCKED, "USER", user.getId())
                    .approver(AuthSnapshots.person(user))
                    .after(Map.of("pinLockedUntil", result.lockedUntil().toString()))
                    .reason(maxAttempts + " wrong PINs in a row").build());
        }
        return result.isLocked(now) ? result.lockedUntil() : null;
    }
}
