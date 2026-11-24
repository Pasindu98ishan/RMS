package com.santhula.rms.testsupport;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** System UTC time plus an offset that tests can move forward (test profile only). */
public class MutableClock extends Clock {

    private volatile Duration offset = Duration.ZERO;

    public void advance(Duration by) {
        offset = offset.plus(by);
    }

    public void reset() {
        offset = Duration.ZERO;
    }

    public Duration offset() {
        return offset;
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return Clock.offset(Clock.system(zone), offset);
    }

    @Override
    public Instant instant() {
        return Instant.now().plus(offset);
    }
}
