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
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates the first owner on startup from RMS_BOOTSTRAP_OWNER_USERNAME / _PASSWORD / _PIN, only
 * when no active user holds the Owner role. That owner then registers the first terminal
 * (POST /terminals takes the owner's credentials inline, ADR-006) and logs in on it.
 */
@Component
@org.springframework.core.annotation.Order(0)
public class BootstrapOwner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BootstrapOwner.class);

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;
    private final RmsProperties properties;

    public BootstrapOwner(AppUserRepository users, RoleRepository roles, PasswordEncoder passwordEncoder,
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
        if (users.countActiveOwners(SystemRole.OWNER) > 0) {
            return;
        }
        RmsProperties.Bootstrap b = properties.bootstrap();
        if (b == null || isBlank(b.ownerUsername()) || isBlank(b.ownerPassword())) {
            log.warn("No active owner exists and RMS_BOOTSTRAP_OWNER_USERNAME / RMS_BOOTSTRAP_OWNER_PASSWORD are not set: "
                    + "nobody can log in until an owner is bootstrapped.");
            return;
        }
        String username = b.ownerUsername().trim().toLowerCase(Locale.ROOT);
        if (!username.matches("^[a-z0-9._-]{3,32}$")) {
            throw new IllegalStateException("RMS_BOOTSTRAP_OWNER_USERNAME must be 3-32 of a-z 0-9 . _ -");
        }
        if (b.ownerPassword().length() < 8 || b.ownerPassword().length() > 72) {
            throw new IllegalStateException("RMS_BOOTSTRAP_OWNER_PASSWORD must be 8-72 characters");
        }
        if (!isBlank(b.ownerPin()) && !b.ownerPin().matches("^\\d{4,6}$")) {
            throw new IllegalStateException("RMS_BOOTSTRAP_OWNER_PIN must be 4-6 digits");
        }
        if (users.existsByUsernameIgnoreCase(username)) {
            log.error("No active owner exists, but user '{}' already exists (inactive or without the Owner role). "
                    + "Not creating a bootstrap owner; fix this user in the database or choose another username.", username);
            return;
        }
        Role ownerRole = roles.findById(SystemRole.OWNER.id()).orElseThrow(() -> new IllegalStateException("Owner role missing"));
        AppUser owner = new AppUser(properties.branchId(), username, passwordEncoder.encode(b.ownerPassword()),
                isBlank(b.ownerFullName()) ? "Owner" : b.ownerFullName().trim(), null);
        if (!isBlank(b.ownerPin())) {
            owner.changePinHash(passwordEncoder.encode(b.ownerPin()));
        }
        owner.replaceRoles(Set.of(ownerRole));
        users.saveAndFlush(owner);
        audit.record(AuditRecord.of(AuditAction.CREATE, "USER", owner.getId())
                .actor(new AuditRecord.Person(null, "system", "System bootstrap"))
                .after(AuthSnapshots.user(owner))
                .reason("Bootstrap owner created on first start").build());
        log.info("Bootstrap owner '{}' created. Register the first terminal with these credentials (POST /api/v1/terminals).", username);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
