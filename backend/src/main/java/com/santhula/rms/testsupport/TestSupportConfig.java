package com.santhula.rms.testsupport;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Test profile only: the movable clock replaces the system clock everywhere (lockouts, tokens). */
@Configuration
@Profile("test")
public class TestSupportConfig {

    @Bean
    MutableClock clock() {
        return new MutableClock();
    }
}
