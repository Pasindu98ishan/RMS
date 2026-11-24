package com.santhula.rms.auth.repo;

import com.santhula.rms.auth.domain.Role;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, UUID> {

    List<Role> findByBranchId(UUID branchId);

    boolean existsByBranchIdAndNameIgnoreCase(UUID branchId, String name);

    boolean existsByBranchIdAndNameIgnoreCaseAndIdNot(UUID branchId, String name, UUID id);
}
