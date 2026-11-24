package com.santhula.rms.floor.repo;

import com.santhula.rms.floor.domain.OrderingPoint;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderingPointRepository extends JpaRepository<OrderingPoint, UUID> {

    List<OrderingPoint> findByBranchIdOrderBySortOrder(UUID branchId);
}
