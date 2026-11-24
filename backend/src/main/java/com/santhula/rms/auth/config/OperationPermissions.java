package com.santhula.rms.auth.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * operationId -> x-permission (and x-auth, x-terminal), read from the bundled contract that the build copies
 * to the classpath (openapi/openapi.bundled.yaml). The spec is the single source of who may call
 * what (ADR-005); PermissionInterceptor enforces it before the request body is read.
 */
@Component
public class OperationPermissions {

    public static final String PUBLIC = "PUBLIC";
    public static final String AUTHENTICATED = "AUTHENTICATED";
    public static final String INLINE_CREDENTIALS = "INLINE_CREDENTIALS";
    /** The only value of x-terminal: the operation needs a terminal session (ADR-008). */
    public static final String TERMINAL_REQUIRED = "REQUIRED";
    static final String SPEC = "openapi/openapi.bundled.yaml";
    private static final Set<String> METHODS = Set.of("get", "put", "post", "delete", "patch", "head", "options");

    public record Rule(String operationId, String permission, String auth, boolean terminalRequired) {
        public Rule(String operationId, String permission, String auth) {
            this(operationId, permission, auth, false);
        }

        public boolean isPublic() {
            return PUBLIC.equals(permission) || INLINE_CREDENTIALS.equals(auth);
        }

        public boolean authenticatedOnly() {
            return AUTHENTICATED.equals(permission);
        }
    }

    private final Map<String, Rule> rules;

    public OperationPermissions() {
        this(load(new ClassPathResource(SPEC)));
    }

    /** For tests: a fixed set of rules. */
    public OperationPermissions(Map<String, Rule> rules) {
        this.rules = Map.copyOf(rules);
    }

    public Optional<Rule> rule(String operationId) {
        return Optional.ofNullable(rules.get(operationId));
    }

    public Map<String, Rule> all() {
        return Map.copyOf(rules);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Rule> load(Resource resource) {
        try (InputStream in = resource.getInputStream()) {
            Map<String, Object> root = new Yaml(new SafeConstructor(new LoaderOptions())).load(in);
            Map<String, Object> paths = (Map<String, Object>) root.get("paths");
            Map<String, Rule> result = new HashMap<>();
            for (Object pathItem : paths.values()) {
                for (Map.Entry<String, Object> op : ((Map<String, Object>) pathItem).entrySet()) {
                    if (!METHODS.contains(op.getKey())) {
                        continue;
                    }
                    Map<String, Object> operation = (Map<String, Object>) op.getValue();
                    String id = (String) operation.get("operationId");
                    String permission = (String) operation.get("x-permission");
                    if (id == null || permission == null) {
                        throw new IllegalStateException("Operation without operationId / x-permission in " + SPEC);
                    }
                    Object terminal = operation.get("x-terminal");
                    if (terminal != null && !TERMINAL_REQUIRED.equals(terminal)) {
                        throw new IllegalStateException("x-terminal of " + id + " must be REQUIRED, not " + terminal);
                    }
                    result.put(id, new Rule(id, permission, (String) operation.get("x-auth"), terminal != null));
                }
            }
            return result;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + SPEC + " from the classpath (run the Maven build)", e);
        }
    }
}
