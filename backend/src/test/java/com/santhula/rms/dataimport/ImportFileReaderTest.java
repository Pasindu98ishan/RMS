package com.santhula.rms.dataimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.dataimport.service.ImportFileReader;
import com.santhula.rms.dataimport.service.ImportFileReader.ParsedFile;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;
import org.junit.jupiter.api.Test;

/** Reading CSV / XLSX into rows of text (P1-IMP-01). Knows nothing about what the columns mean. */
class ImportFileReaderTest {

    private final ImportFileReader reader = new ImportFileReader();

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void csv_headerIsNormalised_rowsKeepTheirSpreadsheetNumbers_blankRowsAreSkipped() {
        ParsedFile f = reader.read(bytes("Local Price , Name\n10.00,A\n\n,\n20.00,B\n"));
        assertThat(f.headers()).containsExactly("local_price", "name");
        assertThat(f.rows()).extracting(ImportFileReader.RawRow::row).containsExactly(2, 5);
        assertThat(f.rows().get(1).cells()).containsExactly("20.00", "B");
    }

    @Test
    void csv_byteOrderMarkSemicolonsAndQuotedCommas() {
        ParsedFile f = reader.read(bytes("﻿a;b\n\"x, y\";2\n"));
        assertThat(f.headers()).containsExactly("a", "b");
        assertThat(f.rows().get(0).cells()).containsExactly("x, y", "2");
        ParsedFile commas = reader.read(bytes("a,b\n\"x, y\",2\n"));
        assertThat(commas.rows().get(0).cells()).containsExactly("x, y", "2");
    }

    @Test
    void csv_unicodeTextSurvives() {
        ParsedFile f = reader.read(bytes("name\nකොත්තු\nCafé\n"));
        assertThat(f.rows()).extracting(r -> r.cells().get(0)).containsExactly("කොත්තු", "Café");
    }

    @Test
    void xlsx_isDetectedByContent_andRowNumbersAreTheSheetRows() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Workbook wb = new Workbook(out, "test", "1.0");
        Worksheet ws = wb.newWorksheet("data");
        ws.value(0, 0, "Name");
        ws.value(0, 1, "Seats");
        ws.value(1, 0, "A");
        ws.value(1, 1, 4);
        ws.value(3, 0, "B");          // row 3 is empty
        ws.value(3, 1, 6);
        wb.finish();

        ParsedFile f = reader.read(out.toByteArray());
        assertThat(f.headers()).containsExactly("name", "seats");
        assertThat(f.rows()).extracting(ImportFileReader.RawRow::row).containsExactly(2, 4);
        assertThat(f.rows().get(1).cells()).containsExactly("B", "6");
    }

    @Test
    void emptyBrokenAndOversizedFiles_areImportFileInvalid() {
        for (byte[] bad : new byte[][] {new byte[0], bytes("PK\u0003\u0004 not a zip"), bytes("name\n\"open quote"), bytes("\n\n")}) {
            assertThatThrownBy(() -> reader.read(bad)).isInstanceOfSatisfying(ApiException.class, e -> {
                assertThat(e.getCode()).isEqualTo("IMPORT_FILE_INVALID");
                assertThat(e.getStatus().value()).isEqualTo(422);
            });
        }
        assertThatThrownBy(() -> reader.read(new byte[(int) ImportFileReader.MAX_BYTES + 1])).isInstanceOf(ApiException.class);
    }

    @Test
    void moreThan5000DataRows_isRefused_but5000IsFine() {
        StringBuilder ok = new StringBuilder("name\n");
        for (int i = 0; i < ImportFileReader.MAX_ROWS; i++) {
            ok.append("C").append(i).append('\n');
        }
        assertThat(reader.read(bytes(ok.toString())).rows()).hasSize(ImportFileReader.MAX_ROWS);
        assertThatThrownBy(() -> reader.read(bytes(ok + "one more\n"))).isInstanceOf(ApiException.class);
    }
}
