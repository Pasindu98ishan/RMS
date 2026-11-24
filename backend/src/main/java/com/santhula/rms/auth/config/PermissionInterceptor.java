package com.santhula.rms.auth.config;

import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.TokenClaims;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Enforces the operation's x-permission and x-terminal BEFORE argument binding, so a caller without the
 * permission gets 403 even when the body is malformed or invalid (lead decision on QA Q17).
 * Spring MVC calls interceptors before it reads and validates the body; @PreAuthorize on the
 * controller runs only after binding and stays as a second line of defence.
 *
 * <p>x-terminal: REQUIRED (ADR-008): after the permission check, a personal session (no terminal in the
 * access token) gets 403 TERMINAL_REQUIRED. Marking an operation in the spec is all it takes.
 *
 * <p>Handlers that are not contract operations (no generated @Operation, e.g. test-profile
 * endpoints) are not checked here. A contract operation missing from the spec is denied.
 */
public class PermissionInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(PermissionInterceptor.class);

    private final OperationPermissions permissions;

    public PermissionInterceptor(OperationPermissions permissions) {
        this.permissions = permissions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        Operation operation = AnnotatedElementUtils.findMergedAnnotation(method.getMethod(), Operation.class);
        if (operation == null) {
            return true;
        }
        Optional<OperationPermissions.Rule> rule = permissions.rule(operation.operationId());
        if (rule.isEmpty()) {
            log.error("Operation {} has no x-permission in the bundled spec; denying", operation.operationId());
            throw forbidden();
        }
        OperationPermissions.Rule r = rule.get();
        if (r.isPublic()) {
            return true;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (!(auth instanceof JwtAuthenticationToken) || !auth.isAuthenticated()) {
            // The security filter chain already answers 401 for missing tokens; this is a backstop.
            throw ApiException.unauthorized("UNAUTHENTICATED", "Please log in", "Please log in to continue.");
        }
        if (!r.authenticatedOnly()) {
            boolean granted = auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).anyMatch(r.permission()::equals);
            if (!granted) {
                throw forbidden();
            }
        }
        if (r.terminalRequired()
                && ((JwtAuthenticationToken) auth).getToken().getClaimAsString(TokenClaims.TERMINAL_ID) == null) {
            throw ApiException.forbidden("TERMINAL_REQUIRED", "Registered device needed",
                    "This can only be done on a registered counter or kitchen device.");
        }
        return true;
    }

    private static ApiException forbidden() {
        return ApiException.forbidden("FORBIDDEN", "Not allowed", "You do not have permission to do this.");
    }
}
