package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.Permission;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.PermissionRepository;
import com.santhula.rms.auth.repo.RoleRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Roles and the permission list (P1-RBAC-01/02). */
@Service
public class RoleService {

    private final RoleRepository roles;
    private final PermissionRepository permissions;
    private final AppUserRepository users;
    private final AuditService audit;
    private final RmsProperties properties;

    public RoleService(RoleRepository roles, PermissionRepository permissions, AppUserRepository users,
                       AuditService audit, RmsProperties properties) {
        this.roles = roles;
        this.permissions = permissions;
        this.users = users;
        this.audit = audit;
        this.properties = properties;
    }

    public record RoleView(Role role, long userCount) {
    }

    @Transactional(readOnly = true)
    public List<RoleView> list() {
        return roles.findByBranchId(properties.branchId()).stream()
                .sorted(Comparator.comparing((Role r) -> !r.isSystem())
                        .thenComparing(r -> r.isSystem() ? r.getSystemCode().ordinal() : 0)
                        .thenComparing(Role::getName, String.CASE_INSENSITIVE_ORDER))
                .map(this::view)
                .toList();
    }

    @Transactional(readOnly = true)
    public RoleView get(UUID id) {
        return view(find(id));
    }

    @Transactional(readOnly = true)
    public List<Permission> permissions() {
        return permissions.findAllByOrderBySortOrder();
    }

    @Transactional
    public RoleView create(String name, String description, Collection<String> codes) {
        String trimmed = name.trim();
        if (roles.existsByBranchIdAndNameIgnoreCase(properties.branchId(), trimmed)) {
            throw nameTaken(trimmed);
        }
        Role role = new Role(properties.branchId(), trimmed, blankToNull(description));
        role.replacePermissions(permissionsOrFail(codes));
        roles.saveAndFlush(role);
        audit.record(AuditRecord.of(AuditAction.CREATE, "ROLE", role.getId()).after(AuthSnapshots.role(role)).build());
        return view(role);
    }

    @Transactional
    public RoleView update(UUID id, String name, String description, Collection<String> codes, int expectedVersion) {
        Role role = find(id);
        if (role.isOwnerRole()) {
            throw ApiException.conflict("OWNER_ROLE_READ_ONLY", "The Owner role can't be changed",
                    "The Owner role always has every permission and can't be edited.");
        }
        if (role.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("role");
        }
        String trimmed = name.trim();
        if (role.isSystem() && !role.getName().equals(trimmed)) {
            throw ApiException.conflict("SYSTEM_ROLE_READ_ONLY", "Built-in role",
                    "Built-in roles can't be renamed. You can still change their permissions.");
        }
        if (roles.existsByBranchIdAndNameIgnoreCaseAndIdNot(properties.branchId(), trimmed, id)) {
            throw nameTaken(trimmed);
        }
        Set<Permission> newPermissions = permissionsOrFail(codes);
        Map<String, Object> before = AuthSnapshots.role(role);
        role.rename(trimmed, blankToNull(description));
        role.replacePermissions(newPermissions);
        roles.saveAndFlush(role);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "ROLE", role.getId()).before(before).after(AuthSnapshots.role(role)).build());
        return view(role);
    }

    @Transactional
    public void delete(UUID id) {
        Role role = find(id);
        if (role.isSystem()) {
            throw ApiException.conflict("SYSTEM_ROLE_READ_ONLY", "Built-in role", "Built-in roles can't be deleted.");
        }
        if (users.existsByRole(id)) {
            throw ApiException.conflict("ROLE_IN_USE", "Role in use",
                    "Users still have this role. Give them another role first.");
        }
        Map<String, Object> before = AuthSnapshots.role(role);
        roles.delete(role);
        roles.flush();
        audit.record(AuditRecord.of(AuditAction.DELETE, "ROLE", id).before(before).build());
    }

    // ------------------------------------------------------------------ helpers

    private RoleView view(Role role) {
        return new RoleView(role, users.countActiveByRole(role.getId()));
    }

    private Role find(UUID id) {
        return roles.findById(id).orElseThrow(() -> ApiException.notFound("This role"));
    }

    private Set<Permission> permissionsOrFail(Collection<String> codes) {
        Set<String> wanted = new HashSet<>(codes);
        List<Permission> found = permissions.findByCodeIn(wanted);
        if (found.size() != wanted.size()) {
            throw ApiException.validation("permissionCodes", "One or more permissions do not exist");
        }
        return new HashSet<>(found);
    }

    private static ApiException nameTaken(String name) {
        return ApiException.conflict("ROLE_NAME_TAKEN", "Role name taken", "A role called '" + name + "' already exists.");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
