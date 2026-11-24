package com.santhula.rms.common.security;

import java.util.Optional;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * The logged-in user and the terminal they are on, read from the access token in the security
 * context. Empty for unauthenticated requests (login, refresh, terminal registration).
 */
public record CurrentActor(UUID userId, String username, String fullName, UUID terminalId, String terminalName, UUID sessionId) {

    public static Optional<CurrentActor> current() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken token) {
            return Optional.of(fromJwt(token.getToken()));
        }
        return Optional.empty();
    }

    public static CurrentActor require() {
        return current().orElseThrow(() -> new IllegalStateException("No authenticated user in this request"));
    }

    public static CurrentActor fromJwt(Jwt jwt) {
        String tid = jwt.getClaimAsString(TokenClaims.TERMINAL_ID);
        String sid = jwt.getClaimAsString(TokenClaims.SESSION_ID);
        return new CurrentActor(
                UUID.fromString(jwt.getSubject()),
                jwt.getClaimAsString(TokenClaims.USERNAME),
                jwt.getClaimAsString(TokenClaims.FULL_NAME),
                tid == null ? null : UUID.fromString(tid),
                jwt.getClaimAsString(TokenClaims.TERMINAL_NAME),
                sid == null ? null : UUID.fromString(sid));
    }
}
