package com.santhula.rms.auth.service;

import com.santhula.rms.common.error.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Limits failed terminal registrations per client IP: 5 failures within 15 minutes, then 429
 * TOO_MANY_ATTEMPTS until the oldest failure leaves the window (lead decision on QA Q4).
 * Registration failures don't count towards the account lock, so this is what slows down
 * password guessing from unregistered devices. In memory: one app instance (ADR-001).
 */
@Component
public class RegistrationRateLimiter {

    static final int MAX_FAILURES = 5;
    static final Duration WINDOW = Duration.ofMinutes(15);

    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();
    private final Clock clock;

    public RegistrationRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Throws 429 when this IP has used up its failures in the current window. */
    public void checkAllowed(String clientIp) {
        Instant now = Instant.now(clock);
        Deque<Instant> list = failures.get(key(clientIp));
        if (list == null) {
            return;
        }
        synchronized (list) {
            prune(list, now);
            if (list.size() >= MAX_FAILURES) {
                long retryAfter = Math.max(1, Duration.between(now, list.peekFirst().plus(WINDOW)).toSeconds());
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS", "Too many attempts",
                        "Too many wrong usernames or passwords from this device. Please wait before trying again.")
                        .withHeader("Retry-After", Long.toString(retryAfter));
            }
        }
    }

    public void recordFailure(String clientIp) {
        Instant now = Instant.now(clock);
        Deque<Instant> list = failures.computeIfAbsent(key(clientIp), k -> new ArrayDeque<>());
        synchronized (list) {
            prune(list, now);
            list.addLast(now);
        }
    }

    /** Clears all counters (test profile reset). */
    public void clear() {
        failures.clear();
    }

    private static void prune(Deque<Instant> list, Instant now) {
        Instant cutoff = now.minus(WINDOW);
        while (!list.isEmpty() && !list.peekFirst().isAfter(cutoff)) {
            list.removeFirst();
        }
    }

    private static String key(String ip) {
        return ip == null ? "unknown" : ip;
    }
}
