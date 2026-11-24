package com.santhula.rms.auth.config;

import com.santhula.rms.common.error.ProblemWriter;
import com.santhula.rms.common.security.TokenClaims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Header check after bearer authentication (ADR-006 #2, ADR-008 #4): a terminal session must send
 * `X-Terminal-Id` matching the terminal in the access token; a personal session (no terminal in the
 * token) must not send it. Otherwise 403 TERMINAL_MISMATCH.
 */
public class TerminalHeaderFilter extends OncePerRequestFilter {

    private final ProblemWriter problems;

    public TerminalHeaderFilter(ProblemWriter problems) {
        this.problems = problems;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken token) {
            String expected = token.getToken().getClaimAsString(TokenClaims.TERMINAL_ID);
            String sent = request.getHeader(TokenClaims.TERMINAL_HEADER);
            boolean headerSent = sent != null && !sent.isBlank();
            if (expected == null && headerSent) {
                problems.write(request, response, HttpStatus.FORBIDDEN, "TERMINAL_MISMATCH", "Wrong terminal",
                        "This session was started without a registered device. Please log in again on this device.");
                return;
            }
            if (expected != null && (!headerSent || !expected.equalsIgnoreCase(sent.trim()))) {
                problems.write(request, response, HttpStatus.FORBIDDEN, "TERMINAL_MISMATCH", "Wrong terminal",
                        "This session belongs to another terminal. Please log in again on this device.");
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
