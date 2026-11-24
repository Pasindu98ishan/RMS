package com.santhula.rms.audit.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.santhula.rms.audit.domain.AuditLogEntry;
import com.santhula.rms.common.config.RmsProperties;
import java.io.IOException;
import java.io.OutputStream;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;
import org.springframework.stereotype.Component;

/** Writes audit rows to one .xlsx sheet; times shown in the branch time zone (Asia/Colombo). */
@Component
class AuditExcelExporter {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String[] HEADERS = {
        "Time (Asia/Colombo)", "User", "Full name", "Terminal", "Action", "Entity type", "Entity id",
        "Before", "After", "Approver", "Reason", "Client (IP | browser)"
    };

    private final ObjectMapper objectMapper;
    private final ZoneId zone;

    AuditExcelExporter(ObjectMapper objectMapper, RmsProperties properties) {
        this.objectMapper = objectMapper;
        this.zone = properties.timeZone();
    }

    void write(List<AuditLogEntry> rows, OutputStream out) throws IOException {
        Workbook wb = new Workbook(out, "RMS", "1.0");
        Worksheet ws = wb.newWorksheet("Audit log");
        for (int c = 0; c < HEADERS.length; c++) {
            ws.value(0, c, HEADERS[c]);
            ws.style(0, c).bold().set();
        }
        int r = 1;
        for (AuditLogEntry e : rows) {
            put(ws, r, 0, TIME.format(e.getAt().atZone(zone)));
            put(ws, r, 1, e.getUsername());
            put(ws, r, 2, e.getUserFullName());
            put(ws, r, 3, e.getTerminalName());
            put(ws, r, 4, e.getAction().name());
            put(ws, r, 5, e.getEntityType());
            put(ws, r, 6, e.getEntityId());
            put(ws, r, 7, json(e.getBefore()));
            put(ws, r, 8, json(e.getAfter()));
            put(ws, r, 9, e.getApproverUsername());
            put(ws, r, 10, e.getReason());
            put(ws, r, 11, e.getClientInfo());
            r++;
        }
        ws.freezePane(0, 1);
        wb.finish();
    }

    private static void put(Worksheet ws, int r, int c, String value) {
        if (value != null) {
            ws.value(r, c, value);
        }
    }

    private String json(Map<String, Object> m) {
        if (m == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(m);
        } catch (JsonProcessingException e) {
            return m.toString();
        }
    }
}
