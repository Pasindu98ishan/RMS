package com.santhula.rms.floor.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.floor.domain.DiningTable;
import com.santhula.rms.floor.repo.DiningTableRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Tables and the floor plan (P1-FLOOR-01). Tables are never deleted, only deactivated. */
@Service
public class FloorService {

    public record TableData(String number, String section, int seats, boolean active) {
    }

    public record NewTable(String number, String section, int seats, Integer x, Integer y, Boolean active) {
    }

    public record PositionChange(UUID tableId, int x, int y, int version) {
    }

    static final int SLOT = 120;
    static final int FIRST = 100;

    private final DiningTableRepository tables;
    private final AuditService audit;
    private final RmsProperties properties;

    public FloorService(DiningTableRepository tables, AuditService audit, RmsProperties properties) {
        this.tables = tables;
        this.audit = audit;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public List<DiningTable> list(Boolean active, String section) {
        return tables.findByBranchId(properties.branchId()).stream()
                .filter(t -> active == null || t.isActive() == active)
                .filter(t -> section == null || t.getSection().equalsIgnoreCase(section))
                .sorted(ORDER)
                .toList();
    }

    @Transactional(readOnly = true)
    public DiningTable get(UUID id) {
        return find(id);
    }

    /** Active tables for the POS floor view. */
    @Transactional(readOnly = true)
    public List<DiningTable> layout() {
        return list(true, null);
    }

    // ------------------------------------------------------------------ writes

    @Transactional
    public DiningTable create(NewTable cmd) {
        String number = cmd.number().trim();
        validateNumber(number);
        if (tables.existsByBranchIdAndNumberIgnoreCase(properties.branchId(), number)) {
            throw numberTaken(number);
        }
        int[] pos = cmd.x() != null && cmd.y() != null ? new int[] {cmd.x(), cmd.y()} : nextFreeSlot();
        DiningTable t = new DiningTable(properties.branchId(), number, cmd.section().trim(), cmd.seats(), pos[0], pos[1],
                cmd.active() == null || cmd.active());
        tables.saveAndFlush(t);
        audit.record(AuditRecord.of(AuditAction.CREATE, "DINING_TABLE", t.getId()).after(snapshot(t)).build());
        return t;
    }

    @Transactional
    public DiningTable update(UUID id, TableData data, int expectedVersion) {
        DiningTable t = find(id);
        if (t.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("table");
        }
        String number = data.number().trim();
        validateNumber(number);
        if (tables.existsByBranchIdAndNumberIgnoreCaseAndIdNot(properties.branchId(), number, id)) {
            throw numberTaken(number);
        }
        Map<String, Object> before = snapshot(t);
        t.update(number, data.section().trim(), data.seats(), data.active());
        tables.saveAndFlush(t);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "DINING_TABLE", id).before(before).after(snapshot(t)).build());
        return t;
    }

    /** All or nothing: an unknown table is 422, a stale version is 409, and nothing is saved then. */
    @Transactional
    public List<DiningTable> savePositions(List<PositionChange> changes) {
        List<FieldViolation> errors = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        Map<UUID, DiningTable> byId = new HashMap<>();
        for (int i = 0; i < changes.size(); i++) {
            PositionChange c = changes.get(i);
            if (!seen.add(c.tableId())) {
                errors.add(new FieldViolation("positions[" + i + "].tableId", "This table is listed twice"));
                continue;
            }
            DiningTable t = tables.findById(c.tableId()).orElse(null);
            if (t == null) {
                errors.add(new FieldViolation("positions[" + i + "].tableId", "This table does not exist"));
            } else {
                byId.put(t.getId(), t);
            }
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
        for (PositionChange c : changes) {
            if (byId.get(c.tableId()).getVersion() != c.version()) {
                throw ApiException.versionConflict("table");
            }
        }
        List<DiningTable> result = new ArrayList<>();
        for (PositionChange c : changes) {
            DiningTable t = byId.get(c.tableId());
            if (t.getX() != c.x() || t.getY() != c.y()) {
                Map<String, Object> before = Map.of("x", t.getX(), "y", t.getY());
                t.moveTo(c.x(), c.y());
                tables.saveAndFlush(t);
                audit.record(AuditRecord.of(AuditAction.UPDATE, "DINING_TABLE", t.getId())
                        .before(before).after(Map.of("x", t.getX(), "y", t.getY())).build());
            }
            result.add(t);
        }
        return result;
    }

    @Transactional(readOnly = true)
    public boolean numberExists(String number) {
        return tables.existsByBranchIdAndNumberIgnoreCase(properties.branchId(), number.trim());
    }

    // ------------------------------------------------------------------ helpers

    private DiningTable find(UUID id) {
        return tables.findById(id).orElseThrow(() -> ApiException.notFound("This table"));
    }

    private int[] nextFreeSlot() {
        List<DiningTable> all = tables.findByBranchId(properties.branchId());
        for (int y = FIRST; y <= DiningTable.GRID_HEIGHT - FIRST + 20; y += SLOT) {
            for (int x = FIRST; x <= DiningTable.GRID_WIDTH - FIRST + 20; x += SLOT) {
                final int cx = x;
                final int cy = y;
                boolean taken = all.stream().anyMatch(t -> Math.abs(t.getX() - cx) < SLOT / 2 && Math.abs(t.getY() - cy) < SLOT / 2);
                if (!taken) {
                    return new int[] {cx, cy};
                }
            }
        }
        return new int[] {DiningTable.GRID_WIDTH / 2, DiningTable.GRID_HEIGHT / 2};
    }

    static void validateNumber(String number) {
        if (!number.matches("^[A-Za-z0-9-]{1,10}$")) {
            throw ApiException.validation("number", "Table number must be 1 to 10 letters, digits or dashes");
        }
    }

    private static ApiException numberTaken(String number) {
        return ApiException.conflict("TABLE_NUMBER_TAKEN", "Table number taken", "A table numbered '" + number + "' already exists.");
    }

    static Map<String, Object> snapshot(DiningTable t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("number", t.getNumber());
        m.put("section", t.getSection());
        m.put("seats", t.getSeats());
        m.put("x", t.getX());
        m.put("y", t.getY());
        m.put("active", t.isActive());
        return m;
    }

    /** Section, then "natural" table number order: 1, 2, 10, G1, G2. */
    private static final Comparator<DiningTable> ORDER = Comparator
            .comparing((DiningTable t) -> t.getSection().toLowerCase(Locale.ROOT))
            .thenComparing(t -> naturalKey(t.getNumber()));

    private static String naturalKey(String number) {
        StringBuilder sb = new StringBuilder();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d+|\\D+").matcher(number.toLowerCase(Locale.ROOT));
        while (m.find()) {
            String part = m.group();
            sb.append(Character.isDigit(part.charAt(0)) ? String.format("%010d", Long.parseLong(part)) : part);
        }
        return sb.toString();
    }
}
