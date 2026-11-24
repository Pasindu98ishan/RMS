package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.model.AuthSession;
import com.santhula.rms.api.generated.model.AuthUser;
import com.santhula.rms.api.generated.model.CurrentUserProfile;
import com.santhula.rms.api.generated.model.Permission;
import com.santhula.rms.api.generated.model.PermissionCode;
import com.santhula.rms.api.generated.model.PermissionModule;
import com.santhula.rms.api.generated.model.Role;
import com.santhula.rms.api.generated.model.RoleKey;
import com.santhula.rms.api.generated.model.RoleOption;
import com.santhula.rms.api.generated.model.RoleRef;
import com.santhula.rms.api.generated.model.RoleSummary;
import com.santhula.rms.api.generated.model.SessionType;
import com.santhula.rms.api.generated.model.Terminal;
import com.santhula.rms.api.generated.model.TerminalSummary;
import com.santhula.rms.api.generated.model.TerminalType;
import com.santhula.rms.api.generated.model.User;
import com.santhula.rms.api.generated.model.UserOption;
import com.santhula.rms.api.generated.model.UserSummary;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.service.AuthService;
import com.santhula.rms.auth.service.RoleService;
import com.santhula.rms.floor.service.OrderingPointService;
import com.santhula.rms.menu.service.KitchenStationService;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Domain -> generated DTOs, at the edge only (ADR-005). */
@Component
class AuthMapper {

    private final Clock clock;
    private final KitchenStationService stations;
    private final OrderingPointService orderingPoints;

    AuthMapper(Clock clock, KitchenStationService stations, OrderingPointService orderingPoints) {
        this.clock = clock;
        this.stations = stations;
        this.orderingPoints = orderingPoints;
    }

    AuthSession session(AuthService.Session s) {
        return new AuthSession(s.accessToken(), (int) s.expiresIn(), s.refreshToken(), (int) s.refreshExpiresIn(),
                authUser(s.user()), permissionCodes(s.permissions()), SessionType.fromValue(s.sessionType().name()))
                .terminal(s.terminal() == null ? null : terminalSummary(s.terminal()))
                .idleTimeoutMinutes(s.idleTimeoutMinutes());
    }

    CurrentUserProfile profile(AuthService.Profile p) {
        return new CurrentUserProfile(authUser(p.user()), permissionCodes(p.permissions()), SessionType.fromValue(p.sessionType().name()))
                .terminal(p.terminal() == null ? null : terminalSummary(p.terminal()))
                .idleTimeoutMinutes(p.idleTimeoutMinutes());
    }

    AuthUser authUser(AppUser u) {
        return new AuthUser(u.getId(), u.getUsername(), u.getFullName(), roleRefs(u), u.hasPin());
    }

    UserSummary userSummary(AppUser u) {
        Instant now = now();
        return new UserSummary(u.getId(), u.getUsername(), u.getFullName(), u.isActive(), u.isLocked(now), u.hasPin(),
                u.isPinLocked(now), roleRefs(u))
                .lastLoginAt(utc(u.getLastLoginAt()));
    }

    User user(AppUser u) {
        Instant now = now();
        User dto = new User(u.getId(), u.getUsername(), u.getFullName(), u.isActive(), u.isLocked(now), u.hasPin(),
                u.isPinLocked(now), roleRefs(u), u.getVersion(), utc(u.getCreatedAt()), utc(u.getUpdatedAt()))
                .phone(u.getPhone())
                .lastLoginAt(utc(u.getLastLoginAt()));
        if (u.isLocked(now)) {
            dto.lockedUntil(utc(u.getLockedUntil()));
        }
        if (u.isPinLocked(now)) {
            dto.pinLockedUntil(utc(u.getPinLockedUntil()));
        }
        return dto;
    }

    RoleSummary roleSummary(RoleService.RoleView v) {
        var r = v.role();
        return new RoleSummary(r.getId(), r.getName(), r.isSystem(), r.getPermissions().size(), (int) v.userCount())
                .key(roleKey(r))
                .description(r.getDescription());
    }

    Role role(RoleService.RoleView v) {
        var r = v.role();
        return new Role(r.getId(), r.getName(), r.isSystem(), permissionCodeSet(r.permissionCodes()), (int) v.userCount(),
                r.getVersion(), utc(r.getCreatedAt()), utc(r.getUpdatedAt()))
                .key(roleKey(r))
                .description(r.getDescription());
    }

    Permission permission(com.santhula.rms.auth.domain.Permission p) {
        return new Permission(PermissionCode.fromValue(p.getCode()), p.getDescription(), PermissionModule.fromValue(p.getModule()));
    }

    TerminalSummary terminalSummary(com.santhula.rms.auth.domain.Terminal t) {
        return new TerminalSummary(t.getId(), t.getName(), TerminalType.fromValue(t.getType().name()), t.isActive())
                .kitchenStationId(t.getKitchenStationId())
                .kitchenStationName(stations.name(t.getKitchenStationId()).orElse(null))
                .orderingPointId(t.getOrderingPointId())
                .orderingPointName(orderingPoints.name(t.getOrderingPointId()).orElse(null));
    }

    Terminal terminal(com.santhula.rms.auth.domain.Terminal t) {
        return new Terminal(t.getId(), t.getName(), TerminalType.fromValue(t.getType().name()), t.isActive(), t.getVersion(),
                utc(t.getCreatedAt()), utc(t.getUpdatedAt()))
                .kitchenStationId(t.getKitchenStationId())
                .kitchenStationName(stations.name(t.getKitchenStationId()).orElse(null))
                .orderingPointId(t.getOrderingPointId())
                .orderingPointName(orderingPoints.name(t.getOrderingPointId()).orElse(null))
                .lastLoginAt(utc(t.getLastLoginAt()));
    }

    static com.santhula.rms.common.domain.TerminalType domainType(TerminalType t) {
        return t == null ? null : com.santhula.rms.common.domain.TerminalType.valueOf(t.getValue());
    }

    private List<RoleRef> roleRefs(AppUser u) {
        return u.sortedRoles().stream().map(r -> new RoleRef(r.getId(), r.getName(), r.isSystem()).key(roleKey(r))).toList();
    }

    RoleOption roleOption(com.santhula.rms.auth.domain.Role r) {
        return new RoleOption(r.getId(), r.getName()).key(roleKey(r));
    }

    UserOption userOption(AppUser u) {
        return new UserOption(u.getId(), u.getUsername(), u.getFullName());
    }

    /** Stable key of a system role; null (omitted) for custom roles. */
    static RoleKey roleKey(com.santhula.rms.auth.domain.Role r) {
        return r.getSystemCode() == null ? null : RoleKey.fromValue(r.getSystemCode().name());
    }

    private static Set<PermissionCode> permissionCodes(List<String> codes) {
        return permissionCodeSet(codes);
    }

    private static Set<PermissionCode> permissionCodeSet(List<String> codes) {
        Set<PermissionCode> set = new LinkedHashSet<>();
        for (String c : codes) {
            set.add(PermissionCode.fromValue(c));
        }
        return set;
    }

    private Instant now() {
        return Instant.now(clock);
    }

    static OffsetDateTime utc(Instant i) {
        return i == null ? null : i.atOffset(ZoneOffset.UTC);
    }
}
