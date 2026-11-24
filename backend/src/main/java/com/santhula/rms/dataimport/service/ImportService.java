package com.santhula.rms.dataimport.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.domain.ImportCounts;
import com.santhula.rms.common.domain.ImportRowError;
import com.santhula.rms.dataimport.service.ImportFileReader.ParsedFile;
import com.santhula.rms.dataimport.service.ImportFileReader.RawRow;
import com.santhula.rms.floor.service.FloorImportService;
import com.santhula.rms.floor.service.FloorImportService.TableRow;
import com.santhula.rms.menu.service.MenuImportService;
import com.santhula.rms.menu.service.MenuImportService.CategoryRow;
import com.santhula.rms.menu.service.MenuImportService.GroupRow;
import com.santhula.rms.menu.service.MenuImportService.ItemRow;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

/**
 * Spreadsheet import (P1-IMP-01). Reads the file, checks every cell, then lets the owning module check the
 * rows against each other and the existing data. All-or-nothing: any error means nothing is saved. The
 * whole run is one transaction; a dry run computes the exact counts without writing (modifier groups, which are few, are written and rolled back).
 */
@Service
public class ImportService {

    static final int MAX_ERRORS = 200;
    private static final Pattern WHOLE = Pattern.compile("^-?\\d+$");
    private static final Pattern WHOLE_AS_DECIMAL = Pattern.compile("^(-?\\d+)\\.0+$");
    private static final Pattern MONEY = Pattern.compile("^-?\\d{1,10}(\\.\\d{1,2})?$");
    private static final Pattern NUMBER = Pattern.compile("^-?\\d+(\\.\\d+)?$");

    /** Result of an import or a dry run. {@code ok = false} means nothing was saved. */
    public record Report(ImportType type, boolean dryRun, boolean ok, int rowsRead, ImportCounts counts,
                         List<ImportRowError> errors, boolean errorsTruncated) {
    }

    private final ImportFileReader reader;
    private final MenuImportService menuImport;
    private final FloorImportService floorImport;
    private final AuditService audit;

    public ImportService(ImportFileReader reader, MenuImportService menuImport, FloorImportService floorImport, AuditService audit) {
        this.reader = reader;
        this.menuImport = menuImport;
        this.floorImport = floorImport;
        this.audit = audit;
    }

    @Transactional
    public Report importFile(ImportType type, byte[] bytes, String filename, boolean dryRun) {
        ParsedFile file = reader.read(bytes);
        List<ImportRowError> errors = new ArrayList<>();
        Map<String, Integer> index = headerIndex(type, file.headers(), errors);
        if (!errors.isEmpty()) {
            return report(type, dryRun, file.rows().size(), ImportCounts.NONE, errors);
        }

        ImportCounts counts = ImportCounts.NONE;
        switch (type) {
            case CATEGORIES -> {
                List<CategoryRow> rows = parse(file, index, errors, p -> new CategoryRow(p.row, p.text("name", true),
                        p.integer("sort_order", false)));
                errors.addAll(menuImport.validateCategories(rows));
                if (errors.isEmpty()) {
                    counts = menuImport.importCategories(rows, dryRun);
                }
            }
            case MENU_ITEMS -> {
                List<ItemRow> rows = parse(file, index, errors, p -> {
                    String code = p.text("code", true);
                    return new ItemRow(p.row, code == null ? null : code.toUpperCase(Locale.ROOT), p.text("name", true), p.text("category", true),
                            p.integer("station", true), p.money("local_price", true, false), p.money("foreign_price", false, false),
                            groupNames(p.text("modifier_groups", false)), p.yesNo("active", false));
                });
                errors.addAll(menuImport.validateItems(rows));
                if (errors.isEmpty()) {
                    counts = menuImport.importItems(rows, dryRun);
                }
            }
            case MODIFIER_GROUPS -> {
                List<GroupRow> rows = parse(file, index, errors, p -> new GroupRow(p.row, p.text("group", true), p.yesNo("required", true),
                        p.integer("min_select", true), p.integer("max_select", true), p.text("option", true), p.money("price_delta", false, true)));
                errors.addAll(menuImport.validateGroups(rows));
                if (errors.isEmpty()) {
                    counts = menuImport.importGroups(rows, dryRun);
                }
            }
            case TABLES -> {
                List<TableRow> rows = parse(file, index, errors, p -> new TableRow(p.row, p.text("number", true), p.text("section", true),
                        p.integer("seats", true)));
                errors.addAll(floorImport.validate(rows));
                if (errors.isEmpty()) {
                    counts = floorImport.apply(rows, dryRun);
                }
            }
        }

        if (!errors.isEmpty()) {
            return report(type, dryRun, file.rows().size(), ImportCounts.NONE, errors);
        }
        if (dryRun) {
            // Categories, items and tables wrote nothing; the (few) modifier groups did, so undo it all.
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        } else {
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("importType", type.name());
            summary.put("fileName", filename);
            summary.put("rows", file.rows().size());
            summary.put("created", counts.created());
            summary.put("updated", counts.updated());
            summary.put("unchanged", counts.unchanged());
            audit.record(AuditRecord.of(AuditAction.DATA_IMPORTED, "IMPORT", type.name()).after(summary).build());
        }
        return report(type, dryRun, file.rows().size(), counts, List.of());
    }

    // ------------------------------------------------------------------ header

    private static Map<String, Integer> headerIndex(ImportType type, List<String> headers, List<ImportRowError> errors) {
        Map<String, Integer> index = new HashMap<>();
        for (int i = 0; i < headers.size(); i++) {
            String h = headers.get(i);
            if (h.isEmpty()) {
                continue;
            }
            if (!type.columns().contains(h)) {
                errors.add(ImportRowError.cell(1, h, h, "unknown column '" + h + "' (expected: " + String.join(", ", type.columns()) + ")"));
            } else if (index.putIfAbsent(h, i) != null) {
                errors.add(ImportRowError.cell(1, h, h, "column '" + h + "' appears twice"));
            }
        }
        for (String required : type.requiredColumns()) {
            if (!index.containsKey(required)) {
                errors.add(ImportRowError.cell(1, required, null, "missing column '" + required + "'"));
            }
        }
        return index;
    }

    // ------------------------------------------------------------------ rows

    /**
     * Reads each row with the given mapper. A cell that cannot be read is reported and becomes null; the row is
     * still passed on, so the owning module can report its other problems too (every error, not just the first).
     */
    private static <T> List<T> parse(ParsedFile file, Map<String, Integer> index, List<ImportRowError> errors,
                                     Function<RowParser, T> mapper) {
        List<T> rows = new ArrayList<>();
        for (RawRow raw : file.rows()) {
            RowParser p = new RowParser(raw, index, errors);
            rows.add(mapper.apply(p));
        }
        return rows;
    }

    private static List<String> groupNames(String cell) {
        if (cell == null || cell.isBlank()) {
            return List.of();
        }
        return Arrays.stream(cell.split("\\|")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** Cell access with plain-English errors ("menu_items row 14, local_price: 'abc' is not a number"). */
    private static final class RowParser {
        final int row;
        private final Map<String, Integer> index;
        private final List<String> cells;
        private final List<ImportRowError> errors;
        boolean ok = true;

        RowParser(RawRow raw, Map<String, Integer> index, List<ImportRowError> errors) {
            this.row = raw.row();
            this.index = index;
            this.cells = raw.cells();
            this.errors = errors;
        }

        private String cell(String column) {
            Integer i = index.get(column);
            if (i == null || i >= cells.size() || cells.get(i) == null) {
                return "";
            }
            return cells.get(i).trim();
        }

        private void fail(String column, String value, String message) {
            ok = false;
            errors.add(ImportRowError.cell(row, column, value, message));
        }

        String text(String column, boolean required) {
            String v = cell(column);
            if (v.isEmpty()) {
                if (required) {
                    fail(column, "", "is required");
                }
                return null;
            }
            return v;
        }

        Integer integer(String column, boolean required) {
            String v = cell(column);
            if (v.isEmpty()) {
                if (required) {
                    fail(column, "", "is required");
                }
                return null;
            }
            var m = WHOLE_AS_DECIMAL.matcher(v);
            String whole = m.matches() ? m.group(1) : v;     // a spreadsheet may write 4 as 4.0
            if (!WHOLE.matcher(whole).matches() || whole.length() > 9) {
                fail(column, v, "'" + v + "' is not a whole number");
                return null;
            }
            return Integer.parseInt(whole);
        }

        /** Money: up to 2 decimals, no thousands separators. A blank cell is null, or 0.00 with {@code blankIsZero}. */
        BigDecimal money(String column, boolean required, boolean blankIsZero) {
            String v = cell(column);
            if (v.isEmpty()) {
                if (blankIsZero) {
                    return new BigDecimal("0.00");
                }
                if (required) {
                    fail(column, "", "is required");
                }
                return null;
            }
            if (!NUMBER.matcher(v).matches()) {
                fail(column, v, "'" + v + "' is not a number");
                return null;
            }
            if (!MONEY.matcher(v).matches()) {
                fail(column, v, "'" + v + "' must have at most 2 decimals");
                return null;
            }
            return new BigDecimal(v).setScale(2);
        }

        Boolean yesNo(String column, boolean required) {
            String v = cell(column);
            if (v.isEmpty()) {
                if (required) {
                    fail(column, "", "is required");
                }
                return null;
            }
            return switch (v.toUpperCase(Locale.ROOT)) {
                case "Y", "YES", "TRUE", "1" -> Boolean.TRUE;
                case "N", "NO", "FALSE", "0" -> Boolean.FALSE;
                default -> {
                    fail(column, v, "'" + v + "' must be Y or N");
                    yield null;
                }
            };
        }
    }

    // ------------------------------------------------------------------ result

    private static Report report(ImportType type, boolean dryRun, int rowsRead, ImportCounts counts, List<ImportRowError> errors) {
        List<ImportRowError> sorted = errors.stream()
                .sorted(Comparator.comparing((ImportRowError e) -> e.row() == null ? 0 : e.row())
                        .thenComparing(e -> e.column() == null ? "" : e.column()))
                .toList();
        boolean truncated = sorted.size() > MAX_ERRORS;
        return new Report(type, dryRun, errors.isEmpty(), rowsRead, counts, truncated ? sorted.subList(0, MAX_ERRORS) : sorted, truncated);
    }
}
