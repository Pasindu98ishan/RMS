package com.santhula.rms.menu.repo;

import com.santhula.rms.menu.domain.KitchenStation;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KitchenStationRepository extends JpaRepository<KitchenStation, UUID> {

    List<KitchenStation> findByBranchIdOrderByNumber(UUID branchId);

    Optional<KitchenStation> findByBranchIdAndNumber(UUID branchId, int number);

    boolean existsByBranchIdAndNameIgnoreCaseAndIdNot(UUID branchId, String name, UUID id);
}
