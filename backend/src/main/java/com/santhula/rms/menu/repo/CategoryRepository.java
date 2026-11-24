package com.santhula.rms.menu.repo;

import com.santhula.rms.menu.domain.Category;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CategoryRepository extends JpaRepository<Category, UUID> {

    List<Category> findByBranchId(UUID branchId);

    List<Category> findByBranchIdAndActiveTrue(UUID branchId);

    Optional<Category> findByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCaseAndIdNot(UUID branchId, String name, UUID id);

    @Query("select coalesce(max(c.sortOrder), 0) from Category c where c.branchId = :branchId")
    int maxSortOrder(UUID branchId);
}
