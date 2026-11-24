package com.santhula.rms.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.TokenClaims;
import io.swagger.v3.oas.annotations.Operation;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.method.HandlerMethod;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * The generic x-terminal mechanism (ADR-008 #3, P1-AUTH-04): an operation marked {@code x-terminal: REQUIRED}
 * in the contract returns 403 TERMINAL_REQUIRED in a personal session, after the permission check. No M1.0 /
 * M1.1 operation is marked, so the interceptor is tested here with stand-in operations; the contract part
 * checks that every marked operation of the bundle is loaded as terminal-required.
 */
class TerminalRequiredTest {

    /** Stand-in controller: the generated interfaces carry @Operation the same way. */
    static class FakeController {
        @Operation(operationId = "markedOp")
        public void marked() {
        }

        @Operation(operationId = "markedAuthenticatedOp")
        public void markedAuthenticated() {
        }

        @Operation(operationId = "plainOp")
        public void plain() {
        }
    }

    private final PermissionInterceptor interceptor = new PermissionInterceptor(new OperationPermissions(Map.of(
            "markedOp", new OperationPermissions.Rule("markedOp", "ORDER_CREATE", null, true),
            "markedAuthenticatedOp", new OperationPermissions.Rule("markedAuthenticatedOp", "AUTHENTICATED", null, true),
            "plainOp", new OperationPermissions.Rule("plainOp", "ORDER_CREATE", null, false))));

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static void authenticate(boolean terminalSession, String... permissions) {
        Jwt.Builder jwt = Jwt.withTokenValue("t").header("alg", "HS256").subject(UUID.randomUUID().toString())
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60))
                .claim(TokenClaims.SESSION_ID, UUID.randomUUID().toString());
        if (terminalSession) {
            jwt.claim(TokenClaims.TERMINAL_ID, UUID.randomUUID().toString());
        }
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt.build(),
                List.of(permissions).stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private boolean call(String method) throws Exception {
        HandlerMethod handler = new HandlerMethod(new FakeController(), FakeController.class.getMethod(method));
        return interceptor.preHandle(new MockHttpServletRequest(), new MockHttpServletResponse(), handler);
    }

    private static String codeOf(ThrowingCall call) {
        try {
            call.run();
            return null;
        } catch (ApiException e) {
            return e.getCode();
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    @FunctionalInterface
    interface ThrowingCall {
        void run() throws Exception;
    }

    @Test
    void ADR008_markedOperation_inPersonalSession_is403TerminalRequired() {
        authenticate(false, "ORDER_CREATE");
        assertThat(codeOf(() -> call("marked"))).isEqualTo("TERMINAL_REQUIRED");
        assertThat(codeOf(() -> call("markedAuthenticated"))).isEqualTo("TERMINAL_REQUIRED");
    }

    @Test
    void ADR008_markedOperation_inTerminalSession_passes() throws Exception {
        authenticate(true, "ORDER_CREATE");
        assertThat(call("marked")).isTrue();
        assertThat(call("markedAuthenticated")).isTrue();
    }

    @Test
    void ADR008_permissionIsCheckedFirst_thenTheSessionKind() {
        authenticate(false);
        assertThat(codeOf(() -> call("marked"))).isEqualTo("FORBIDDEN");
    }

    @Test
    void ADR008_unmarkedOperation_worksInEitherSession() throws Exception {
        authenticate(false, "ORDER_CREATE");
        assertThat(call("plain")).isTrue();
        authenticate(true, "ORDER_CREATE");
        assertThat(call("plain")).isTrue();
    }

    @Test
    void ADR008_onlyRequiredIsAcceptedAsValue() {
        assertThatThrownBy(() -> new SpecLoader().load("x-terminal: OPTIONAL"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("must be REQUIRED");
    }

    /** Loads a one-operation spec through the real parser. */
    static final class SpecLoader {
        void load(String extension) throws Exception {
            String spec = "paths:\n  /x:\n    get:\n      operationId: xOp\n      x-permission: AUTHENTICATED\n      " + extension + "\n";
            Path file = Files.createTempFile("spec", ".yaml");
            try {
                Files.writeString(file, spec);
                OperationPermissions.load(new org.springframework.core.io.FileSystemResource(file));
            } finally {
                Files.deleteIfExists(file);
            }
        }
    }

    /** Contract side: whatever the bundle marks is exactly what the server enforces (today: nothing). */
    @Test
    @SuppressWarnings("unchecked")
    void ADR008_everyMarkedOperationOfTheContract_isEnforced() throws Exception {
        Set<String> marked = new TreeSet<>();
        try (InputStream in = Files.newInputStream(Path.of("target", "openapi.bundled.yaml"))) {
            Map<String, Object> root = new Yaml(new SafeConstructor(new LoaderOptions())).load(in);
            for (Object item : ((Map<String, Object>) root.get("paths")).values()) {
                for (Object op : ((Map<String, Object>) item).values()) {
                    if (op instanceof Map<?, ?> operation && "REQUIRED".equals(operation.get("x-terminal"))) {
                        marked.add((String) operation.get("operationId"));
                    }
                }
            }
        }
        Set<String> enforced = new TreeSet<>();
        new OperationPermissions().all().values().stream().filter(OperationPermissions.Rule::terminalRequired)
                .forEach(r -> enforced.add(r.operationId()));
        assertThat(enforced).isEqualTo(marked);
        // M1.0 / M1.1 mark nothing (ADR-008 #3); M1.2 marks orders, payments, shifts and the kitchen screens.
        assertThat(marked).isEmpty();
    }
}
