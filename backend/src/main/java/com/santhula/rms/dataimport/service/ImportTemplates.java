package com.santhula.rms.dataimport.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;
import org.springframework.stereotype.Component;

/** Builds the downloadable templates: the header row and a few example rows, as CSV or XLSX. */
@Component
public class ImportTemplates {

    public enum Format {
        CSV("csv", "text/csv"),
        XLSX("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        private final String extension;
        private final String contentType;

        Format(String extension, String contentType) {
            this.extension = extension;
            this.contentType = contentType;
        }

        public String extension() {
            return extension;
        }

        public String contentType() {
            return contentType;
        }
    }

    public record TemplateFile(byte[] data, String filename, String contentType) {
    }

    public TemplateFile build(ImportType type, Format format) {
        byte[] data = format == Format.CSV ? csv(type) : xlsx(type);
        return new TemplateFile(data, type.templateName(format.extension()), format.contentType());
    }

    /** UTF-8 with a byte order mark, so Excel shows non-ASCII text (names with accents, Sinhala) correctly. */
    private static byte[] csv(ImportType type) {
        StringWriter out = new StringWriter();
        try (CSVPrinter printer = new CSVPrinter(out, CSVFormat.DEFAULT)) {
            printer.printRecord(type.columns());
            for (List<String> example : type.exampleRows()) {
                printer.printRecord(example);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        byte[] body = out.toString().getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[body.length + 3];
        withBom[0] = (byte) 0xEF;
        withBom[1] = (byte) 0xBB;
        withBom[2] = (byte) 0xBF;
        System.arraycopy(body, 0, withBom, 3, body.length);
        return withBom;
    }

    private static byte[] xlsx(ImportType type) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            Workbook wb = new Workbook(out, "RMS", "1.0");
            Worksheet ws = wb.newWorksheet(type.name().toLowerCase(java.util.Locale.ROOT));
            List<String> columns = type.columns();
            for (int c = 0; c < columns.size(); c++) {
                ws.value(0, c, columns.get(c));
                ws.style(0, c).bold().set();
                ws.width(c, 20);
            }
            int r = 1;
            for (List<String> example : type.exampleRows()) {
                for (int c = 0; c < example.size(); c++) {
                    if (!example.get(c).isEmpty()) {
                        ws.value(r, c, example.get(c));
                    }
                }
                r++;
            }
            ws.freezePane(0, 1);
            wb.finish();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }
}
