package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.domain.Terminal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Before/after values for the audit log. Never includes password or PIN hashes. */
final class AuthSnapshots {

    private AuthSnapshots() {
    }

    static Map<String, Object> user(AppUser u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("username", u.getUsername());
        m.put("fullName", u.getFullName());
        m.put("phone", u.getPhone());
        m.put("active", u.isActive());
        m.put("roles", roleNames(u));
        m.put("pinSet", u.hasPin());
        return m;
    }

    static List<String> roleNames(AppUser u) {
        return u.sortedRoles().stream().map(Role::getName).toList();
    }

    static Map<String, Object> role(Role r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", r.getName());
        m.put("description", r.getDescription());
        m.put("system", r.isSystem());
        m.put("permissionCodes", r.permissionCodes());
        return m;
    }

    static Map<String, Object> terminal(Terminal t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", t.getName());
        m.put("type", t.getType().name());
        m.put("kitchenStationId", t.getKitchenStationId() == null ? null : t.getKitchenStationId().toString());
        m.put("orderingPointId", t.getOrderingPointId() == null ? null : t.getOrderingPointId().toString());
        m.put("active", t.isActive());
        return m;
    }

    static AuditRecord.Person person(AppUser u) {
        return new AuditRecord.Person(u.getId(), u.getUsername(), u.getFullName());
    }

    static AuditRecord.Place place(Terminal t) {
        return t == null ? null : new AuditRecord.Place(t.getId(), t.getName());
    }
}
