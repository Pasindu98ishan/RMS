package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.RoleRepository;
import com.santhula.rms.common.config.RmsProperties;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates one login per seeded role so a developer can try every role. Spring profile `dev` ONLY:
 * the class is not even a bean in any other profile (DevDataSeederAbsentIT). Idempotent: users
 * that already exist are left alone. The credentials are public (backend/README.md): never
 * enable the `dev` profile on a server people use.
 */
@Component
@Profile("dev")
@Order(20)
public class DevDataSeeder implements ApplicationRunner {

    static final String PASSWORD = "dev-pass-1234";
    static final String PIN = "1234";

    record DevUser(String username, String fullName, SystemRole role) {
    }

    static final List<DevUser> USERS = List.of(
            new DevUser("manager1", "Dev Manager", SystemRole.MANAGER),
            new DevUser("cashier1", "Dev Cashier", SystemRole.CASHIER),
            new DevUser("reception1", "Dev Receptionist", SystemRole.RECEPTIONIST),
            new DevUser("kitchen1", "Dev Kitchen", SystemRole.KITCHEN),
            new DevUser("rider1", "Dev Rider", SystemRole.RIDER),
            new DevUser("inventory1", "Dev Inventory", SystemRole.INVENTORY),
            new DevUser("hr1", "Dev HR", SystemRole.HR));

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;
    private final RmsProperties properties;

    public DevDataSeeder(AppUserRepository users, RoleRepository roles, PasswordEncoder passwordEncoder,
                         AuditService audit, RmsProperties properties) {
        this.users = users;
        this.roles = roles;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int created = 0;
        for (DevUser d : USERS) {
            if (users.existsByUsernameIgnoreCase(d.username())) {
                log.debug("Dev seed: '{}' already exists, skipped", d.username());
                continue;
            }
            Role role = roles.findById(d.role().id()).orElse(null);
            if (role == null) {
                log.warn("Dev seed: role {} is missing, skipped '{}'", d.role(), d.username());
                continue;
            }
            AppUser user = new AppUser(properties.branchId(), d.username(), passwordEncoder.encode(PASSWORD), d.fullName(), null);
            user.changePinHash(passwordEncoder.encode(PIN));
            user.replaceRoles(Set.of(role));
            users.saveAndFlush(user);
            audit.record(AuditRecord.of(AuditAction.CREATE, "USER", user.getId())
                    .actor(new AuditRecord.Person(null, "system", "Dev data seeder"))
                    .after(AuthSnapshots.user(user))
                    .reason("Dev seed (profile dev)").build());
            log.info("Dev seed: created user '{}' with role {}", d.username(), role.getName());
            created++;
        }
        log.info("Dev seed: {} user(s) created, {} already existed (password and PIN are in backend/README.md)",
                created, USERS.size() - created);
    }
}
