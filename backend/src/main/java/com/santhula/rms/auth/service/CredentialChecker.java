package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.AuthAttemptsRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Password checks with the 5-tries / 15-minute lock (P1-AUTH-01). Deliberately NOT
 * transactional: it runs inside the caller's transaction, which must be declared
 * {@code noRollbackFor = ApiException.class} so the failure counter and the audit row are
 * committed even though the request fails.
 *
 * <p>The counters are changed only through {@link AuthAttemptsRepository} (atomic SQL, no entity
 * write): parallel wrong passwords all count (BUG-1-002) and valid logins never fail with
 * VERSION_CONFLICT (BUG-1-001).
 */
@Component
public class CredentialChecker {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;
    private final AuthAttemptsRepository attempts;
    private final int maxAttempts;
    private final Duration lockDuration;
    private final Clock clock;
    private final ZoneId zone;
    private final String dummyHash;

    public CredentialChecker(AppUserRepository users, AuthAttemptsRepository attempts, PasswordEncoder passwordEncoder,
                             AuditService audit, RmsProperties properties, Clock clock) {
        this.attempts = attempts;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
        this.maxAttempts = properties.security().loginMaxAttempts();
        this.lockDuration = properties.security().loginLockDuration();
        this.clock = clock;
        this.zone = properties.timeZone();
        // Compared against for unknown usernames so response time doesn't reveal which usernames exist.
        this.dummyHash = passwordEncoder.encode("not-a-real-password-" + SecureTokens.newToken());
    }

    /** Checks username + password; returns the active user or throws 401 / 423. */
    public AppUser checkLogin(String username, String password, AuditRecord.Place terminal) {
        Instant now = Instant.now(clock);
        AppUser user = users.findByUsernameIgnoreCase(username.trim()).orElse(null);
        if (user == null) {
            passwordEncoder.matches(password, dummyHash);
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", null)
                    .actor(new AuditRecord.Person(null, truncate(username.trim()), null))
                    .terminal(terminal).reason("Unknown username").build());
            throw invalidCredentials();
        }
        if (user.isLocked(now)) {
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user)).terminal(terminal).reason("Account locked").build());
            throw accountLocked(user.getLockedUntil());
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            AuthAttemptsRepository.Result result = recordFailure(user, terminal, "Wrong password");
            throw result.isLocked(Instant.now(clock)) ? accountLocked(result.lockedUntil()) : invalidCredentials();
        }
        if (!user.isActive()) {
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user)).terminal(terminal).reason("User deactivated").build());
            throw invalidCredentials();
        }
        attempts.clearPasswordFailures(user.getId(), now);
        return user;
    }

    /**
     * Checks credentials typed on an unregistered device (terminal registration). Wrong
     * credentials are audited but do NOT count towards the account lock (lead decision, QA Q4);
     * the caller rate-limits per client IP instead. An already locked account still gets 423.
     *
     * @return the active user, or null when the credentials are wrong (the caller throws 401)
     */
    public AppUser checkWithoutLockout(String username, String password, String context) {
        Instant now = Instant.now(clock);
        AppUser user = users.findByUsernameIgnoreCase(username.trim()).orElse(null);
        if (user == null) {
            passwordEncoder.matches(password, dummyHash);
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", null)
                    .actor(new AuditRecord.Person(null, truncate(username.trim()), null))
                    .reason(context + ": unknown username").build());
            return null;
        }
        if (user.isLocked(now)) {
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user)).reason(context + ": account locked").build());
            throw accountLocked(user.getLockedUntil());
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash()) || !user.isActive()) {
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user))
                    .reason(context + (user.isActive() ? ": wrong password" : ": user deactivated")).build());
            return null;
        }
        return user;
    }

    /**
     * Re-checks the logged-in user's own password (change password / set PIN). A wrong password
     * counts towards the lock: 422 on `currentPassword`, or 423 when this attempt locks the account.
     */
    public void checkOwnPassword(AppUser user, String password) {
        Instant now = Instant.now(clock);
        if (user.isLocked(now)) {
            throw accountLocked(user.getLockedUntil());
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            AuthAttemptsRepository.Result result = recordFailure(user, null, "Wrong current password");
            if (result.isLocked(Instant.now(clock))) {
                throw accountLocked(result.lockedUntil());
            }
            throw ApiException.validation("currentPassword", "Current password is incorrect");
        }
        attempts.clearPasswordFailures(user.getId(), now);
    }

    private AuthAttemptsRepository.Result recordFailure(AppUser user, AuditRecord.Place terminal, String reason) {
        AuthAttemptsRepository.Result result = attempts.registerPasswordFailure(user.getId(), Instant.now(clock), maxAttempts, lockDuration);
        audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                .actor(AuthSnapshots.person(user)).terminal(terminal).reason(reason).build());
        if (result.justLocked()) {
            audit.record(AuditRecord.of(AuditAction.ACCOUNT_LOCKED, "USER", user.getId())
                    .actor(AuthSnapshots.person(user)).terminal(terminal)
                    .after(Map.of("lockedUntil", result.lockedUntil().toString()))
                    .reason(maxAttempts + " wrong passwords in a row").build());
        }
        return result;
    }

    static ApiException invalidCredentials() {
        return ApiException.unauthorized("INVALID_CREDENTIALS", "Login failed", "Wrong username or password.");
    }

    private ApiException accountLocked(Instant until) {
        return ApiException.locked("ACCOUNT_LOCKED", "Account locked",
                "Too many wrong passwords. Try again after " + HH_MM.format(until.atZone(zone))
                        + " or ask the owner to unlock your account.");
    }

    private static String truncate(String s) {
        return s.length() > 32 ? s.substring(0, 32) : s;
    }
}
