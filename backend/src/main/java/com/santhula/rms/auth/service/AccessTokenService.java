package com.santhula.rms.auth.service;

import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Terminal;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.security.TokenClaims;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

/** Issues the short-lived access token (JWT, HS256, at most 15 min; P1-AUTH-02, ADR-006). */
@Service
public class AccessTokenService {

    public static final String ISSUER = "rms";
    static final Duration MAX_TTL = Duration.ofMinutes(15);

    private final JwtEncoder encoder;
    private final Duration ttl;
    private final RmsProperties properties;
    private final Clock clock;

    public AccessTokenService(JwtEncoder encoder, RmsProperties properties, Clock clock) {
        this.encoder = encoder;
        this.properties = properties;
        this.clock = clock;
        Duration configured = properties.security().accessTokenTtl();
        if (configured.compareTo(MAX_TTL) > 0) {
            throw new IllegalStateException("rms.security.access-token-ttl must be at most 15 minutes (P1-AUTH-02)");
        }
        this.ttl = configured;
    }

    /** {@code terminal} is null for a personal session: the token then has no {@code tid} (ADR-008). */
    public IssuedAccessToken issue(AppUser user, Terminal terminal, UUID sessionId, List<String> permissions) {
        Instant now = Instant.now(clock);
        JwtClaimsSet.Builder builder = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(user.getId().toString())
                .issuedAt(now)
                .expiresAt(now.plus(ttl))
                .claim(TokenClaims.USERNAME, user.getUsername())
                .claim(TokenClaims.FULL_NAME, user.getFullName())
                .claim(TokenClaims.SESSION_ID, sessionId.toString())
                .claim(TokenClaims.BRANCH_ID, properties.branchId().toString())
                .claim(TokenClaims.PERMISSIONS, permissions);
        if (terminal != null) {
            builder.claim(TokenClaims.TERMINAL_ID, terminal.getId().toString())
                    .claim(TokenClaims.TERMINAL_NAME, terminal.getName())
                    .claim(TokenClaims.TERMINAL_TYPE, terminal.getType().name());
        }
        JwtClaimsSet claims = builder.build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new IssuedAccessToken(token, ttl.toSeconds());
    }

    public record IssuedAccessToken(String token, long expiresInSeconds) {
    }
}
