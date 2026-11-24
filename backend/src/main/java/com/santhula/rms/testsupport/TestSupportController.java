package com.santhula.rms.testsupport;

import com.santhula.rms.auth.service.BootstrapOwner;
import com.santhula.rms.auth.service.RegistrationRateLimiter;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * QA helpers, ONLY under the `test` Spring profile (lead decision on QA Q26). Not part of the
 * public contract. Served at /api/v1/test/... and open without a token; in any other profile the
 * class is not loaded and these paths return 404 (TestSupportAbsentIT).
 */
@RestController
@Profile("test")
@RequestMapping("/test")
public class TestSupportController {

    private final MutableClock clock;
    private final DatabaseReset databaseReset;
    private final BootstrapOwner bootstrapOwner;
    private final RegistrationRateLimiter rateLimiter;

    public TestSupportController(MutableClock clock, DatabaseReset databaseReset, BootstrapOwner bootstrapOwner,
                                 RegistrationRateLimiter rateLimiter) {
        this.clock = clock;
        this.databaseReset = databaseReset;
        this.bootstrapOwner = bootstrapOwner;
        this.rateLimiter = rateLimiter;
    }

    public record AdvanceClockRequest(long minutes) {
    }

    /** Moves the server clock forward, e.g. {"minutes": 16} to pass the 15-minute account lock. */
    @PostMapping("/clock/advance")
    public ResponseEntity<Map<String, Object>> advance(@RequestBody AdvanceClockRequest req) {
        if (req.minutes() < 0) {
            return ResponseEntity.badRequest().body(Map.of("detail", "minutes must be >= 0"));
        }
        clock.advance(Duration.ofMinutes(req.minutes()));
        return ResponseEntity.ok(now());
    }

    /** Back to real time. */
    @PostMapping("/clock/reset")
    public ResponseEntity<Map<String, Object>> resetClock() {
        clock.reset();
        return ResponseEntity.ok(now());
    }

    /**
     * Empties every table (audit log included), re-runs the seed (branch, permissions, roles,
     * settings), re-creates the bootstrap owner, clears rate limits and resets the clock.
     * Registered terminals are gone afterwards: register again.
     */
    @PostMapping("/reset")
    public ResponseEntity<Void> reset() {
        databaseReset.truncateAndSeed();
        rateLimiter.clear();
        clock.reset();
        bootstrapOwner.run(null);
        return ResponseEntity.noContent().build();
    }

    private Map<String, Object> now() {
        Instant now = clock.instant();
        return Map.of("now", OffsetDateTime.ofInstant(now, ZoneOffset.UTC).toString(), "offsetMinutes", clock.offset().toMinutes());
    }
}
