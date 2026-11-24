package com.santhula.rms.floor.service;

import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.floor.domain.OrderingPoint;
import com.santhula.rms.floor.repo.OrderingPointRepository;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The Cashier and Reception ordering points (P1-FLOOR-02). Also the lookup other modules (terminals) use. */
@Service
public class OrderingPointService {

    /** Plain data for other modules; they never see the entity. */
    public record OrderingPointInfo(UUID id, String name) {
    }

    private final OrderingPointRepository repository;
    private final RmsProperties properties;

    public OrderingPointService(OrderingPointRepository repository, RmsProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<OrderingPointInfo> list() {
        return repository.findByBranchIdOrderBySortOrder(properties.branchId()).stream()
                .map(p -> new OrderingPointInfo(p.getId(), p.getName())).toList();
    }

    @Transactional(readOnly = true)
    public Optional<OrderingPointInfo> find(UUID id) {
        return repository.findById(id).map(p -> new OrderingPointInfo(p.getId(), p.getName()));
    }

    /** Names for the given ids (ids that do not exist are left out). */
    @Transactional(readOnly = true)
    public Map<UUID, String> names(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return repository.findAllById(ids).stream().collect(Collectors.toMap(OrderingPoint::getId, OrderingPoint::getName, (a, b) -> a));
    }

    /** Convenience for mappers that need one name. */
    @Transactional(readOnly = true)
    public Optional<String> name(UUID id) {
        return id == null ? Optional.empty() : Optional.ofNullable(names(List.of(id)).get(id));
    }
}
