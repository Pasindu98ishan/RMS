package com.santhula.rms.floor.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.domain.ImportCounts;
import com.santhula.rms.common.domain.ImportRowError;
import com.santhula.rms.floor.domain.DiningTable;
import com.santhula.rms.floor.repo.DiningTableRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Domain side of the tables import (P1-IMP-01). The file module reads and type-checks the cells and hands
 * over the rows; a cell that could not be read is null here (its error is already reported) and is skipped by
 * the checks. This checks the rows against each other, then applies them once there is no error at all.
 */
@Service
public class FloorImportService {

    /** One parsed row of the tables file (header = row 1). */
    public record TableRow(int row, String number, String section, Integer seats) {
    }

    private final DiningTableRepository tables;
    private final AuditService audit;
    private final RmsProperties properties;

    public FloorImportService(DiningTableRepository tables, AuditService audit, RmsProperties properties) {
        this.tables = tables;
        this.audit = audit;
        this.properties = properties;
    }

    /** Checks the rows without saving anything. */
    public List<ImportRowError> validate(List<TableRow> rows) {
        List<ImportRowError> errors = new ArrayList<>();
        Map<String, Integer> firstSeen = new HashMap<>();
        for (TableRow r : rows) {
            if (r.number() != null) {
                if (!r.number().matches("^[A-Za-z0-9-]{1,10}$")) {
                    errors.add(ImportRowError.cell(r.row(), "number", r.number(), "must be 1 to 10 letters, digits or dashes"));
                }
                Integer first = firstSeen.putIfAbsent(r.number().toLowerCase(Locale.ROOT), r.row());
                if (first != null) {
                    errors.add(ImportRowError.cell(r.row(), "number", r.number(), "duplicate table number (first used on row " + first + ")"));
                }
            }
            if (r.section() != null && r.section().length() > 30) {
                errors.add(ImportRowError.cell(r.row(), "section", r.section(), "must be 1 to 30 characters"));
            }
            if (r.seats() != null && (r.seats() < 1 || r.seats() > 50)) {
                errors.add(ImportRowError.cell(r.row(), "seats", String.valueOf(r.seats()), "must be between 1 and 50"));
            }
        }
        return errors;
    }

    public ImportCounts apply(List<TableRow> rows) {
        return apply(rows, false);
    }

    /**
     * Applies rows that passed {@link #validate}; runs in the caller's transaction. Matches by table number;
     * creates (on the next free slot of the floor plan), updates section / seats, or leaves the table. Position
     * and active are kept. The tables are loaded once and written in one batch; a dry run writes nothing.
     */
    @Transactional
    public ImportCounts apply(List<TableRow> rows, boolean dryRun) {
        UUID branch = properties.branchId();
        Map<String, DiningTable> existing = new HashMap<>();
        List<DiningTable> all = tables.findByBranchId(branch);
        all.forEach(t -> existing.put(t.getNumber().toLowerCase(Locale.ROOT), t));
        SlotFinder slots = new SlotFinder(all);

        ImportCounts counts = ImportCounts.NONE;
        List<AuditRecord> audits = new ArrayList<>();
        for (TableRow r : rows) {
            String number = r.number().trim();
            String section = r.section().trim();
            DiningTable t = existing.get(number.toLowerCase(Locale.ROOT));
            if (t == null) {
                int[] pos = slots.next();
                DiningTable created = new DiningTable(branch, number, section, r.seats(), pos[0], pos[1], true);
                existing.put(number.toLowerCase(Locale.ROOT), created);
                counts = counts.addCreated();
                if (!dryRun) {
                    tables.save(created);
                    audits.add(AuditRecord.of(AuditAction.CREATE, "DINING_TABLE", created.getId()).after(FloorService.snapshot(created)).build());
                }
            } else if (t.getSection().equals(section) && t.getSeats() == r.seats()) {
                counts = counts.addUnchanged();
            } else {
                counts = counts.addUpdated();
                if (!dryRun) {
                    Map<String, Object> before = FloorService.snapshot(t);
                    t.update(t.getNumber(), section, r.seats(), t.isActive());
                    audits.add(AuditRecord.of(AuditAction.UPDATE, "DINING_TABLE", t.getId()).before(before).after(FloorService.snapshot(t)).build());
                }
            }
        }
        if (!dryRun) {
            tables.flush();
            audit.recordAll(audits);
        }
        return counts;
    }

    /** The free-slot search of {@code FloorService.create}, done once for the whole import instead of per table. */
    private static final class SlotFinder {
        private final List<int[]> slots = new ArrayList<>();
            private final boolean[] taken;

        SlotFinder(List<DiningTable> existing) {
            for (int y = FloorService.FIRST; y <= DiningTable.GRID_HEIGHT - FloorService.FIRST + 20; y += FloorService.SLOT) {
                for (int x = FloorService.FIRST; x <= DiningTable.GRID_WIDTH - FloorService.FIRST + 20; x += FloorService.SLOT) {
                    slots.add(new int[] {x, y});
                }
            }
            taken = new boolean[slots.size()];
            existing.forEach(t -> occupy(t.getX(), t.getY()));
        }

        private void occupy(int x, int y) {
            for (int i = 0; i < taken.length; i++) {
                int[] s = slots.get(i);
                if (Math.abs(x - s[0]) < FloorService.SLOT / 2 && Math.abs(y - s[1]) < FloorService.SLOT / 2) {
                    taken[i] = true;
                }
            }
        }

        int[] next() {
            for (int i = 0; i < taken.length; i++) {
                if (!taken[i]) {
                    int[] s = slots.get(i);
                    occupy(s[0], s[1]);
                    return s;
                }
            }
            int[] centre = {DiningTable.GRID_WIDTH / 2, DiningTable.GRID_HEIGHT / 2};
            occupy(centre[0], centre[1]);
            return centre;
        }
    }
}
