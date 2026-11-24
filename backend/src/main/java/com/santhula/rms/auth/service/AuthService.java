package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.RefreshToken;
import com.santhula.rms.auth.domain.Terminal;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.TerminalRepository;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.CurrentActor;
import com.santhula.rms.settings.service.SettingsService;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Login, refresh, logout and the user's own account (P1-AUTH-01..05, ADR-006, ADR-008).
 *
 * <p>Two kinds of session (ADR-008): a terminal session (registered device: X-Terminal-Id + device token)
 * and a personal session (neither; only for users holding {@value #LOGIN_ANY_DEVICE}).
 *
 * <p>Methods that check a password run with {@code noRollbackFor = ApiException.class}: a failed
 * attempt must still commit its counter, lock and audit row. They throw only before making any
 * other change.
 */
@Service
public class AuthService {

    private final TerminalRepository terminals;
    private final AppUserRepository users;
    private final CredentialChecker credentials;
    private final PermissionResolver permissionResolver;
    private final AccessTokenService accessTokens;
    private final RefreshTokenService refreshTokens;
    private final SettingsService settings;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;
    private final Clock clock;

    @SuppressWarnings("java:S107")
    public AuthService(TerminalRepository terminals, AppUserRepository users, CredentialChecker credentials,
                       PermissionResolver permissionResolver, AccessTokenService accessTokens,
                       RefreshTokenService refreshTokens, SettingsService settings, PasswordEncoder passwordEncoder,
                       AuditService audit, Clock clock) {
        this.terminals = terminals;
        this.users = users;
        this.credentials = credentials;
        this.permissionResolver = permissionResolver;
        this.accessTokens = accessTokens;
        this.refreshTokens = refreshTokens;
        this.settings = settings;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
        this.clock = clock;
    }

    /** The permission that allows a personal session (login without a terminal, ADR-008). */
    public static final String LOGIN_ANY_DEVICE = "LOGIN_ANY_DEVICE";
    /** Field error on deviceToken when only one of it and the X-Terminal-Id header is sent. */
    public static final String DEVICE_TOKEN_PAIRING =
            "Send the device token together with the X-Terminal-Id header, or neither of them for a personal login";

    public enum SessionType { TERMINAL, PERSONAL }

    /** {@code terminal} is null for a personal session. */
    public record Session(String accessToken, long expiresIn, String refreshToken, long refreshExpiresIn,
                          AppUser user, List<String> permissions, Terminal terminal, Integer idleTimeoutMinutes) {
        public SessionType sessionType() {
            return terminal == null ? SessionType.PERSONAL : SessionType.TERMINAL;
        }
    }

    /** {@code terminal} is null for a personal session. */
    public record Profile(AppUser user, List<String> permissions, Terminal terminal, Integer idleTimeoutMinutes) {
        public SessionType sessionType() {
            return terminal == null ? SessionType.PERSONAL : SessionType.TERMINAL;
        }
    }

    /**
     * Terminal login when {@code terminalId} and {@code deviceToken} are given, personal login when both are
     * null; one without the other is 422. A personal login by a user without LOGIN_ANY_DEVICE is refused with
     * 403 TERMINAL_REQUIRED_FOR_USER after the password check, so it does not count towards the lock.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public Session login(UUID terminalId, String username, String password, String deviceToken) {
        if ((terminalId == null) != (deviceToken == null)) {
            throw ApiException.validation("deviceToken", DEVICE_TOKEN_PAIRING);
        }
        Terminal terminal = terminalId == null ? null : registeredTerminal(terminalId, deviceToken);
        AppUser user = credentials.checkLogin(username, password, AuthSnapshots.place(terminal));
        if (terminal == null && !permissionResolver.hasPermission(user, LOGIN_ANY_DEVICE)) {
            audit.record(AuditRecord.of(AuditAction.LOGIN_FAILED, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user)).reason("TERMINAL_REQUIRED_FOR_USER").build());
            throw terminalRequiredForUser();
        }
        // Stamp the last login with plain UPDATEs that leave the version columns alone: logging in is not an
        // edit, and an entity write here made concurrent logins fail with VERSION_CONFLICT (BUG-1-001).
        Instant now = Instant.now(clock);
        users.touchLastLogin(user.getId(), now);
        if (terminal != null) {
            terminals.touchLastLogin(terminal.getId(), now);
        }
        Session session = newSession(user, terminal);
        audit.record(AuditRecord.of(AuditAction.LOGIN, "AUTH_SESSION", user.getId())
                .actor(AuthSnapshots.person(user)).terminal(AuthSnapshots.place(terminal)).build());
        return session;
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Session refresh(UUID terminalId, String refreshToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(refreshToken, terminalId);
        AppUser user = users.findById(rotation.userId()).filter(AppUser::isActive).orElseThrow(RefreshTokenService::invalid);
        Terminal terminal = terminalId == null ? null
                : terminals.findById(terminalId).filter(Terminal::isActive).orElseThrow(RefreshTokenService::invalid);
        List<String> perms = permissionResolver.effectivePermissions(user);
        if (terminal == null && !perms.contains(LOGIN_ANY_DEVICE)) {
            // The owner took LOGIN_ANY_DEVICE away: the personal session ends here (ADR-008 #5).
            refreshTokens.endSession(rotation.next().sessionId());
            audit.record(AuditRecord.of(AuditAction.LOGOUT, "AUTH_SESSION", user.getId())
                    .actor(AuthSnapshots.person(user)).reason("TERMINAL_REQUIRED_FOR_USER").build());
            throw terminalRequiredForUser();
        }
        AccessTokenService.IssuedAccessToken access = accessTokens.issue(user, terminal, rotation.next().sessionId(), perms);
        return new Session(access.token(), access.expiresInSeconds(), rotation.next().token(), rotation.next().expiresInSeconds(),
                user, perms, terminal, idleTimeout(terminal));
    }

    @Transactional
    public void logout(String refreshToken, String reason) {
        CurrentActor actor = CurrentActor.require();
        Optional<RefreshToken> token = refreshTokens.findLive(refreshToken).filter(t -> t.getUserId().equals(actor.userId()));
        token.ifPresent(refreshTokens::revoke);
        audit.record(AuditRecord.of(AuditAction.LOGOUT, "AUTH_SESSION", actor.userId())
                .reason(reason == null ? "USER" : reason).build());
    }

    @Transactional(readOnly = true)
    public Profile currentProfile(List<String> tokenPermissions) {
        CurrentActor actor = CurrentActor.require();
        AppUser user = users.findById(actor.userId()).orElseThrow(() -> ApiException.unauthorized(
                "UNAUTHENTICATED", "Please log in", "Your session has ended. Please log in again."));
        Terminal terminal = actor.terminalId() == null ? null : terminals.findById(actor.terminalId()).orElseThrow(() -> ApiException.forbidden(
                "TERMINAL_NOT_REGISTERED", "This device is not registered", "This device is not registered as a terminal."));
        return new Profile(user, tokenPermissions, terminal, idleTimeout(terminal));
    }

    @Transactional(noRollbackFor = ApiException.class)
    public void changeOwnPassword(String currentPassword, String newPassword) {
        CurrentActor actor = CurrentActor.require();
        AppUser user = users.findById(actor.userId()).orElseThrow();
        PasswordRules.check(user.getUsername(), newPassword, "newPassword");
        credentials.checkOwnPassword(user, currentPassword);
        user.changePasswordHash(passwordEncoder.encode(newPassword));
        users.save(user);
        // The contract: other sessions are revoked, the calling one stays. Sessions on the same terminal count too.
        refreshTokens.revokeAllForUserExceptSession(user.getId(), actor.sessionId());
        audit.record(AuditRecord.of(AuditAction.PASSWORD_CHANGED, "USER", user.getId())
                .after(Map.of("username", user.getUsername())).build());
    }

    @Transactional(noRollbackFor = ApiException.class)
    public void setOwnPin(String currentPassword, String newPin) {
        CurrentActor actor = CurrentActor.require();
        AppUser user = users.findById(actor.userId()).orElseThrow();
        credentials.checkOwnPassword(user, currentPassword);
        user.changePinHash(passwordEncoder.encode(newPin));
        users.save(user);
        audit.record(AuditRecord.of(AuditAction.PIN_CHANGED, "USER", user.getId())
                .after(Map.of("username", user.getUsername())).build());
    }

    // ------------------------------------------------------------------ helpers

    private Terminal registeredTerminal(UUID terminalId, String deviceToken) {
        Terminal terminal = terminals.findById(terminalId).orElseThrow(AuthService::notRegistered);
        if (!SecureTokens.sha256Hex(deviceToken).equals(terminal.getDeviceTokenHash())) {
            throw notRegistered();
        }
        if (!terminal.isActive()) {
            throw ApiException.forbidden("TERMINAL_INACTIVE", "This terminal is switched off",
                    "This terminal has been deactivated. Ask the owner to register this device again.");
        }
        return terminal;
    }

    private Session newSession(AppUser user, Terminal terminal) {
        List<String> perms = permissionResolver.effectivePermissions(user);
        RefreshTokenService.IssuedRefreshToken refresh = refreshTokens.startSession(user.getId(), terminal == null ? null : terminal.getId());
        AccessTokenService.IssuedAccessToken access = accessTokens.issue(user, terminal, refresh.sessionId(), perms);
        return new Session(access.token(), access.expiresInSeconds(), refresh.token(), refresh.expiresInSeconds(),
                user, perms, terminal, idleTimeout(terminal));
    }

    private Integer idleTimeout(Terminal terminal) {
        if (terminal == null) {
            return settings.personalIdleTimeoutMinutes();
        }
        return settings.idleTimeoutMinutes(terminal.getType()).orElse(null);
    }

    static ApiException terminalRequiredForUser() {
        return ApiException.forbidden("TERMINAL_REQUIRED_FOR_USER", "Use a registered device",
                "This account can only sign in on a registered counter or kitchen device.");
    }

    static ApiException notRegistered() {
        return ApiException.forbidden("TERMINAL_NOT_REGISTERED", "This device is not registered",
                "This device is not registered as a terminal. Ask the owner to set it up.");
    }
}
