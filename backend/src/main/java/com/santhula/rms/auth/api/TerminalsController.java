package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.api.TerminalsApi;
import com.santhula.rms.api.generated.model.KitchenStationOption;
import com.santhula.rms.api.generated.model.OrderingPoint;
import com.santhula.rms.api.generated.model.OwnerCredentials;
import com.santhula.rms.api.generated.model.RegisterTerminalRequest;
import com.santhula.rms.api.generated.model.TerminalSetupOptions;
import com.santhula.rms.api.generated.model.Terminal;
import com.santhula.rms.api.generated.model.TerminalRegistration;
import com.santhula.rms.api.generated.model.TerminalSummary;
import com.santhula.rms.api.generated.model.TerminalType;
import com.santhula.rms.api.generated.model.UpdateTerminalRequest;
import com.santhula.rms.auth.service.TerminalService;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TerminalsController implements TerminalsApi {

    private final TerminalService terminals;
    private final AuthMapper mapper;
    private final jakarta.servlet.http.HttpServletRequest request;

    /** {@code request} is Spring's request-scoped proxy (client IP for the registration rate limit). */
    public TerminalsController(TerminalService terminals, AuthMapper mapper, jakarta.servlet.http.HttpServletRequest request) {
        this.terminals = terminals;
        this.mapper = mapper;
        this.request = request;
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<List<TerminalSummary>> listTerminals(Boolean active, TerminalType type) {
        return ResponseEntity.ok(terminals.list(active, AuthMapper.domainType(type)).stream().map(mapper::terminalSummary).toList());
    }

    /** x-auth: INLINE_CREDENTIALS - TERMINAL_MANAGE is checked against the credentials in the body. */
    @Override
    @PreAuthorize("permitAll()")
    public ResponseEntity<TerminalRegistration> registerTerminal(RegisterTerminalRequest req) {
        var registration = terminals.register(req.getCredentials().getUsername(), req.getCredentials().getPassword(),
                new TerminalService.TerminalDetails(req.getName(), AuthMapper.domainType(req.getType()),
                        req.getKitchenStationId(), req.getOrderingPointId()), request.getRemoteAddr());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new TerminalRegistration(mapper.terminal(registration.terminal()), registration.deviceToken()));
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<Terminal> getTerminal(UUID terminalId) {
        return ResponseEntity.ok(mapper.terminal(terminals.get(terminalId)));
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<Terminal> updateTerminal(UUID terminalId, UpdateTerminalRequest req) {
        var t = terminals.update(terminalId, new TerminalService.TerminalDetails(req.getName(), AuthMapper.domainType(req.getType()),
                req.getKitchenStationId(), req.getOrderingPointId()), req.getVersion());
        return ResponseEntity.ok(mapper.terminal(t));
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<Terminal> deactivateTerminal(UUID terminalId) {
        return ResponseEntity.ok(mapper.terminal(terminals.deactivate(terminalId)));
    }

    /** x-auth: INLINE_CREDENTIALS, like registerTerminal: the owner's credentials in the body, no token. */
    @Override
    @PreAuthorize("permitAll()")
    public ResponseEntity<TerminalSetupOptions> getTerminalSetupOptions(OwnerCredentials credentials) {
        var options = terminals.setupOptions(credentials.getUsername(), credentials.getPassword(), request.getRemoteAddr());
        return ResponseEntity.ok(new TerminalSetupOptions(
                options.kitchenStations().stream().map(s -> new KitchenStationOption(s.id(), s.number(), s.name())).toList(),
                options.orderingPoints().stream().map(p -> new OrderingPoint(p.id(), p.name())).toList()));
    }
}
