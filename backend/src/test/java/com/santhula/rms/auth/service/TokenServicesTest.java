package com.santhula.rms.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.RefreshToken;
import com.santhula.rms.auth.domain.Terminal;
import com.santhula.rms.auth.repo.RefreshTokenRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.domain.TerminalType;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.TokenClaims;
import com.santhula.rms.testsupport.MutableClock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/** Access token contents and refresh token rotation (P1-AUTH-02, ADR-006). */
class TokenServicesTest {

    private static final UUID BRANCH = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private final MutableClock clock = new MutableClock();
    private final SecretKey key = new SecretKeySpec(new byte[32], "HmacSHA256");
    private final RmsProperties properties = properties(Duration.ofMinutes(15), Duration.ofHours(12));

    private static RmsProperties properties(Duration access, Duration refresh) {
        return new RmsProperties(BRANCH, ZoneId.of("Asia/Colombo"),
                new RmsProperties.Security("", access, refresh, 4, 5, Duration.ofMinutes(15), 3, Duration.ofMinutes(5)),
                null, null, null, null);
    }

    @Test
    void P1_AUTH_02_accessToken_carriesUserTerminalPermissions_andLasts15Minutes() {
        AccessTokenService service = new AccessTokenService(new NimbusJwtEncoder(new ImmutableSecret<>(key)), properties, clock);
        AppUser user = new AppUser(BRANCH, "cashier1", "hash", "Nimal Perera", null);
        Terminal terminal = new Terminal(BRANCH, "Cashier POS 1", TerminalType.CASHIER_POS, null, null, "h");

        UUID sessionId = UUID.randomUUID();
        AccessTokenService.IssuedAccessToken issued = service.issue(user, terminal, sessionId, List.of("ORDER_CREATE", "BILL_PAY"));
        Jwt jwt = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build().decode(issued.token());

        assertThat(issued.expiresInSeconds()).isEqualTo(900);
        assertThat(jwt.getSubject()).isEqualTo(user.getId().toString());
        assertThat(jwt.getClaimAsString(TokenClaims.USERNAME)).isEqualTo("cashier1");
        assertThat(jwt.getClaimAsString(TokenClaims.TERMINAL_ID)).isEqualTo(terminal.getId().toString());
        assertThat(jwt.getClaimAsString(TokenClaims.TERMINAL_TYPE)).isEqualTo("CASHIER_POS");
        assertThat(jwt.getClaimAsString(TokenClaims.SESSION_ID)).isEqualTo(sessionId.toString());
        assertThat(jwt.getClaimAsStringList(TokenClaims.PERMISSIONS)).containsExactly("ORDER_CREATE", "BILL_PAY");
        assertThat(Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt())).isEqualTo(Duration.ofMinutes(15));
    }

    @Test
    void P1_AUTH_02_tokenLifetimesAboveTheLimitsAreRejectedAtStartup() {
        var encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        assertThatThrownBy(() -> new AccessTokenService(encoder, properties(Duration.ofMinutes(16), Duration.ofHours(12)), clock))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new RefreshTokenService(mock(RefreshTokenRepository.class),
                properties(Duration.ofMinutes(15), Duration.ofHours(13)), clock))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void refreshToken_isStoredAsHash_andRotationRevokesTheOldOne() {
        RefreshTokenRepository repo = mock(RefreshTokenRepository.class);
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        RefreshTokenService service = new RefreshTokenService(repo, properties, clock);
        UUID user = UUID.randomUUID();
        UUID terminal = UUID.randomUUID();

        RefreshTokenService.IssuedRefreshToken issued = service.startSession(user, terminal);
        assertThat(issued.expiresInSeconds()).isEqualTo(Duration.ofHours(12).toSeconds());
        RefreshToken stored = new RefreshToken(user, terminal, issued.sessionId(), SecureTokens.sha256Hex(issued.token()),
                Instant.now(clock), Instant.now(clock).plus(Duration.ofHours(12)));
        when(repo.findByTokenHash(SecureTokens.sha256Hex(issued.token()))).thenReturn(Optional.of(stored));

        clock.advance(Duration.ofHours(11)); // sliding: each rotation gives a fresh 12 h
        RefreshTokenService.Rotation rotation = service.rotate(issued.token(), terminal);

        assertThat(rotation.userId()).isEqualTo(user);
        assertThat(rotation.next().token()).isNotEqualTo(issued.token());
        // A rotation stays in the same session (BUG-1-003: "other sessions" must be recognisable).
        assertThat(rotation.next().sessionId()).isEqualTo(issued.sessionId());
        assertThat(stored.isRevoked()).isTrue();
    }

    @Test
    void reusedRefreshToken_revokesTheWholeSession_butNotTheUsersOtherSessions() {
        RefreshTokenRepository repo = mock(RefreshTokenRepository.class);
        RefreshTokenService service = new RefreshTokenService(repo, properties, clock);
        UUID user = UUID.randomUUID();
        UUID terminal = UUID.randomUUID();
        RefreshToken used = new RefreshToken(user, terminal, UUID.randomUUID(), SecureTokens.sha256Hex("raw"), Instant.now(clock),
                Instant.now(clock).plus(Duration.ofHours(12)));
        used.revoke(Instant.now(clock), UUID.randomUUID());
        when(repo.findByTokenHash(SecureTokens.sha256Hex("raw"))).thenReturn(Optional.of(used));

        assertThatThrownBy(() -> service.rotate("raw", terminal))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("REFRESH_TOKEN_INVALID"));
        verify(repo).revokeAllForSession(eq(used.getSessionId()), any());
    }

    @Test
    void aTokenRevokedByLogoutOrPasswordChange_isInvalid_withoutCascade() {
        RefreshTokenRepository repo = mock(RefreshTokenRepository.class);
        RefreshTokenService service = new RefreshTokenService(repo, properties, clock);
        UUID terminal = UUID.randomUUID();
        RefreshToken revoked = new RefreshToken(UUID.randomUUID(), terminal, UUID.randomUUID(), SecureTokens.sha256Hex("raw"),
                Instant.now(clock), Instant.now(clock).plus(Duration.ofHours(12)));
        revoked.revoke(Instant.now(clock), null);   // not replaced by a newer token
        when(repo.findByTokenHash(SecureTokens.sha256Hex("raw"))).thenReturn(Optional.of(revoked));

        assertThatThrownBy(() -> service.rotate("raw", terminal)).isInstanceOf(ApiException.class);
        verify(repo, never()).revokeAllForSession(any(), any());
    }

    @Test
    void expiredOrForeignTerminalRefreshToken_isRefused() {
        RefreshTokenRepository repo = mock(RefreshTokenRepository.class);
        RefreshTokenService service = new RefreshTokenService(repo, properties, clock);
        UUID terminal = UUID.randomUUID();
        RefreshToken token = new RefreshToken(UUID.randomUUID(), terminal, UUID.randomUUID(), SecureTokens.sha256Hex("raw"), Instant.now(clock),
                Instant.now(clock).plus(Duration.ofHours(12)));
        when(repo.findByTokenHash(SecureTokens.sha256Hex("raw"))).thenReturn(Optional.of(token));

        assertThatThrownBy(() -> service.rotate("raw", UUID.randomUUID())).isInstanceOf(ApiException.class);
        clock.advance(Duration.ofHours(12));
        assertThatThrownBy(() -> service.rotate("raw", terminal)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.rotate("unknown", terminal)).isInstanceOf(ApiException.class);
    }

    @Test
    void secureTokens_areRandomAndHashed() {
        String a = SecureTokens.newToken();
        assertThat(a).hasSize(43).isNotEqualTo(SecureTokens.newToken());
        assertThat(SecureTokens.sha256Hex(a)).hasSize(64).isEqualTo(SecureTokens.sha256Hex(a));
    }
}
