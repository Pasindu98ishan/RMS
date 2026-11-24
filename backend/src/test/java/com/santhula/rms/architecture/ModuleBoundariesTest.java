package com.santhula.rms.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Module boundaries (ADR-001, architecture.md section 2): a module may use another module only
 * through its `service` package; `api`, `domain`, `repo` and `config` stay private. `common`
 * depends on no business module. Generated DTOs live at the edge only (ADR-005).
 */
class ModuleBoundariesTest {

    private static final List<String> MODULES = List.of("auth", "audit", "settings", "menu", "floor", "dataimport");
    private static JavaClasses classes;

    @BeforeAll
    static void load() {
        classes = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.santhula.rms");
    }

    @Test
    void ADR001_modulesTalkOnlyThroughServicePackages() {
        for (String module : MODULES) {
            String base = "com.santhula.rms." + module;
            ArchRule rule = noClasses()
                    .that().resideOutsideOfPackage(base + "..")
                    .should().dependOnClassesThat().resideInAnyPackage(
                            base + ".api..", base + ".domain..", base + ".repo..", base + ".config..")
                    .because("other modules may only use " + base + ".service");
            rule.check(classes);
        }
    }

    @Test
    void ADR001_repositoriesAreOnlyUsedInsideTheirOwnModule() {
        for (String module : MODULES) {
            noClasses().that().resideOutsideOfPackage("com.santhula.rms." + module + "..")
                    .should().dependOnClassesThat().resideInAPackage("com.santhula.rms." + module + ".repo..")
                    .check(classes);
        }
    }

    @Test
    void ADR001_commonDependsOnNoBusinessModule() {
        noClasses().that().resideInAPackage("com.santhula.rms.common..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "com.santhula.rms.auth..", "com.santhula.rms.audit..", "com.santhula.rms.settings..",
                        "com.santhula.rms.menu..", "com.santhula.rms.floor..", "com.santhula.rms.dataimport..",
                        "com.santhula.rms.devseed..", "com.santhula.rms.testsupport..")
                .check(classes);
    }

    @Test
    void ADR005_generatedDtosStayAtTheEdge() {
        noClasses().that().resideInAnyPackage("..service..", "..domain..", "..repo..")
                .should().dependOnClassesThat().resideInAPackage("com.santhula.rms.api.generated..")
                .because("controllers map generated DTOs to service types (ADR-005)")
                .check(classes);
    }

    @Test
    void devSeedIsDevOnlyWiring_nothingDependsOnIt() {
        noClasses().that().resideOutsideOfPackage("com.santhula.rms.devseed..")
                .should().dependOnClassesThat().resideInAPackage("com.santhula.rms.devseed..")
                .check(classes);
    }

    @Test
    void productionCodeNeverUsesTestSupport() {
        noClasses().that().resideOutsideOfPackage("com.santhula.rms.testsupport..")
                .should().dependOnClassesThat().resideInAPackage("com.santhula.rms.testsupport..")
                .check(classes);
    }
}
