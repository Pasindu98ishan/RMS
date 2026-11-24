package com.santhula.rms.auth.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Terminal;
import com.santhula.rms.auth.repo.TerminalRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.domain.TerminalType;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.floor.service.OrderingPointService;
import com.santhula.rms.menu.service.KitchenStationService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Terminal registration and management (P1-AUTH-04, ADR-006). */
@Service
public class TerminalService {

    static final String TERMINAL_MANAGE = "TERMINAL_MANAGE";

    private final TerminalRepository terminals;
    private final CredentialChecker credentials;
    private final PermissionResolver permissions;
    private final RefreshTokenService refreshTokens;
    private final RegistrationRateLimiter rateLimiter;
    private final KitchenStationService stations;
    private final OrderingPointService orderingPoints;
    private final AuditService audit;
    private final RmsProperties properties;

    @SuppressWarnings("java:S107")
    public TerminalService(TerminalRepository terminals, CredentialChecker credentials, PermissionResolver permissions,
                           RefreshTokenService refreshTokens, RegistrationRateLimiter rateLimiter, AuditService audit,
                           RmsProperties properties, KitchenStationService stations, OrderingPointService orderingPoints) {
        this.terminals = terminals;
        this.rateLimiter = rateLimiter;
        this.stations = stations;
        this.orderingPoints = orderingPoints;
        this.credentials = credentials;
        this.permissions = permissions;
        this.refreshTokens = refreshTokens;
        this.audit = audit;
        this.properties = properties;
    }

    public record TerminalDetails(String name, TerminalType type, UUID kitchenStationId, UUID orderingPointId) {
    }

    public record Registration(Terminal terminal, String deviceToken) {
    }

    @Transactional(readOnly = true)
    public List<Terminal> list(Boolean active, TerminalType type) {
        return terminals.findByBranchIdOrderByName(properties.branchId()).stream()
                .filter(t -> active == null || t.isActive() == active)
                .filter(t -> type == null || t.getType() == type)
                .toList();
    }

    @Transactional(readOnly = true)
    public Terminal get(UUID id) {
        return find(id);
    }

    /**
     * Registers the calling device. No access token: the credentials of a TERMINAL_MANAGE holder
     * are checked inline. Wrong credentials don't count towards the account lock; they are rate
     * limited per client IP (429). Runs with noRollbackFor so failed attempts stay in the audit log.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public Registration register(String username, String password, TerminalDetails details, String clientIp) {
        rateLimiter.checkAllowed(clientIp);
        AppUser registrar = credentials.checkWithoutLockout(username, password, "Terminal registration");
        if (registrar == null) {
            rateLimiter.recordFailure(clientIp);
            throw CredentialChecker.invalidCredentials();
        }
        if (!permissions.hasPermission(registrar, TERMINAL_MANAGE)) {
            throw ApiException.forbidden("FORBIDDEN", "Not allowed", "This user is not allowed to register terminals.");
        }
        validate(details);
        String name = details.name().trim();
        if (terminals.activeNameTaken(properties.branchId(), name, null)) {
            throw nameTaken(name);
        }
        String deviceToken = SecureTokens.newToken();
        Terminal terminal = new Terminal(properties.branchId(), name, details.type(), details.kitchenStationId(),
                details.orderingPointId(), SecureTokens.sha256Hex(deviceToken));
        terminals.saveAndFlush(terminal);
        audit.record(AuditRecord.of(AuditAction.TERMINAL_REGISTERED, "TERMINAL", terminal.getId())
                .actor(AuthSnapshots.person(registrar))
                .terminal(AuthSnapshots.place(terminal))
                .after(AuthSnapshots.terminal(terminal)).build());
        return new Registration(terminal, deviceToken);
    }

    @Transactional
    public Terminal update(UUID id, TerminalDetails details, int expectedVersion) {
        Terminal terminal = find(id);
        if (terminal.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("terminal");
        }
        validate(details);
        String name = details.name().trim();
        if (terminal.isActive() && terminals.activeNameTaken(properties.branchId(), name, id)) {
            throw nameTaken(name);
        }
        Map<String, Object> before = AuthSnapshots.terminal(terminal);
        terminal.update(name, details.type(), details.kitchenStationId(), details.orderingPointId());
        terminals.saveAndFlush(terminal);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "TERMINAL", id).before(before).after(AuthSnapshots.terminal(terminal)).build());
        return terminal;
    }

    @Transactional
    public Terminal deactivate(UUID id) {
        Terminal terminal = find(id);
        if (!terminal.isActive()) {
            return terminal;
        }
        Map<String, Object> before = AuthSnapshots.terminal(terminal);
        terminal.deactivate();
        terminals.saveAndFlush(terminal);
        refreshTokens.revokeAllForTerminal(id);
        audit.record(AuditRecord.of(AuditAction.DEACTIVATE, "TERMINAL", id).before(before).after(AuthSnapshots.terminal(terminal)).build());
        return terminal;
    }

    // ------------------------------------------------------------------ helpers

    private Terminal find(UUID id) {
        return terminals.findById(id).orElseThrow(() -> ApiException.notFound("This terminal"));
    }

    /** KITCHEN needs a station; only POS terminals have an ordering point. Stations exist from M1.1. */
    /**
     * KITCHEN needs an active station; only POS terminals have an ordering point, and it must exist
     * (P1-AUTH-04, M1.1). Unknown references are 422 field errors.
     */
    private void validate(TerminalDetails d) {
        List<FieldViolation> errors = new ArrayList<>();
        if (d.type() == TerminalType.KITCHEN && d.kitchenStationId() == null) {
            errors.add(new FieldViolation("kitchenStationId", "Choose the kitchen station this screen belongs to"));
        }
        if (d.type() == TerminalType.KITCHEN && d.kitchenStationId() != null && stations.findActive(d.kitchenStationId()).isEmpty()) {
            errors.add(new FieldViolation("kitchenStationId", "This kitchen station does not exist or is switched off"));
        }
        if (d.type() != TerminalType.KITCHEN && d.kitchenStationId() != null) {
            errors.add(new FieldViolation("kitchenStationId", "Only kitchen terminals have a kitchen station"));
        }
        boolean pos = d.type() == TerminalType.CASHIER_POS || d.type() == TerminalType.RECEPTION_POS;
        if (!pos && d.orderingPointId() != null) {
            errors.add(new FieldViolation("orderingPointId", "Only POS terminals have an ordering point"));
        }
        if (pos && d.orderingPointId() != null && orderingPoints.find(d.orderingPointId()).isEmpty()) {
            errors.add(new FieldViolation("orderingPointId", "This ordering point does not exist"));
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
    }

    public record SetupOptions(List<KitchenStationService.StationInfo> kitchenStations, List<OrderingPointService.OrderingPointInfo> orderingPoints) {
    }

    /**
     * The choices for the terminal-setup screen of an unregistered device. Like register(): no access token,
     * the credentials of a TERMINAL_MANAGE holder are checked inline, wrong ones don't count towards the
     * account lock but towards the same per-IP limit (429). Changes nothing.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public SetupOptions setupOptions(String username, String password, String clientIp) {
        rateLimiter.checkAllowed(clientIp);
        AppUser user = credentials.checkWithoutLockout(username, password, "Terminal setup");
        if (user == null) {
            rateLimiter.recordFailure(clientIp);
            throw CredentialChecker.invalidCredentials();
        }
        if (!permissions.hasPermission(user, TERMINAL_MANAGE)) {
            throw ApiException.forbidden("FORBIDDEN", "Not allowed", "This user is not allowed to register terminals.");
        }
        return new SetupOptions(stations.activeStations(), orderingPoints.list());
    }

    private static ApiException nameTaken(String name) {
        return ApiException.conflict("TERMINAL_NAME_TAKEN", "Terminal name taken",
                "An active terminal called '" + name + "' already exists.");
    }
}
