package com.santhula.rms.floor.repo;

import com.santhula.rms.floor.domain.DiningTable;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiningTableRepository extends JpaRepository<DiningTable, UUID> {

    List<DiningTable> findByBranchId(UUID branchId);

    Optional<DiningTable> findByBranchIdAndNumberIgnoreCase(UUID branchId, String number);

    boolean existsByBranchIdAndNumberIgnoreCaseAndIdNot(UUID branchId, String number, UUID id);

    boolean existsByBranchIdAndNumberIgnoreCase(UUID branchId, String number);
}
