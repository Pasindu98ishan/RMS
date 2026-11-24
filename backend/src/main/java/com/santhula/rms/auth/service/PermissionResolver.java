package com.santhula.rms.auth.service;

import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Permission;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.repo.PermissionRepository;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/** A user's effective permissions: the union of their roles. The Owner role always has all of them. */
@Component
public class PermissionResolver {

    private final PermissionRepository permissions;

    public PermissionResolver(PermissionRepository permissions) {
        this.permissions = permissions;
    }

    public List<String> effectivePermissions(AppUser user) {
        if (user.isOwner()) {
            return permissions.findAllByOrderBySortOrder().stream().map(Permission::getCode).toList();
        }
        Set<Permission> all = new LinkedHashSet<>();
        for (Role role : user.getRoles()) {
            all.addAll(role.getPermissions());
        }
        return all.stream().sorted(Comparator.comparingInt(Permission::getSortOrder)).map(Permission::getCode).distinct().toList();
    }

    public boolean hasPermission(AppUser user, String code) {
        return effectivePermissions(user).contains(code);
    }
}
