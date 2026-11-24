package com.santhula.rms.floor.api;

import com.santhula.rms.api.generated.api.FloorApi;
import com.santhula.rms.api.generated.model.CreateTableRequest;
import com.santhula.rms.api.generated.model.DiningTable;
import com.santhula.rms.api.generated.model.FloorLayout;
import com.santhula.rms.api.generated.model.FloorTable;
import com.santhula.rms.api.generated.model.OrderingPoint;
import com.santhula.rms.api.generated.model.SaveTablePositionsRequest;
import com.santhula.rms.api.generated.model.UpdateTableRequest;
import com.santhula.rms.floor.service.FloorService;
import com.santhula.rms.floor.service.OrderingPointService;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class FloorController implements FloorApi {

    private final FloorService floor;
    private final OrderingPointService orderingPoints;

    public FloorController(FloorService floor, OrderingPointService orderingPoints) {
        this.floor = floor;
        this.orderingPoints = orderingPoints;
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<List<OrderingPoint>> listOrderingPoints() {
        return ResponseEntity.ok(orderingPoints.list().stream().map(p -> new OrderingPoint(p.id(), p.name())).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('FLOOR_MANAGE')")
    public ResponseEntity<List<DiningTable>> listTables(Boolean active, String section) {
        return ResponseEntity.ok(floor.list(active, section).stream().map(FloorController::table).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('FLOOR_MANAGE')")
    public ResponseEntity<DiningTable> createTable(CreateTableRequest req) {
        var t = floor.create(new FloorService.NewTable(req.getNumber(), req.getSection(), req.getSeats(), req.getX(), req.getY(), req.getActive()));
        return ResponseEntity.status(HttpStatus.CREATED).body(table(t));
    }

    @Override
    @PreAuthorize("hasAuthority('FLOOR_MANAGE')")
    public ResponseEntity<List<DiningTable>> saveTablePositions(SaveTablePositionsRequest req) {
        var changes = req.getPositions().stream()
                .map(p -> new FloorService.PositionChange(p.getTableId(), p.getX(), p.getY(), p.getVersion()))
                .toList();
        return ResponseEntity.ok(floor.savePositions(changes).stream().map(FloorController::table).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('FLOOR_MANAGE')")
    public ResponseEntity<DiningTable> getTable(UUID tableId) {
        return ResponseEntity.ok(table(floor.get(tableId)));
    }

    @Override
    @PreAuthorize("hasAuthority('FLOOR_MANAGE')")
    public ResponseEntity<DiningTable> updateTable(UUID tableId, UpdateTableRequest req) {
        var t = floor.update(tableId, new FloorService.TableData(req.getNumber(), req.getSection(), req.getSeats(), req.getActive()),
                req.getVersion());
        return ResponseEntity.ok(table(t));
    }

    @Override
    @PreAuthorize("hasAuthority('ORDER_VIEW')")
    public ResponseEntity<FloorLayout> getFloorLayout() {
        List<FloorTable> tables = floor.layout().stream()
                .map(t -> new FloorTable(t.getId(), t.getNumber(), t.getSection(), t.getSeats(), t.getX(), t.getY()))
                .toList();
        return ResponseEntity.ok(new FloorLayout(com.santhula.rms.floor.domain.DiningTable.GRID_WIDTH,
                com.santhula.rms.floor.domain.DiningTable.GRID_HEIGHT, tables));
    }

    private static DiningTable table(com.santhula.rms.floor.domain.DiningTable t) {
        return new DiningTable(t.getId(), t.getNumber(), t.getSection(), t.getSeats(), t.getX(), t.getY(), t.isActive(),
                t.getVersion(), t.getCreatedAt().atOffset(ZoneOffset.UTC), t.getUpdatedAt().atOffset(ZoneOffset.UTC));
    }
}
