package com.santhula.rms.settings.repo;

import com.santhula.rms.settings.domain.Reason;
import com.santhula.rms.settings.domain.ReasonCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReasonRepository extends JpaRepository<Reason, UUID> {

    List<Reason> findByBranchId(UUID branchId);

    List<Reason> findByBranchIdAndCategory(UUID branchId, ReasonCategory category);

    boolean existsByBranchIdAndCategoryAndTextIgnoreCase(UUID branchId, ReasonCategory category, String text);

    boolean existsByBranchIdAndCategoryAndTextIgnoreCaseAndIdNot(UUID branchId, ReasonCategory category, String text, UUID id);
}
