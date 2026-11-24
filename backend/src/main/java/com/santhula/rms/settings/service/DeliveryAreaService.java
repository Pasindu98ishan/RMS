package com.santhula.rms.settings.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.validation.Amounts;
import com.santhula.rms.settings.domain.DeliveryArea;
import com.santhula.rms.settings.repo.DeliveryAreaRepository;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Delivery areas and their fees (P1-SET-07). Never deleted, only deactivated. */
@Service
public class DeliveryAreaService {

    private final DeliveryAreaRepository areas;
    private final AuditService audit;
    private final RmsProperties properties;

    public DeliveryAreaService(DeliveryAreaRepository areas, AuditService audit, RmsProperties properties) {
        this.areas = areas;
        this.audit = audit;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<DeliveryArea> list() {
        return sorted(areas.findByBranchId(properties.branchId()));
    }

    /** Active areas for the delivery order screen. */
    @Transactional(readOnly = true)
    public List<DeliveryArea> activeAreas() {
        return sorted(areas.findByBranchId(properties.branchId()).stream().filter(DeliveryArea::isActive).toList());
    }

    @Transactional(readOnly = true)
    public DeliveryArea get(UUID id) {
        return find(id);
    }

    @Transactional(readOnly = true)
    public Optional<DeliveryArea> findByName(String name) {
        return areas.findByBranchIdAndNameIgnoreCase(properties.branchId(), name.trim());
    }

    @Transactional(readOnly = true)
    public boolean nameExists(String name) {
        return areas.existsByBranchIdAndNameIgnoreCase(properties.branchId(), name.trim());
    }

    @Transactional
    public DeliveryArea create(String name, BigDecimal fee, Boolean active) {
        String trimmed = name.trim();
        BigDecimal checked = Amounts.nonNegative(fee, "fee", "Fee");
        if (areas.existsByBranchIdAndNameIgnoreCase(properties.branchId(), trimmed)) {
            throw nameTaken(trimmed);
        }
        DeliveryArea a = new DeliveryArea(properties.branchId(), trimmed, checked, active == null || active);
        areas.saveAndFlush(a);
        audit.record(AuditRecord.of(AuditAction.CREATE, "DELIVERY_AREA", a.getId()).after(snapshot(a)).build());
        return a;
    }

    @Transactional
    public DeliveryArea update(UUID id, String name, BigDecimal fee, boolean active, int expectedVersion) {
        DeliveryArea a = find(id);
        if (a.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("delivery area");
        }
        String trimmed = name.trim();
        BigDecimal checked = Amounts.nonNegative(fee, "fee", "Fee");
        if (areas.existsByBranchIdAndNameIgnoreCaseAndIdNot(properties.branchId(), trimmed, id)) {
            throw nameTaken(trimmed);
        }
        Map<String, Object> before = snapshot(a);
        a.update(trimmed, checked, active);
        areas.saveAndFlush(a);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "DELIVERY_AREA", id).before(before).after(snapshot(a)).build());
        return a;
    }

    private DeliveryArea find(UUID id) {
        return areas.findById(id).orElseThrow(() -> ApiException.notFound("This delivery area"));
    }

    private static List<DeliveryArea> sorted(List<DeliveryArea> list) {
        return list.stream().sorted(Comparator.comparing(a -> a.getName().toLowerCase(Locale.ROOT))).toList();
    }

    private static ApiException nameTaken(String name) {
        return ApiException.conflict("DELIVERY_AREA_NAME_TAKEN", "Area name taken", "A delivery area called '" + name + "' already exists.");
    }

    private static Map<String, Object> snapshot(DeliveryArea a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", a.getName());
        m.put("fee", a.getFee().toPlainString());
        m.put("active", a.isActive());
        return m;
    }
}
