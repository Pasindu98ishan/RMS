package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.AuthAttemptsRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Manager / owner PIN approval, checked inline inside the transaction of the action being
 * approved (conventions.md, Approvals; architecture.md, Approval with PIN). Used from M1.2 on
 * (voids, refunds, discounts above limit, ...).
 *
 * <p>Rules: the approver must be active, have a PIN, not be PIN-locked, and hold the permission
 * the action needs. 3 wrong PINs in a row lock the PIN for 5 minutes (P1-AUTH-05). A cashier's
 * PIN never approves anything because a cashier lacks the approving permissions.
 *
 * <p>Errors: 403 APPROVAL_REQUIRED (no approval sent), 403 APPROVAL_INVALID (unknown approver,
 * wrong PIN, or approver lacks the permission), 423 PIN_LOCKED.
 */
@Service
public class PinApprovalService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PermissionResolver permissions;
    private final PinFailureRecorder failures;
    private final AuthAttemptsRepository attempts;
    private final Clock clock;
    private final ZoneId zone;

    PinApprovalService(AppUserRepository users, PasswordEncoder passwordEncoder, PermissionResolver permissions,
                       PinFailureRecorder failures, AuthAttemptsRepository attempts, RmsProperties properties, Clock clock) {
        this.attempts = attempts;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.permissions = permissions;
        this.failures = failures;
        this.clock = clock;
        this.zone = properties.timeZone();
    }

    /** Who approved; store `id` on the approved record and pass the whole thing to the audit log. */
    public record Approver(UUID id, String username, String fullName) {
        public AuditRecord.Person asAuditPerson() {
            return new AuditRecord.Person(id, username, fullName);
        }
    }

    /**
     * Verifies the approval for an action that needs {@code requiredPermission}.
     *
     * @param approverUsername from the request's `approval.approverUsername`; null = no approval sent
     * @param pin              from `approval.pin`
     */
    @Transactional(propagation = Propagation.MANDATORY, noRollbackFor = ApiException.class)
    public Approver approve(String approverUsername, String pin, String requiredPermission) {
        if (approverUsername == null || approverUsername.isBlank() || pin == null || pin.isBlank()) {
            throw ApiException.forbidden("APPROVAL_REQUIRED", "Approval needed",
                    "This needs a manager or owner PIN.");
        }
        AppUser approver = users.findByUsernameIgnoreCase(approverUsername.trim())
                .filter(AppUser::isActive)
                .orElseThrow(() -> invalid("Wrong approver or PIN."));
        Instant now = Instant.now(clock);
        if (approver.isPinLocked(now)) {
            throw pinLocked(approver.getPinLockedUntil());
        }
        if (!approver.hasPin() || !passwordEncoder.matches(pin, approver.getPinHash())) {
            Instant lockedUntil = failures.recordFailure(approver.getId(), requiredPermission);
            if (lockedUntil != null) {
                throw pinLocked(lockedUntil);
            }
            throw invalid("Wrong approver or PIN.");
        }
        if (!permissions.hasPermission(approver, requiredPermission)) {
            throw invalid(approver.getFullName() + " is not allowed to approve this.");
        }
        attempts.clearPinFailures(approver.getId(), now);
        return new Approver(approver.getId(), approver.getUsername(), approver.getFullName());
    }

    private static ApiException invalid(String detail) {
        return ApiException.forbidden("APPROVAL_INVALID", "Approval not accepted", detail);
    }

    private ApiException pinLocked(Instant until) {
        return ApiException.locked("PIN_LOCKED", "PIN locked",
                "Too many wrong PINs. This PIN is locked until " + HH_MM.format(until.atZone(zone)) + ".");
    }
}
