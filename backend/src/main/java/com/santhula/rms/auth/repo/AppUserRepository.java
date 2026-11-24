package com.santhula.rms.auth.repo;

import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.SystemRole;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface AppUserRepository extends JpaRepository<AppUser, UUID>, JpaSpecificationExecutor<AppUser> {

    Optional<AppUser> findByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCase(String username);

    /** Stamps the last login without touching the row's version: logging in is not an edit (BUG-1-001). */
    @Modifying
    @Query("update AppUser u set u.lastLoginAt = :at where u.id = :id")
    int touchLastLogin(UUID id, java.time.Instant at);

    @Query("select count(distinct u) from AppUser u join u.roles r where r.id = :roleId and u.active = true")
    long countActiveByRole(UUID roleId);

    @Query("select count(u) > 0 from AppUser u join u.roles r where r.id = :roleId")
    boolean existsByRole(UUID roleId);

    @Query("""
            select count(distinct u) from AppUser u join u.roles r
             where r.systemCode = :owner and u.active = true and u.id <> :excludedUserId""")
    long countOtherActiveOwners(UUID excludedUserId, SystemRole owner);

    default long countOtherActiveOwners(UUID excludedUserId) {
        return countOtherActiveOwners(excludedUserId, SystemRole.OWNER);
    }

    @Query("select count(distinct u) from AppUser u join u.roles r where r.systemCode = :owner and u.active = true")
    long countActiveOwners(SystemRole owner);
}
