package com.santhula.rms.common.domain;

/**
 * One problem found in an import file. {@code row} is the spreadsheet row (the header is row 1);
 * {@code column} is the header name; both are null for file-level problems.
 */
public record ImportRowError(Integer row, String column, String value, String message) {

    public static ImportRowError cell(int row, String column, String value, String message) {
        return new ImportRowError(row, column, value, message);
    }

    public static ImportRowError row(int row, String message) {
        return new ImportRowError(row, null, null, message);
    }
}
