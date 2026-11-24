package com.santhula.rms.auth.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class LockoutPolicyTest {

    private static final Instant NOW = Instant.parse("2026-11-21T08:00:00Z");
    private final LockoutPolicy passwords = new LockoutPolicy(5, Duration.ofMinutes(15));
    private final LockoutPolicy pins = new LockoutPolicy(3, Duration.ofMinutes(5));

    @Test
    void P1_AUTH_01_fourFailuresCount_fifthLocksFor15Minutes() {
        int attempts = 0;
        for (int i = 1; i <= 4; i++) {
            LockoutPolicy.Outcome o = passwords.onFailure(attempts, null, NOW);
            assertThat(o.justLocked()).isFalse();
            assertThat(o.lockedUntil()).isNull();
            assertThat(o.attempts()).isEqualTo(i);
            attempts = o.attempts();
        }
        LockoutPolicy.Outcome fifth = passwords.onFailure(attempts, null, NOW);
        assertThat(fifth.justLocked()).isTrue();
        assertThat(fifth.lockedUntil()).isEqualTo(NOW.plus(Duration.ofMinutes(15)));
        assertThat(fifth.attempts()).isZero();
    }

    @Test
    void P1_AUTH_05_thirdWrongPinLocksFor5Minutes() {
        LockoutPolicy.Outcome first = pins.onFailure(0, null, NOW);
        LockoutPolicy.Outcome second = pins.onFailure(first.attempts(), null, NOW);
        LockoutPolicy.Outcome third = pins.onFailure(second.attempts(), null, NOW);
        assertThat(first.justLocked()).isFalse();
        assertThat(second.justLocked()).isFalse();
        assertThat(third.justLocked()).isTrue();
        assertThat(third.lockedUntil()).isEqualTo(NOW.plus(Duration.ofMinutes(5)));
    }

    @Test
    void lockIsActiveUntilItsEnd() {
        Instant until = NOW.plus(Duration.ofMinutes(15));
        assertThat(passwords.isLocked(until, NOW)).isTrue();
        assertThat(passwords.isLocked(until, until.minusSeconds(1))).isTrue();
        assertThat(passwords.isLocked(until, until)).isFalse();
        assertThat(passwords.isLocked(null, NOW)).isFalse();
    }

    @Test
    void afterAnExpiredLock_countingStartsAgain() {
        Instant expired = NOW.minusSeconds(1);
        LockoutPolicy.Outcome o = passwords.onFailure(4, expired, NOW);
        assertThat(o.justLocked()).isFalse();
        assertThat(o.attempts()).isEqualTo(1);
    }

    @Test
    void invalidPoliciesAreRejected() {
        assertThatThrownBy(() -> new LockoutPolicy(0, Duration.ofMinutes(1))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new LockoutPolicy(3, Duration.ZERO)).isInstanceOf(IllegalArgumentException.class);
    }
}
