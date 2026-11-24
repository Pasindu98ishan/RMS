package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.menu.domain.KitchenStation;
import com.santhula.rms.menu.repo.KitchenStationRepository;
import com.santhula.rms.menu.repo.MenuItemRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The three kitchen stations (P1-MENU-07, P1-SET-05). Seeded; names, target times and the active flag are editable. */
@Service
public class KitchenStationService {

    /** A station with the number of active items mapped to it. */
    public record StationView(KitchenStation station, long activeItemCount) {
    }

    /** Plain data for other modules (terminals, import); they never see the entity. */
    public record StationInfo(UUID id, int number, String name, boolean active) {
    }

    private final KitchenStationRepository stations;
    private final MenuItemRepository items;
    private final AuditService audit;
    private final RmsProperties properties;

    public KitchenStationService(KitchenStationRepository stations, MenuItemRepository items, AuditService audit, RmsProperties properties) {
        this.stations = stations;
        this.items = items;
        this.audit = audit;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<StationView> list() {
        Map<UUID, Long> counts = items.toMap(items.countActiveByStation(properties.branchId()));
        return stations.findByBranchIdOrderByNumber(properties.branchId()).stream()
                .map(s -> new StationView(s, counts.getOrDefault(s.getId(), 0L))).toList();
    }

    @Transactional(readOnly = true)
    public StationView get(UUID id) {
        KitchenStation s = find(id);
        return new StationView(s, items.countByStationIdAndActiveTrue(id));
    }

    @Transactional
    public StationView update(UUID id, String name, int targetPrepMinutes, boolean active, int expectedVersion) {
        KitchenStation s = find(id);
        if (s.getVersion() != expectedVersion) {
            throw ApiException.versionConflict("kitchen station");
        }
        String trimmed = name.trim();
        if (stations.existsByBranchIdAndNameIgnoreCaseAndIdNot(properties.branchId(), trimmed, id)) {
            throw ApiException.conflict("STATION_NAME_TAKEN", "Station name taken", "A kitchen station called '" + trimmed + "' already exists.");
        }
        long activeItems = items.countByStationIdAndActiveTrue(id);
        if (!active && s.isActive() && activeItems > 0) {
            throw ApiException.conflict("STATION_IN_USE", "Station still in use",
                    "This station still has " + activeItems + " active menu item(s). Move them to another station first.");
        }
        Map<String, Object> before = snapshot(s);
        s.update(trimmed, targetPrepMinutes, active);
        stations.saveAndFlush(s);
        audit.record(AuditRecord.of(AuditAction.UPDATE, "KITCHEN_STATION", id).before(before).after(snapshot(s)).build());
        return new StationView(s, activeItems);
    }

    /**
     * Dev seeder: gives station {@code number} a demo name and target time, but only while it still has its
     * factory name, so a developer's own rename is kept. Returns whether it changed anything.
     */
    @Transactional
    public boolean renameIfFactoryName(int number, String factoryName, String newName, int targetPrepMinutes) {
        KitchenStation s = stations.findByBranchIdAndNumber(properties.branchId(), number).orElse(null);
        if (s == null || !s.getName().equals(factoryName)) {
            return false;
        }
        update(s.getId(), newName, targetPrepMinutes, s.isActive(), s.getVersion());
        return true;
    }

    // ------------------------------------------------------------------ lookups for other modules

    /** Active stations by number (terminal setup, POS menu). */
    @Transactional(readOnly = true)
    public List<StationInfo> activeStations() {
        return stations.findByBranchIdOrderByNumber(properties.branchId()).stream().filter(KitchenStation::isActive)
                .map(KitchenStationService::info).toList();
    }

    @Transactional(readOnly = true)
    public List<StationInfo> allStations() {
        return stations.findByBranchIdOrderByNumber(properties.branchId()).stream().map(KitchenStationService::info).toList();
    }

    /** The station when it exists and is active (a KITCHEN terminal or an item may only use those). */
    @Transactional(readOnly = true)
    public Optional<StationInfo> findActive(UUID id) {
        return id == null ? Optional.empty() : stations.findById(id).filter(KitchenStation::isActive).map(KitchenStationService::info);
    }

    @Transactional(readOnly = true)
    public Map<UUID, String> names(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return stations.findAllById(ids).stream().collect(Collectors.toMap(KitchenStation::getId, KitchenStation::getName, (a, b) -> a));
    }

    @Transactional(readOnly = true)
    public Optional<String> name(UUID id) {
        return id == null ? Optional.empty() : Optional.ofNullable(names(List.of(id)).get(id));
    }

    // ------------------------------------------------------------------ helpers

    private KitchenStation find(UUID id) {
        return stations.findById(id).orElseThrow(() -> ApiException.notFound("This kitchen station"));
    }

    private static StationInfo info(KitchenStation s) {
        return new StationInfo(s.getId(), s.getNumber(), s.getName(), s.isActive());
    }

    private static Map<String, Object> snapshot(KitchenStation s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("number", s.getNumber());
        m.put("name", s.getName());
        m.put("targetPrepMinutes", s.getTargetPrepMinutes());
        m.put("active", s.isActive());
        return m;
    }
}
