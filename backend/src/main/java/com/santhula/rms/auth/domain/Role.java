package com.santhula.rms.auth.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.hibernate.annotations.BatchSize;

@Entity
@Table(name = "role")
public class Role extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(nullable = false)
    private String name;

    private String description;

    @Column(nullable = false)
    private boolean system;

    @Enumerated(EnumType.STRING)
    @Column(name = "system_code")
    private SystemRole systemCode;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "role_permission",
            joinColumns = @JoinColumn(name = "role_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    @BatchSize(size = 50)
    private Set<Permission> permissions = new HashSet<>();

    protected Role() {
    }

    public Role(UUID branchId, String name, String description) {
        this.branchId = branchId;
        this.name = name;
        this.description = description;
        this.system = false;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public boolean isSystem() {
        return system;
    }

    public SystemRole getSystemCode() {
        return systemCode;
    }

    public boolean isOwnerRole() {
        return systemCode == SystemRole.OWNER;
    }

    public Set<Permission> getPermissions() {
        return permissions;
    }

    public List<String> permissionCodes() {
        return permissions.stream().sorted(Comparator.comparingInt(Permission::getSortOrder)).map(Permission::getCode).toList();
    }

    public void rename(String name, String description) {
        this.name = name;
        this.description = description;
    }

    public void replacePermissions(Set<Permission> newPermissions) {
        permissions.clear();
        permissions.addAll(newPermissions);
    }
}
