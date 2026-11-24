package com.santhula.rms.common.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
public class ClockConfig {

    /**
     * UTC clock; all timestamps are stored in UTC and shown in Asia/Colombo by the UI. Under the
     * `test` profile a movable clock replaces it (com.santhula.rms.testsupport).
     */
    @Bean
    @Profile("!test")
    Clock clock() {
        return Clock.systemUTC();
    }
}
