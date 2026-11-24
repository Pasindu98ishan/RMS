package com.santhula.rms.auth.domain;

import java.time.Duration;
import java.time.Instant;

/**
 * Counts wrong attempts in a row and locks after the limit: passwords 5 / 15 min (P1-AUTH-01),
 * PINs 3 / 5 min (P1-AUTH-05). Pure logic, unit-tested in LockoutPolicyTest.
 */
public record LockoutPolicy(int maxAttempts, Duration lockDuration) {

    public LockoutPolicy {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be at least 1");
        }
        if (lockDuration.isNegative() || lockDuration.isZero()) {
            throw new IllegalArgumentException("lockDuration must be positive");
        }
    }

    /**
     * @param attemptsSoFar wrong attempts already counted (since the last success or lock)
     * @param lockedUntil   the current lock, possibly expired
     */
    public Outcome onFailure(int attemptsSoFar, Instant lockedUntil, Instant now) {
        // An expired lock starts a fresh count.
        int previous = lockedUntil != null && !lockedUntil.isAfter(now) ? 0 : attemptsSoFar;
        int attempts = previous + 1;
        if (attempts >= maxAttempts) {
            return new Outcome(0, now.plus(lockDuration), true);
        }
        return new Outcome(attempts, null, false);
    }

    public boolean isLocked(Instant lockedUntil, Instant now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }

    /** New counter and lock to store. When {@code justLocked}, the counter restarts at 0. */
    public record Outcome(int attempts, Instant lockedUntil, boolean justLocked) {
    }
}
