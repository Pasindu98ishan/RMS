package com.santhula.rms.menu.repo;

import com.santhula.rms.menu.domain.ModifierGroup;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ModifierGroupRepository extends JpaRepository<ModifierGroup, UUID> {

    List<ModifierGroup> findByBranchId(UUID branchId);

    List<ModifierGroup> findByBranchIdAndActiveTrue(UUID branchId);

    Optional<ModifierGroup> findByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCaseAndIdNot(UUID branchId, String name, UUID id);
}
