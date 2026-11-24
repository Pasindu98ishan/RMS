package com.santhula.rms.settings.repo;

import com.santhula.rms.settings.domain.SettingEntry;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SettingRepository extends JpaRepository<SettingEntry, UUID> {

    Optional<SettingEntry> findByBranchIdAndKey(UUID branchId, String key);
}
