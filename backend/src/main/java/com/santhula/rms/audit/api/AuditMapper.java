package com.santhula.rms.audit.api;

import com.santhula.rms.api.generated.model.AuditAction;
import com.santhula.rms.api.generated.model.AuditEntry;
import com.santhula.rms.api.generated.model.TerminalRef;
import com.santhula.rms.api.generated.model.UserRef;
import com.santhula.rms.audit.domain.AuditLogEntry;
import java.time.ZoneOffset;

final class AuditMapper {

    private AuditMapper() {
    }

    static AuditEntry toDto(AuditLogEntry e) {
        AuditEntry dto = new AuditEntry()
                .id(e.getId())
                .at(e.getAt().atOffset(ZoneOffset.UTC))
                .action(AuditAction.fromValue(e.getAction().name()))
                .entityType(e.getEntityType())
                .entityId(e.getEntityId())
                .reason(e.getReason())
                .clientInfo(e.getClientInfo());
        if (e.getUserId() != null) {
            dto.user(new UserRef(e.getUserId(), e.getUsername(), nonNull(e.getUserFullName())));
        } else {
            dto.username(e.getUsername());
        }
        if (e.getTerminalId() != null) {
            dto.terminal(new TerminalRef(e.getTerminalId(), nonNull(e.getTerminalName())));
        }
        if (e.getApproverId() != null) {
            dto.approver(new UserRef(e.getApproverId(), e.getApproverUsername(), nonNull(e.getApproverFullName())));
        }
        // Generated models default maps to empty; absent snapshots must be omitted (NON_NULL).
        dto.setBefore(e.getBefore());
        dto.setAfter(e.getAfter());
        return dto;
    }

    private static String nonNull(String s) {
        return s == null ? "" : s;
    }
}
