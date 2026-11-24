package com.santhula.rms.auth.service;

import com.santhula.rms.auth.domain.RefreshToken;
import com.santhula.rms.auth.repo.RefreshTokenRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Opaque single-use refresh tokens bound to a session (and its terminal; none for a personal session,
 * ADR-008), sliding 12 h lifetime (ADR-006).
 * Not transactional itself: callers run it inside their transaction (which must not roll back on
 * ApiException, so reuse detection is kept).
 */
@Service
public class RefreshTokenService {

    static final Duration MAX_TTL = Duration.ofHours(12);

    private final RefreshTokenRepository repository;
    private final Duration ttl;
    private final Clock clock;

    public RefreshTokenService(RefreshTokenRepository repository, RmsProperties properties, Clock clock) {
        this.repository = repository;
        this.clock = clock;
        Duration configured = properties.security().refreshTokenTtl();
        if (configured.compareTo(MAX_TTL) > 0) {
            throw new IllegalStateException("rms.security.refresh-token-ttl must be at most 12 hours (P1-AUTH-02)");
        }
        this.ttl = configured;
    }

    /** A new login: a new session id. {@code terminalId} is null for a personal session. */
    public IssuedRefreshToken startSession(UUID userId, UUID terminalId) {
        return issue(userId, terminalId, UUID.randomUUID());
    }

    IssuedRefreshToken issue(UUID userId, UUID terminalId, UUID sessionId) {
        Instant now = Instant.now(clock);
        String raw = SecureTokens.newToken();
        RefreshToken token = repository.save(new RefreshToken(userId, terminalId, sessionId, SecureTokens.sha256Hex(raw), now, now.plus(ttl)));
        return new IssuedRefreshToken(token.getId(), sessionId, raw, ttl.toSeconds());
    }

    /**
     * Revokes the presented token and issues its replacement. A token that was already used or
     * revoked is treated as stolen: every live token of that user on that terminal is revoked.
     */
    public Rotation rotate(String raw, UUID terminalId) {
        Instant now = Instant.now(clock);
        RefreshToken current = repository.findByTokenHash(SecureTokens.sha256Hex(raw)).orElseThrow(RefreshTokenService::invalid);
        if (current.isRevoked()) {
            // A token that was already USED (rotated away) and shows up again looks stolen: end that session.
            // A token revoked by logout or a password change is simply invalid and must not take down the
            // user's other sessions, not even those on the same terminal.
            if (current.wasRotated()) {
                repository.revokeAllForSession(current.getSessionId(), now);
            }
            throw invalid();
        }
        // The header must match the session kind: the token's terminal, or none for a personal session.
        // A mismatch is a malformed request, not theft: the token is NOT revoked (ADR-008, QA Q41).
        if (current.isExpired(now) || !Objects.equals(current.getTerminalId(), terminalId)) {
            throw invalid();
        }
        IssuedRefreshToken next = issue(current.getUserId(), terminalId, current.getSessionId());
        current.revoke(now, next.id());
        return new Rotation(current.getUserId(), next);
    }

    /** Looks up a live token without changing it. */
    public Optional<RefreshToken> findLive(String raw) {
        Instant now = Instant.now(clock);
        return repository.findByTokenHash(SecureTokens.sha256Hex(raw)).filter(t -> !t.isRevoked() && !t.isExpired(now));
    }

    public void revoke(RefreshToken token) {
        token.revoke(Instant.now(clock), null);
    }

    public void revokeAllForUser(UUID userId) {
        repository.revokeAllForUser(userId, Instant.now(clock));
    }

    /**
     * Revokes the user's other sessions, on any terminal and also on the same terminal, but keeps
     * the given one. A null session (an access token issued before sessions existed) keeps none.
     */
    public void revokeAllForUserExceptSession(UUID userId, UUID keepSessionId) {
        if (keepSessionId == null) {
            repository.revokeAllForUser(userId, Instant.now(clock));
        } else {
            repository.revokeAllForUserExceptSession(userId, keepSessionId, Instant.now(clock));
        }
    }

    /** Ends one session: every live token of it is revoked. */
    public void endSession(UUID sessionId) {
        repository.revokeAllForSession(sessionId, Instant.now(clock));
    }

    public void revokeAllForTerminal(UUID terminalId) {
        repository.revokeAllForTerminal(terminalId, Instant.now(clock));
    }

    static ApiException invalid() {
        return ApiException.unauthorized("REFRESH_TOKEN_INVALID", "Please log in",
                "Your session has ended. Please log in again.");
    }

    public record IssuedRefreshToken(UUID id, UUID sessionId, String token, long expiresInSeconds) {
    }

    public record Rotation(UUID userId, IssuedRefreshToken next) {
    }
}
