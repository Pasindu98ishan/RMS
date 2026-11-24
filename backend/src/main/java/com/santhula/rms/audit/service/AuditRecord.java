package com.santhula.rms.audit.service;

import java.util.Map;
import java.util.UUID;

/**
 * One audit entry to write. Who and where default to the logged-in user and terminal; set
 * {@link #actor} / {@link #terminal} explicitly when there is no token yet (login, registration).
 * Snapshots must never contain password or PIN hashes.
 */
public record AuditRecord(
        AuditAction action,
        String entityType,
        String entityId,
        Map<String, Object> before,
        Map<String, Object> after,
        Person actor,
        Place terminal,
        Person approver,
        String reason) {

    public static Builder of(AuditAction action, String entityType, Object entityId) {
        return new Builder(action, entityType, entityId == null ? null : entityId.toString());
    }

    /** A user as it should appear in the log. `id` is null for an unknown username (failed login). */
    public record Person(UUID id, String username, String fullName) {
    }

    public record Place(UUID id, String name) {
    }

    public static final class Builder {
        private final AuditAction action;
        private final String entityType;
        private final String entityId;
        private Map<String, Object> before;
        private Map<String, Object> after;
        private Person actor;
        private Place terminal;
        private Person approver;
        private String reason;

        private Builder(AuditAction action, String entityType, String entityId) {
            this.action = action;
            this.entityType = entityType;
            this.entityId = entityId;
        }

        public Builder before(Map<String, Object> before) {
            this.before = before;
            return this;
        }

        public Builder after(Map<String, Object> after) {
            this.after = after;
            return this;
        }

        public Builder actor(Person actor) {
            this.actor = actor;
            return this;
        }

        public Builder terminal(Place terminal) {
            this.terminal = terminal;
            return this;
        }

        public Builder approver(Person approver) {
            this.approver = approver;
            return this;
        }

        public Builder reason(String reason) {
            this.reason = reason;
            return this;
        }

        public AuditRecord build() {
            return new AuditRecord(action, entityType, entityId, before, after, actor, terminal, approver, reason);
        }
    }
}
