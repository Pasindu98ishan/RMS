package com.santhula.rms.menu.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Calls the daily sold-out reset once a minute (and shortly after start-up, which catches up a missed
 * day). Switched off in the integration tests with {@code rms.menu.reset-scheduler-enabled=false}; they
 * call the service directly with the test clock.
 */
@Component
@ConditionalOnProperty(name = "rms.menu.reset-scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class AvailabilityResetScheduler {

    private static final Logger log = LoggerFactory.getLogger(AvailabilityResetScheduler.class);

    private final AvailabilityResetService service;

    public AvailabilityResetScheduler(AvailabilityResetService service) {
        this.service = service;
    }

    @Scheduled(initialDelayString = "PT20S", fixedDelayString = "PT1M")
    void tick() {
        try {
            service.resetIfNewBusinessDay();
        } catch (RuntimeException e) {
            log.warn("Daily sold-out reset failed, will retry in a minute: {}", e.toString());
        }
    }
}
