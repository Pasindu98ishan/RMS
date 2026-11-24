package com.santhula.rms.menu.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.menu.repo.MenuItemRepository;
import com.santhula.rms.settings.service.SettingsService;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sold-out items become available again at the start of each business day, so a forgotten toggle cannot
 * hide an item forever (m1.1-scope.md decision 5). Controlled by the menu setting `resetAvailabilityDaily`
 * (on by default). Runs once a minute (AvailabilityResetScheduler) and is safe to call any time: it only
 * acts when the business date is newer than the date of the last reset.
 */
@Service
public class AvailabilityResetService {

    private static final Logger log = LoggerFactory.getLogger(AvailabilityResetService.class);

    private final MenuItemRepository items;
    private final SettingsService settings;
    private final AuditService audit;
    private final RmsProperties properties;
    private final Clock clock;

    public AvailabilityResetService(MenuItemRepository items, SettingsService settings, AuditService audit,
                                    RmsProperties properties, Clock clock) {
        this.items = items;
        this.settings = settings;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /** @return how many items were set available again (0 when nothing was due) */
    @Transactional
    public int resetIfNewBusinessDay() {
        LocalDate today = settings.currentBusinessDate();
        Optional<LocalDate> last = settings.lastAvailabilityReset();
        if (last.isPresent() && !today.isAfter(last.get())) {
            return 0;
        }
        // Remember the day even when the reset is switched off, so switching it on later in the day
        // does not wipe the sold-out marks set earlier that day.
        settings.markAvailabilityReset(today);
        if (!settings.menuSettings().value().resetAvailabilityDaily()) {
            return 0;
        }
        int reset = items.markAllAvailable(properties.branchId(), Instant.now(clock));
        if (reset > 0) {
            audit.record(AuditRecord.of(AuditAction.UPDATE, "MENU_ITEM", null)
                    .actor(new AuditRecord.Person(null, "system", "Daily sold-out reset"))
                    .after(Map.of("itemsMadeAvailable", reset, "businessDate", today.toString()))
                    .reason("Start of business day " + today).build());
            log.info("Business day {}: {} sold-out item(s) made available again", today, reset);
        }
        return reset;
    }
}
