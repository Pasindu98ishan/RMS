package com.santhula.rms.settings.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.settings.domain.Reason;
import com.santhula.rms.settings.domain.ReasonCategory;
import com.santhula.rms.settings.repo.ReasonRepository;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Editable reason lists for cancel, void, refund, petty cash and other discounts (P1-SET-08). */
@Service
public class ReasonService {

    private final ReasonRepository reasons;
    private final AuditService audit;
    private final RmsProperties properties;

    public ReasonService(ReasonRepository reasons, AuditService audit, RmsProperties properties) {
        this.reasons = reasons;
        this.audit = audit;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<Reason> list(ReasonCategory category) {
        List<Reason> all = category == null ? reasons.findByBranchId(properties.branchId())
                : reasons.findByBranchIdAndCategory(properties.branchId(), category);
        return all.stream().sorted(Comparator.comparing(Reason::getCategory).thenComparing(r -> r.getText().toLowerCase(Locale.ROOT))).toList();
    }

    /** Active reasons of one list, for the dialogs. */
    @Transactional(readOnly = true)
    public List<Reason> activeReasons(ReasonCategory category) {
        return list(category).stream().filter(Reason::isActive).toList();
    }

    @Transactional
    public Reason create(ReasonCategory category, String text, Boolean active) {
        String trimmed = text.trim();
        if (reasons.existsByBranchIdAndCategoryAndTextIgnoreCase(properties.branchId(), category, trimmed)) {
            throw textTaken(trimmed);
        }
        Reason r = new Reason(properties.branchId(), category, trimmed, active == null || active);
        reasons.saveAndFlush(r);
        audit.record(AuditRecord.of(AuditAction.CREATE, "REASON", r.getId()).after(snapshot(r)).build());
        return r;
    }

    @Transactional
    public Reason update(UUID id, String text, boolean active, int expectedVersion) {
        Reason r = reasons.findById(id).orElseThrow(() -> ApiException.notFound("This reason"));
        if (r.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("reason");
        }
        String trimmed = text.trim();
        if (reasons.existsByBranchIdAndCategoryAndTextIgnoreCaseAndIdNot(properties.branchId(), r.getCategory(), trimmed, id)) {
            throw textTaken(trimmed);
        }
        Map<String, Object> before = snapshot(r);
        r.update(trimmed, active);
        reasons.saveAndFlush(r);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "REASON", id).before(before).after(snapshot(r)).build());
        return r;
    }

    private static ApiException textTaken(String text) {
        return ApiException.conflict("REASON_TEXT_TAKEN", "Reason already listed", "'" + text + "' is already in this list.");
    }

    private static Map<String, Object> snapshot(Reason r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("category", r.getCategory().name());
        m.put("text", r.getText());
        m.put("active", r.isActive());
        return m;
    }
}
