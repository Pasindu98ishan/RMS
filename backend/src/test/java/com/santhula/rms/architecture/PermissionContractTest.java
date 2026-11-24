package com.santhula.rms.architecture;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import io.swagger.v3.oas.annotations.Operation;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Every operation in the contract is implemented, and the controller method's @PreAuthorize
 * matches the spec's x-permission (ADR-005 section 4):
 * code -> hasAuthority('CODE'), AUTHENTICATED -> isAuthenticated(), PUBLIC or
 * x-auth: INLINE_CREDENTIALS -> permitAll().
 *
 * <p>During a milestone the contract can run ahead of the code: operations listed in
 * {@code not-yet-implemented-operations.txt} are allowed to have no controller. The file must be
 * empty when the milestone is done; the test also fails if a listed operation IS implemented
 * (a stale entry).
 */
class PermissionContractTest {

    private static final Path BUNDLE = Path.of("target", "openapi.bundled.yaml");
    private static final Path NOT_YET = Path.of("src", "test", "resources", "not-yet-implemented-operations.txt");
    private static final Set<String> HTTP = Set.of("get", "put", "post", "delete", "patch");
    private static final Map<String, Map<String, Object>> SPEC_OPERATIONS = new HashMap<>();
    private static JavaClasses classes;

    @BeforeAll
    @SuppressWarnings("unchecked")
    static void load() throws Exception {
        try (InputStream in = Files.newInputStream(BUNDLE)) {
            Map<String, Object> root = new Yaml(new SafeConstructor(new LoaderOptions())).load(in);
            for (Object item : ((Map<String, Object>) root.get("paths")).values()) {
                ((Map<String, Object>) item).forEach((method, op) -> {
                    if (HTTP.contains(method)) {
                        Map<String, Object> operation = (Map<String, Object>) op;
                        SPEC_OPERATIONS.put((String) operation.get("operationId"), operation);
                    }
                });
            }
        }
        classes = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.santhula.rms");
    }

    private static Set<String> notYetImplemented() throws Exception {
        Set<String> ids = new HashSet<>();
        for (String line : Files.readAllLines(NOT_YET)) {
            String t = line.trim();
            if (!t.isEmpty() && !t.startsWith("#")) {
                ids.add(t);
            }
        }
        return ids;
    }

    @Test
    void ADR005_everyOperationHasAControllerMethodWithMatchingPreAuthorize() throws Exception {
        List<String> problems = new ArrayList<>();
        Map<String, Method> implemented = new HashMap<>();
        Set<String> allowed = notYetImplemented();

        for (JavaClass api : classes) {
            if (!api.getPackageName().equals("com.santhula.rms.api.generated.api") || !api.isInterface()) {
                continue;
            }
            Class<?> apiInterface = api.reflect();
            List<JavaClass> impls = classes.stream()
                    .filter(c -> !c.isInterface() && c.isAssignableTo(apiInterface) && !c.getPackageName().startsWith("com.santhula.rms.api.generated"))
                    .toList();
            if (impls.size() > 1) {
                problems.add(apiInterface.getSimpleName() + " has " + impls.size() + " implementations (expected 1)");
                continue;
            }
            if (impls.isEmpty()) {
                continue; // every operation of it must then be in the not-yet-implemented list (checked below)
            }
            Class<?> controller = impls.get(0).reflect();
            for (Method m : apiInterface.getMethods()) {
                Operation op = m.getAnnotation(Operation.class);
                if (op == null) {
                    continue;
                }
                Method impl = controller.getMethod(m.getName(), m.getParameterTypes());
                implemented.put(op.operationId(), impl);
            }
        }

        for (var entry : SPEC_OPERATIONS.entrySet()) {
            String operationId = entry.getKey();
            String permission = (String) entry.getValue().get("x-permission");
            Method impl = implemented.get(operationId);
            if (impl == null) {
                if (!allowed.contains(operationId)) {
                    problems.add(operationId + ": no controller implements it");
                }
                continue;
            }
            if (allowed.contains(operationId)) {
                problems.add(operationId + ": is implemented, remove it from not-yet-implemented-operations.txt");
            }
            PreAuthorize pre = impl.getAnnotation(PreAuthorize.class);
            String expected = expected(permission, (String) entry.getValue().get("x-auth"));
            if (pre == null) {
                problems.add(operationId + ": missing @PreAuthorize (expected " + expected + ")");
            } else if (!pre.value().replace(" ", "").equals(expected)) {
                problems.add(operationId + ": @PreAuthorize(\"" + pre.value() + "\") but spec says " + expected);
            }
        }
        for (String id : allowed) {
            if (!SPEC_OPERATIONS.containsKey(id)) {
                problems.add(id + ": listed in not-yet-implemented-operations.txt but not in the spec");
            }
        }
        assertThat(problems).isEmpty();
        assertThat(SPEC_OPERATIONS).hasSize(81);
    }

    static String expected(String permission, String xAuth) {
        if ("PUBLIC".equals(permission) || "INLINE_CREDENTIALS".equals(xAuth)) {
            return "permitAll()";
        }
        if ("AUTHENTICATED".equals(permission)) {
            return "isAuthenticated()";
        }
        return "hasAuthority('" + permission + "')";
    }
}
