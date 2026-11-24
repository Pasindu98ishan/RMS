package com.santhula.rms.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on @Scheduled jobs (the daily sold-out reset). */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
