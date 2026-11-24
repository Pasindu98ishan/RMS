package com.santhula.rms.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * Opaque, single-use refresh token bound to one user and, in a terminal session, one terminal (null for a
 * personal session, ADR-008); only its hash is stored.
 */
@Entity
@Table(name = "refresh_token")
public class RefreshToken implements Persistable<UUID> {

    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "terminal_id")
    private UUID terminalId;
    /** One login and the chain of tokens rotated from it (BUG-1-003); carried in the access token as `sid`. */
    @Column(name = "session_id", nullable = false)
    private UUID sessionId;
    @Column(name = "token_hash", nullable = false)
    private String tokenHash;
    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "revoked_at")
    private Instant revokedAt;
    @Column(name = "replaced_by")
    private UUID replacedBy;

    private transient boolean isNew;

    protected RefreshToken() {
    }

    public RefreshToken(UUID userId, UUID terminalId, UUID sessionId, String tokenHash, Instant issuedAt, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.sessionId = sessionId;
        this.userId = userId;
        this.terminalId = terminalId;
        this.tokenHash = tokenHash;
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
        this.isNew = true;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getTerminalId() {
        return terminalId;
    }

    public UUID getSessionId() {
        return sessionId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean isRevoked() {
        return revokedAt != null;
    }

    /** True when this token was used (replaced by a newer one); false when revoked by logout, password change, etc. */
    public boolean wasRotated() {
        return replacedBy != null;
    }

    public boolean isExpired(Instant now) {
        return !expiresAt.isAfter(now);
    }

    public void revoke(Instant at, UUID replacedBy) {
        if (revokedAt == null) {
            this.revokedAt = at;
            this.replacedBy = replacedBy;
        }
    }
}
