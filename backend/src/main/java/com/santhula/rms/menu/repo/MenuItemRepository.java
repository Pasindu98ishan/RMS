package com.santhula.rms.menu.repo;

import com.santhula.rms.menu.domain.MenuItem;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MenuItemRepository extends JpaRepository<MenuItem, UUID>, JpaSpecificationExecutor<MenuItem> {

    Optional<MenuItem> findByBranchIdAndCode(UUID branchId, String code);

    boolean existsByBranchIdAndCodeAndIdNot(UUID branchId, String code, UUID id);

    boolean existsByBranchIdAndCode(UUID branchId, String code);

    long countByCategoryId(UUID categoryId);

    long countByStationIdAndActiveTrue(UUID stationId);

    List<MenuItem> findByBranchId(UUID branchId);

    List<MenuItem> findByBranchIdAndActiveTrue(UUID branchId);

    @Query("select i.categoryId as categoryId, count(i) as n from MenuItem i where i.branchId = :branchId group by i.categoryId")
    List<CountByKey> countByCategory(UUID branchId);

    @Query("select i.stationId as categoryId, count(i) as n from MenuItem i where i.branchId = :branchId and i.active = true group by i.stationId")
    List<CountByKey> countActiveByStation(UUID branchId);

    @Query("select g as categoryId, count(distinct i) as n from MenuItem i join i.modifierGroupIds g where i.branchId = :branchId group by g")
    List<CountByKey> countByModifierGroup(UUID branchId);

    @Query("select count(distinct i) from MenuItem i join i.modifierGroupIds g where g = :groupId")
    long countUsingGroup(UUID groupId);

    /**
     * The sold-out toggle. A plain UPDATE: going through the entity would let the auditing listener touch
     * updatedAt, which bumps the version and would make an admin's open edit form fail with a conflict.
     */
    @Modifying
    @Query("update MenuItem i set i.available = :available, i.updatedAt = :now where i.id = :id")
    int setAvailable(UUID id, boolean available, Instant now);

    /** Daily reset: every sold-out item becomes available again. */
    @Modifying
    @Query("update MenuItem i set i.available = true, i.updatedAt = :now where i.branchId = :branchId and i.available = false")
    int markAllAvailable(UUID branchId, Instant now);

    /** Projection of a (key, count) pair; the key column is named categoryId for every query. */
    interface CountByKey {
        UUID getCategoryId();

        long getN();
    }

    default java.util.Map<UUID, Long> toMap(Collection<CountByKey> rows) {
        java.util.Map<UUID, Long> map = new java.util.HashMap<>();
        rows.forEach(r -> map.put(r.getCategoryId(), r.getN()));
        return map;
    }
}
