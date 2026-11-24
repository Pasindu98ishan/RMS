package com.santhula.rms.auth.repo;

import com.santhula.rms.auth.domain.RefreshToken;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying(flushAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now where t.userId = :userId and t.revokedAt is null")
    int revokeAllForUser(UUID userId, Instant now);

    /** Revokes every live token of one session (theft detection: an already used token was presented again). */
    @Modifying(flushAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now where t.sessionId = :sessionId and t.revokedAt is null")
    int revokeAllForSession(UUID sessionId, Instant now);

    /** Revokes every live token of the user except those of the given session (change own password). */
    @Modifying(flushAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now where t.userId = :userId and t.sessionId <> :sessionId and t.revokedAt is null")
    int revokeAllForUserExceptSession(UUID userId, UUID sessionId, Instant now);

    @Modifying(flushAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now where t.terminalId = :terminalId and t.revokedAt is null")
    int revokeAllForTerminal(UUID terminalId, Instant now);
}
