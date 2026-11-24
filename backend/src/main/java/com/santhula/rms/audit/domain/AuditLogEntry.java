package com.santhula.rms.audit.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import com.santhula.rms.audit.service.AuditAction;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

/** One row of the append-only audit log. Hibernate never updates it; the DB role can't either. */
@Entity
@Immutable
@Table(name = "audit_log")
public class AuditLogEntry implements Persistable<UUID> {

    @Id
    private UUID id;
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private Instant at;
    @Column(name = "user_id")
    private UUID userId;
    private String username;
    @Column(name = "user_full_name")
    private String userFullName;
    @Column(name = "terminal_id")
    private UUID terminalId;
    @Column(name = "terminal_name")
    private String terminalName;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AuditAction action;
    @Column(name = "entity_type", nullable = false)
    private String entityType;
    @Column(name = "entity_id")
    private String entityId;
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> before;
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> after;
    @Column(name = "approver_id")
    private UUID approverId;
    @Column(name = "approver_username")
    private String approverUsername;
    @Column(name = "approver_full_name")
    private String approverFullName;
    private String reason;
    @Column(name = "trace_id")
    private String traceId;
    /** IP address and trimmed User-Agent of the request (ADR-008); null for system actions. */
    @Column(name = "client_info")
    private String clientInfo;

    protected AuditLogEntry() {
    }

    @SuppressWarnings("java:S107")
    public AuditLogEntry(UUID branchId, Instant at, UUID userId, String username, String userFullName,
                         UUID terminalId, String terminalName, AuditAction action, String entityType, String entityId,
                         Map<String, Object> before, Map<String, Object> after, UUID approverId, String approverUsername,
                         String approverFullName, String reason, String traceId, String clientInfo) {
        this.id = UUID.randomUUID();
        this.branchId = branchId;
        this.at = at;
        this.userId = userId;
        this.username = username;
        this.userFullName = userFullName;
        this.terminalId = terminalId;
        this.terminalName = terminalName;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.before = before;
        this.after = after;
        this.approverId = approverId;
        this.approverUsername = approverUsername;
        this.approverFullName = approverFullName;
        this.reason = reason;
        this.traceId = traceId;
        this.clientInfo = clientInfo;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return true;
    }

    public UUID getBranchId() {
        return branchId;
    }

    public Instant getAt() {
        return at;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getUsername() {
        return username;
    }

    public String getUserFullName() {
        return userFullName;
    }

    public UUID getTerminalId() {
        return terminalId;
    }

    public String getTerminalName() {
        return terminalName;
    }

    public AuditAction getAction() {
        return action;
    }

    public String getEntityType() {
        return entityType;
    }

    public String getEntityId() {
        return entityId;
    }

    public Map<String, Object> getBefore() {
        return before;
    }

    public Map<String, Object> getAfter() {
        return after;
    }

    public UUID getApproverId() {
        return approverId;
    }

    public String getApproverUsername() {
        return approverUsername;
    }

    public String getApproverFullName() {
        return approverFullName;
    }

    public String getReason() {
        return reason;
    }

    public String getTraceId() {
        return traceId;
    }

    public String getClientInfo() {
        return clientInfo;
    }
}
