package com.santhula.rms.audit.api;

import com.santhula.rms.api.generated.api.AuditApi;
import com.santhula.rms.api.generated.model.AuditAction;
import com.santhula.rms.api.generated.model.AuditLogPage;
import com.santhula.rms.audit.domain.AuditLogEntry;
import com.santhula.rms.audit.service.AuditQuery;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuditController implements AuditApi {

    static final MediaType XLSX = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final AuditService auditService;
    private final AuditExcelExporter exporter;
    private final RmsProperties properties;

    public AuditController(AuditService auditService, AuditExcelExporter exporter, RmsProperties properties) {
        this.auditService = auditService;
        this.exporter = exporter;
        this.properties = properties;
    }

    @Override
    @PreAuthorize("hasAuthority('AUDIT_VIEW')")
    public ResponseEntity<AuditLogPage> searchAuditLog(Integer page, Integer size, String sort, LocalDate from, LocalDate to,
                                                       UUID userId, AuditAction action, String entityType, String entityId) {
        Sort.Direction direction = Sort.Direction.DESC;
        if (sort != null) {
            String[] parts = sort.split(",");
            if (!parts[0].equals("at")) {
                throw ApiException.validation("sort", "The audit log can only be sorted by 'at'");
            }
            direction = Sort.Direction.fromString(parts[1]);
        }
        Page<AuditLogEntry> result = auditService.search(query(from, to, userId, action, entityType, entityId),
                page == null ? 0 : page, size == null ? 50 : size, direction);
        return ResponseEntity.ok(new AuditLogPage(result.getNumber(), result.getSize(), result.getTotalElements(),
                result.getContent().stream().map(AuditMapper::toDto).toList()));
    }

    @Override
    @PreAuthorize("hasAuthority('AUDIT_VIEW')")
    public ResponseEntity<Resource> exportAuditLog(LocalDate from, LocalDate to, UUID userId, AuditAction action,
                                                   String entityType, String entityId) {
        AuditQuery query = query(from, to, userId, action, entityType, entityId);
        long count = auditService.count(query);
        int max = properties.audit().exportMaxRows();
        if (count > max) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EXPORT_TOO_LARGE", "Too many rows to export",
                    "This export has " + count + " rows; the limit is " + max + ". Narrow the dates or filters.");
        }
        List<AuditLogEntry> rows = auditService.findAllForExport(query);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            exporter.write(rows, out);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        Map<String, Object> filters = new LinkedHashMap<>();
        filters.put("from", from == null ? null : from.toString());
        filters.put("to", to == null ? null : to.toString());
        filters.put("userId", userId == null ? null : userId.toString());
        filters.put("action", action == null ? null : action.getValue());
        filters.put("entityType", entityType);
        filters.put("entityId", entityId);
        filters.put("rows", rows.size());
        auditService.record(AuditRecord.of(com.santhula.rms.audit.service.AuditAction.AUDIT_EXPORTED, "AUDIT_LOG", null)
                .after(filters).build());

        String filename = "audit-log-" + (from == null ? "start" : from) + "_" + (to == null ? "now" : to) + ".xlsx";
        return ResponseEntity.ok()
                .contentType(XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename).build().toString())
                .body(new ByteArrayResource(out.toByteArray()));
    }

    private static AuditQuery query(LocalDate from, LocalDate to, UUID userId, AuditAction action, String entityType, String entityId) {
        return new AuditQuery(from, to, userId,
                action == null ? null : com.santhula.rms.audit.service.AuditAction.valueOf(action.getValue()),
                entityType, entityId);
    }
}
