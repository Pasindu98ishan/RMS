package com.santhula.rms.audit.service;

import com.santhula.rms.audit.domain.AuditLogEntry;
import com.santhula.rms.audit.repo.AuditLogRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.security.CurrentActor;
import com.santhula.rms.common.web.ClientInfo;
import com.santhula.rms.common.web.TraceIdFilter;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only way other modules write to the audit log. {@link #record} joins the caller's
 * transaction, so the audit row commits or rolls back with the change it describes.
 * {@link #recordIndependently} commits on its own: use it for failures (wrong password, wrong
 * PIN) that must be logged even though the request then fails.
 */
@Service
public class AuditService {

    private final AuditLogRepository repository;
    private final RmsProperties properties;
    private final Clock clock;

    public AuditService(AuditLogRepository repository, RmsProperties properties, Clock clock) {
        this.repository = repository;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRED)
    public void record(AuditRecord record) {
        repository.save(toEntry(record));
    }

    /** Many entries at once (an import): one batch instead of a statement per row. Same transaction as the caller. */
    @Transactional(propagation = Propagation.REQUIRED)
    public void recordAll(java.util.Collection<AuditRecord> records) {
        repository.saveAll(records.stream().map(this::toEntry).toList());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIndependently(AuditRecord record) {
        repository.save(toEntry(record));
    }

    @Transactional(readOnly = true)
    public Page<AuditLogEntry> search(AuditQuery query, int page, int size, Sort.Direction direction) {
        return repository.findAll(spec(query), PageRequest.of(page, size, Sort.by(direction, "at").and(Sort.by(direction, "id"))));
    }

    @Transactional(readOnly = true)
    public long count(AuditQuery query) {
        return repository.count(spec(query));
    }

    @Transactional(readOnly = true)
    public List<AuditLogEntry> findAllForExport(AuditQuery query) {
        return repository.findAll(spec(query), Sort.by(Sort.Direction.DESC, "at").and(Sort.by(Sort.Direction.DESC, "id")));
    }

    private AuditLogEntry toEntry(AuditRecord r) {
        Optional<CurrentActor> current = CurrentActor.current();
        AuditRecord.Person actor = r.actor() != null ? r.actor()
                : current.map(a -> new AuditRecord.Person(a.userId(), a.username(), a.fullName())).orElse(null);
        AuditRecord.Place terminal = r.terminal() != null ? r.terminal()
                : current.filter(a -> a.terminalId() != null).map(a -> new AuditRecord.Place(a.terminalId(), a.terminalName())).orElse(null);
        AuditRecord.Person approver = r.approver();
        return new AuditLogEntry(
                properties.branchId(),
                Instant.now(clock),
                actor == null ? null : actor.id(),
                actor == null ? null : actor.username(),
                actor == null ? null : actor.fullName(),
                terminal == null ? null : terminal.id(),
                terminal == null ? null : terminal.name(),
                r.action(),
                r.entityType(),
                r.entityId(),
                copy(r.before()),
                copy(r.after()),
                approver == null ? null : approver.id(),
                approver == null ? null : approver.username(),
                approver == null ? null : approver.fullName(),
                r.reason(),
                TraceIdFilter.currentTraceId(),
                ClientInfo.current().orElse(null));
    }

    private static Map<String, Object> copy(Map<String, Object> m) {
        return m == null ? null : new LinkedHashMap<>(m);
    }

    private Specification<AuditLogEntry> spec(AuditQuery q) {
        if (q.from() != null && q.to() != null && q.to().isBefore(q.from())) {
            throw ApiException.validation("to", "'To' date must not be before 'from' date");
        }
        var zone = properties.timeZone();
        return (root, cq, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("branchId"), properties.branchId()));
            if (q.from() != null) {
                p.add(cb.greaterThanOrEqualTo(root.get("at"), q.from().atStartOfDay(zone).toInstant()));
            }
            if (q.to() != null) {
                p.add(cb.lessThan(root.get("at"), q.to().plusDays(1).atStartOfDay(zone).toInstant()));
            }
            if (q.userId() != null) {
                p.add(cb.equal(root.get("userId"), q.userId()));
            }
            if (q.action() != null) {
                p.add(cb.equal(root.get("action"), q.action()));
            }
            if (q.entityType() != null) {
                p.add(cb.equal(root.get("entityType"), q.entityType()));
            }
            if (q.entityId() != null) {
                p.add(cb.equal(root.get("entityId"), q.entityId()));
            }
            return cb.and(p.toArray(Predicate[]::new));
        };
    }
}
