package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.RoleRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.CurrentActor;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** User administration (owner, USER_MANAGE). */
@Service
public class UserService {

    private static final Set<String> SORTABLE = Set.of("username", "fullName", "lastLoginAt", "createdAt");

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder passwordEncoder;
    private final RefreshTokenService refreshTokens;
    private final AuditService audit;
    private final RmsProperties properties;

    public UserService(AppUserRepository users, RoleRepository roles, PasswordEncoder passwordEncoder,
                       RefreshTokenService refreshTokens, AuditService audit, RmsProperties properties) {
        this.users = users;
        this.roles = roles;
        this.passwordEncoder = passwordEncoder;
        this.refreshTokens = refreshTokens;
        this.audit = audit;
        this.properties = properties;
    }

    public record UserFilter(Boolean active, UUID roleId, String search) {
    }

    public record NewUser(String username, String fullName, String phone, String password, String pin, Collection<UUID> roleIds) {
    }

    @Transactional(readOnly = true)
    public Page<AppUser> list(UserFilter filter, int page, int size, String sort) {
        Sort order = Sort.by("username");
        if (sort != null) {
            String[] parts = sort.split(",");
            if (!SORTABLE.contains(parts[0])) {
                throw ApiException.validation("sort", "Users can be sorted by username, fullName, lastLoginAt or createdAt");
            }
            order = Sort.by(Sort.Direction.fromString(parts[1]), parts[0]).and(Sort.by("username"));
        }
        return users.findAll(spec(filter), PageRequest.of(page, size, order));
    }

    /** Every user of the branch, active or not, by username (audit log filter). */
    @Transactional(readOnly = true)
    public List<AppUser> options() {
        return users.findAll(spec(new UserFilter(null, null, null)), Sort.by("username"));
    }

    @Transactional(readOnly = true)
    public AppUser get(UUID id) {
        return find(id);
    }

    @Transactional
    public AppUser create(NewUser cmd) {
        String username = cmd.username().trim().toLowerCase(Locale.ROOT);
        PasswordRules.check(username, cmd.password(), "password");
        Set<Role> assigned = rolesOrFail(cmd.roleIds());
        if (users.existsByUsernameIgnoreCase(username)) {
            throw ApiException.conflict("USERNAME_TAKEN", "Username taken", "The username '" + username + "' is already taken.");
        }
        AppUser user = new AppUser(properties.branchId(), username, passwordEncoder.encode(cmd.password()),
                cmd.fullName().trim(), blankToNull(cmd.phone()));
        if (cmd.pin() != null) {
            user.changePinHash(passwordEncoder.encode(cmd.pin()));
        }
        user.replaceRoles(assigned);
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.CREATE, "USER", user.getId()).after(AuthSnapshots.user(user)).build());
        return user;
    }

    @Transactional
    public AppUser update(UUID id, String fullName, String phone, int expectedVersion) {
        AppUser user = find(id);
        checkVersion(user, expectedVersion);
        Map<String, Object> before = AuthSnapshots.user(user);
        user.updateDetails(fullName.trim(), blankToNull(phone));
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "USER", user.getId()).before(before).after(AuthSnapshots.user(user)).build());
        return user;
    }

    @Transactional
    public AppUser deactivate(UUID id) {
        AppUser user = find(id);
        if (CurrentActor.current().map(a -> a.userId().equals(id)).orElse(false)) {
            throw ApiException.conflict("CANNOT_DEACTIVATE_SELF", "You can't deactivate yourself",
                    "You can't deactivate your own account. Ask another owner.");
        }
        if (!user.isActive()) {
            return user;
        }
        if (user.isOwner() && users.countOtherActiveOwners(user.getId()) == 0) {
            throw lastOwner();
        }
        Map<String, Object> before = AuthSnapshots.user(user);
        user.setActive(false);
        users.saveAndFlush(user);
        refreshTokens.revokeAllForUser(user.getId());
        audit.record(AuditRecord.of(AuditAction.DEACTIVATE, "USER", user.getId()).before(before).after(AuthSnapshots.user(user)).build());
        return user;
    }

    @Transactional
    public AppUser activate(UUID id) {
        AppUser user = find(id);
        if (user.isActive()) {
            return user;
        }
        Map<String, Object> before = AuthSnapshots.user(user);
        user.setActive(true);
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.ACTIVATE, "USER", user.getId()).before(before).after(AuthSnapshots.user(user)).build());
        return user;
    }

    @Transactional
    public AppUser unlock(UUID id) {
        AppUser user = find(id);
        boolean wasLocked = user.getFailedAttempts() != 0 || user.getLockedUntil() != null
                || user.getPinFailedAttempts() != 0 || user.getPinLockedUntil() != null;
        if (!wasLocked) {
            return user;
        }
        user.unlock();
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.ACCOUNT_UNLOCKED, "USER", user.getId())
                .after(Map.of("username", user.getUsername())).build());
        return user;
    }

    @Transactional
    public void resetPassword(UUID id, String newPassword) {
        AppUser user = find(id);
        PasswordRules.check(user.getUsername(), newPassword, "newPassword");
        user.changePasswordHash(passwordEncoder.encode(newPassword));
        user.clearPasswordFailures();
        users.saveAndFlush(user);
        refreshTokens.revokeAllForUser(user.getId());
        audit.record(AuditRecord.of(AuditAction.PASSWORD_RESET, "USER", user.getId())
                .after(Map.of("username", user.getUsername())).build());
    }

    @Transactional
    public void resetPin(UUID id, String newPin) {
        AppUser user = find(id);
        user.changePinHash(passwordEncoder.encode(newPin));
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.PIN_RESET, "USER", user.getId())
                .after(Map.of("username", user.getUsername())).build());
    }

    @Transactional
    public AppUser assignRoles(UUID id, Collection<UUID> roleIds, int expectedVersion) {
        AppUser user = find(id);
        checkVersion(user, expectedVersion);
        Set<Role> assigned = rolesOrFail(roleIds);
        boolean keepsOwner = assigned.stream().anyMatch(Role::isOwnerRole);
        if (user.isActive() && user.isOwner() && !keepsOwner && users.countOtherActiveOwners(user.getId()) == 0) {
            throw lastOwner();
        }
        List<String> before = AuthSnapshots.roleNames(user);
        user.replaceRoles(assigned);
        users.saveAndFlush(user);
        audit.record(AuditRecord.of(AuditAction.ROLES_ASSIGNED, "USER", user.getId())
                .before(Map.of("roles", before)).after(Map.of("roles", AuthSnapshots.roleNames(user))).build());
        return user;
    }

    // ------------------------------------------------------------------ helpers

    private AppUser find(UUID id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("This user"));
    }

    private Set<Role> rolesOrFail(Collection<UUID> roleIds) {
        Set<UUID> wanted = new HashSet<>(roleIds);
        List<Role> found = roles.findAllById(wanted);
        if (found.size() != wanted.size()) {
            throw ApiException.validation("roleIds", "One or more roles do not exist");
        }
        return new HashSet<>(found);
    }

    private static void checkVersion(AppUser user, int expected) {
        if (user.getVersion() != expected) {
            throw ApiException.versionConflict("user");
        }
    }

    private static ApiException lastOwner() {
        return ApiException.conflict("LAST_OWNER", "Last owner",
                "This is the last active owner. Give another user the Owner role first.");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private Specification<AppUser> spec(UserFilter f) {
        return (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("branchId"), properties.branchId()));
            if (f.active() != null) {
                p.add(cb.equal(root.get("active"), f.active()));
            }
            if (f.roleId() != null) {
                Join<AppUser, Role> r = root.join("roles");
                p.add(cb.equal(r.get("id"), f.roleId()));
                query.distinct(true);
            }
            if (f.search() != null && !f.search().isBlank()) {
                String like = "%" + f.search().trim().toLowerCase(Locale.ROOT).replace("%", "\\%").replace("_", "\\_") + "%";
                p.add(cb.or(cb.like(cb.lower(root.get("username")), like, '\\'),
                        cb.like(cb.lower(root.get("fullName")), like, '\\')));
            }
            return cb.and(p.toArray(Predicate[]::new));
        };
    }
}
