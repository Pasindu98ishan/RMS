package com.santhula.rms.audit.service;

import java.time.LocalDate;
import java.util.UUID;

/** Audit search filters. Dates are calendar dates in the branch time zone, inclusive. */
public record AuditQuery(LocalDate from, LocalDate to, UUID userId, AuditAction action, String entityType, String entityId) {
}
