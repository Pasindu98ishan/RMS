package com.santhula.rms.auth.repo;

import com.santhula.rms.auth.domain.Terminal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface TerminalRepository extends JpaRepository<Terminal, UUID> {

    List<Terminal> findByBranchIdOrderByName(UUID branchId);

    /** Stamps the last login without touching the row's version (BUG-1-001). */
    @Modifying
    @Query("update Terminal t set t.lastLoginAt = :at where t.id = :id")
    int touchLastLogin(UUID id, java.time.Instant at);

    @Query("""
            select count(t) > 0 from Terminal t
             where t.branchId = :branchId and lower(t.name) = lower(:name) and t.active = true
               and (:excludedId is null or t.id <> :excludedId)""")
    boolean activeNameTaken(UUID branchId, String name, UUID excludedId);
}
