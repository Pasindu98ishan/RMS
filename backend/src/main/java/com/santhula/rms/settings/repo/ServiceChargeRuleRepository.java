package com.santhula.rms.settings.repo;

import com.santhula.rms.settings.domain.ServiceChargeRule;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ServiceChargeRuleRepository extends JpaRepository<ServiceChargeRule, UUID> {

    List<ServiceChargeRule> findByBranchId(UUID branchId);

    /**
     * The three rules are edited as one set with one version: every row is rewritten with
     * version + 1 (even if its rate is unchanged), guarded by the version the client saw.
     * Returns 0 when the row was changed by someone else.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ServiceChargeRule r
               set r.rate = :rate, r.version = r.version + 1, r.updatedAt = :now, r.updatedBy = :userId
             where r.id = :id and r.version = :expectedVersion""")
    int updateRate(UUID id, BigDecimal rate, int expectedVersion, Instant now, UUID userId);
}
