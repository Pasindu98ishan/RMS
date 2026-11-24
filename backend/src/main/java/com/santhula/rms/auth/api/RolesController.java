package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.api.RolesApi;
import com.santhula.rms.api.generated.model.CreateRoleRequest;
import com.santhula.rms.api.generated.model.Permission;
import com.santhula.rms.api.generated.model.PermissionCode;
import com.santhula.rms.api.generated.model.Role;
import com.santhula.rms.api.generated.model.RoleOption;
import com.santhula.rms.api.generated.model.RoleSummary;
import com.santhula.rms.api.generated.model.UpdateRoleRequest;
import com.santhula.rms.auth.service.RoleService;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RolesController implements RolesApi {

    private final RoleService roles;
    private final AuthMapper mapper;

    public RolesController(RoleService roles, AuthMapper mapper) {
        this.roles = roles;
        this.mapper = mapper;
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<List<RoleSummary>> listRoles() {
        return ResponseEntity.ok(roles.list().stream().map(mapper::roleSummary).toList());
    }

    /** Narrow lookup for the user forms: USER_MANAGE, not ROLE_MANAGE. */
    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<List<RoleOption>> listRoleOptions() {
        return ResponseEntity.ok(roles.list().stream().map(v -> mapper.roleOption(v.role())).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<Role> createRole(CreateRoleRequest req) {
        var view = roles.create(req.getName(), req.getDescription(), codes(req.getPermissionCodes()));
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.role(view));
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<Role> getRole(UUID roleId) {
        return ResponseEntity.ok(mapper.role(roles.get(roleId)));
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<Role> updateRole(UUID roleId, UpdateRoleRequest req) {
        var view = roles.update(roleId, req.getName(), req.getDescription(), codes(req.getPermissionCodes()), req.getVersion());
        return ResponseEntity.ok(mapper.role(view));
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<Void> deleteRole(UUID roleId) {
        roles.delete(roleId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PreAuthorize("hasAuthority('ROLE_MANAGE')")
    public ResponseEntity<List<Permission>> listPermissions() {
        return ResponseEntity.ok(roles.permissions().stream().map(mapper::permission).toList());
    }

    private static List<String> codes(Collection<PermissionCode> codes) {
        return codes.stream().map(PermissionCode::getValue).toList();
    }
}
