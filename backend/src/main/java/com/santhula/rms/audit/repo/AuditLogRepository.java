package com.santhula.rms.audit.repo;

import com.santhula.rms.audit.domain.AuditLogEntry;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.Repository;

/**
 * Insert and search. No update/delete repository methods are declared and the app's DB role has
 * no UPDATE/DELETE grant on audit_log (V3 migration), so the log can't be changed (P1-AUD-02).
 */
public interface AuditLogRepository extends Repository<AuditLogEntry, UUID>, JpaSpecificationExecutor<AuditLogEntry> {

    AuditLogEntry save(AuditLogEntry entry);

    /** Insert many rows; with JDBC batching they go to the database in a few round trips (imports). */
    List<AuditLogEntry> saveAll(Iterable<AuditLogEntry> entries);
}
