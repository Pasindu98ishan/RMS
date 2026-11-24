package com.santhula.rms.dataimport.service;

import com.santhula.rms.common.error.ApiException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.dhatim.fastexcel.reader.ReadableWorkbook;
import org.dhatim.fastexcel.reader.Row;
import org.dhatim.fastexcel.reader.Sheet;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Reads the first sheet of a CSV (UTF-8, comma or semicolon) or XLSX file into rows of text. Knows nothing
 * about what the columns mean. An unreadable or oversized file is a 422 IMPORT_FILE_INVALID.
 */
@Component
public class ImportFileReader {

    public static final int MAX_ROWS = 5000;
    public static final long MAX_BYTES = 5L * 1024 * 1024;

    /** One row: its spreadsheet row number (the header is row 1) and the cell texts. */
    public record RawRow(int row, List<String> cells) {
        public boolean isBlank() {
            return cells.stream().allMatch(c -> c == null || c.isBlank());
        }
    }

    /** The normalised header and the non-blank data rows. */
    public record ParsedFile(List<String> headers, List<RawRow> rows) {
    }

    public ParsedFile read(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw invalid("The file is empty.");
        }
        if (bytes.length > MAX_BYTES) {
            throw invalid("The file is larger than 5 MB.");
        }
        List<RawRow> all = isXlsx(bytes) ? readXlsx(bytes) : readCsv(bytes);
        if (all.isEmpty() || all.get(0).isBlank()) {
            throw invalid("The file has no header row.");
        }
        List<String> headers = all.get(0).cells().stream().map(ImportFileReader::normalise).toList();
        List<RawRow> rows = all.stream().skip(1).filter(r -> !r.isBlank()).toList();
        if (rows.size() > MAX_ROWS) {
            throw invalid("The file has more than " + MAX_ROWS + " rows.");
        }
        return new ParsedFile(headers, rows);
    }

    static String normalise(String header) {
        return header == null ? "" : header.replace("﻿", "").trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", "_");
    }

    /** An .xlsx file is a zip archive; a CSV never starts with the zip signature. */
    private static boolean isXlsx(byte[] b) {
        return b.length > 4 && b[0] == 'P' && b[1] == 'K';
    }

    private List<RawRow> readCsv(byte[] bytes) {
        String text = new String(bytes, StandardCharsets.UTF_8);
        if (text.startsWith("﻿")) {
            text = text.substring(1);
        }
        String firstLine = text.lines().findFirst().orElse("");
        char delimiter = firstLine.contains(",") || !firstLine.contains(";") ? ',' : ';';
        List<RawRow> out = new ArrayList<>();
        CSVFormat format = CSVFormat.DEFAULT.builder().setDelimiter(delimiter).setIgnoreSurroundingSpaces(true)
                .setIgnoreEmptyLines(false).build();   // empty lines still count as rows, so reported row numbers match the sheet
        try (CSVParser parser = CSVParser.parse(new StringReader(text), format)) {
            for (CSVRecord record : parser) {
                List<String> cells = new ArrayList<>();
                record.forEach(cells::add);
                out.add(new RawRow((int) record.getRecordNumber(), cells));
                if (out.size() > MAX_ROWS + 50) {
                    throw invalid("The file has more than " + MAX_ROWS + " rows.");
                }
            }
        } catch (ApiException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            // commons-csv reports a broken quote as an unchecked exception while iterating
            throw invalid("The file is not a valid CSV file.");
        }
        return out;
    }

    private List<RawRow> readXlsx(byte[] bytes) {
        List<RawRow> out = new ArrayList<>();
        try (ReadableWorkbook workbook = new ReadableWorkbook(new ByteArrayInputStream(bytes))) {
            Sheet sheet = workbook.getFirstSheet();
            for (Row row : sheet.read()) {
                List<String> cells = new ArrayList<>();
                for (int c = 0; c < row.getCellCount(); c++) {
                    String text = row.getCellText(c);
                    cells.add(text == null ? "" : text);
                }
                out.add(new RawRow(row.getRowNum(), cells));
                if (out.size() > MAX_ROWS + 50) {
                    throw invalid("The file has more than " + MAX_ROWS + " rows.");
                }
            }
        } catch (ApiException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw invalid("The file is not a valid Excel (.xlsx) file.");
        }
        return out;
    }

    static ApiException invalid(String detail) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_FILE_INVALID", "This file cannot be read", detail);
    }
}
