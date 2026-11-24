package com.santhula.rms.settings.repo;

import com.santhula.rms.settings.domain.DeliveryArea;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeliveryAreaRepository extends JpaRepository<DeliveryArea, UUID> {

    List<DeliveryArea> findByBranchId(UUID branchId);

    Optional<DeliveryArea> findByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCaseAndIdNot(UUID branchId, String name, UUID id);
}
