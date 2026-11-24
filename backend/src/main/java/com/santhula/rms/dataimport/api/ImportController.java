package com.santhula.rms.dataimport.api;

import com.santhula.rms.api.generated.api.ImportApi;
import com.santhula.rms.api.generated.model.ImportCounts;
import com.santhula.rms.api.generated.model.ImportError;
import com.santhula.rms.api.generated.model.ImportFileFormat;
import com.santhula.rms.api.generated.model.ImportReport;
import com.santhula.rms.api.generated.model.ImportType;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.dataimport.service.ImportService;
import com.santhula.rms.dataimport.service.ImportTemplates;
import java.io.IOException;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ImportController implements ImportApi {

    private final ImportService importService;
    private final ImportTemplates templates;

    public ImportController(ImportService importService, ImportTemplates templates) {
        this.importService = importService;
        this.templates = templates;
    }

    @Override
    @PreAuthorize("hasAuthority('DATA_IMPORT')")
    public ResponseEntity<Resource> downloadImportTemplate(ImportType importType, ImportFileFormat format) {
        var file = templates.build(domainType(importType),
                format == ImportFileFormat.XLSX ? ImportTemplates.Format.XLSX : ImportTemplates.Format.CSV);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.filename()).build().toString())
                .body(new ByteArrayResource(file.data()));
    }

    @Override
    @PreAuthorize("hasAuthority('DATA_IMPORT')")
    public ResponseEntity<ImportReport> importData(ImportType importType, MultipartFile file, Boolean dryRun) {
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_FILE_INVALID", "This file cannot be read",
                    "The uploaded file could not be read.");
        }
        var report = importService.importFile(domainType(importType), bytes, file.getOriginalFilename(), Boolean.TRUE.equals(dryRun));
        return ResponseEntity.ok(new ImportReport(importType, report.dryRun(), report.ok(), report.rowsRead(),
                new ImportCounts(report.counts().created(), report.counts().updated(), report.counts().unchanged()),
                report.errors().stream().map(e -> {
                    ImportError dto = new ImportError(e.message());
                    dto.setRow(e.row());
                    dto.setColumn(e.column());
                    dto.setValue(e.value());
                    return dto;
                }).toList(), report.errorsTruncated()));
    }

    private static com.santhula.rms.dataimport.service.ImportType domainType(ImportType t) {
        return com.santhula.rms.dataimport.service.ImportType.valueOf(t.getValue());
    }
}
