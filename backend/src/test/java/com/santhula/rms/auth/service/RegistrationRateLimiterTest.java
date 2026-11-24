package com.santhula.rms.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.testsupport.MutableClock;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class RegistrationRateLimiterTest {

    private final MutableClock clock = new MutableClock();
    private final RegistrationRateLimiter limiter = new RegistrationRateLimiter(clock);

    @Test
    void QA_Q4_fiveFailuresFromOneIp_give429_untilTheWindowPasses() {
        for (int i = 0; i < 5; i++) {
            limiter.checkAllowed("10.0.0.1");
            limiter.recordFailure("10.0.0.1");
        }
        assertThatThrownBy(() -> limiter.checkAllowed("10.0.0.1"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
                    assertThat(e.getCode()).isEqualTo("TOO_MANY_ATTEMPTS");
                    // The wait is in the Retry-After header only; the detail text must not repeat it.
                    assertThat(e.getMessage()).doesNotContainIgnoringCase("minute").doesNotContainPattern("[0-9]");
                    assertThat(Long.parseLong(e.getHeaders().get("Retry-After"))).isBetween(1L, 900L);
                });
        // Other clients are not affected.
        assertThatCode(() -> limiter.checkAllowed("10.0.0.2")).doesNotThrowAnyException();

        clock.advance(Duration.ofMinutes(15).plusSeconds(1));
        assertThatCode(() -> limiter.checkAllowed("10.0.0.1")).doesNotThrowAnyException();
    }

    @Test
    void fourFailuresAreStillAllowed() {
        for (int i = 0; i < 4; i++) {
            limiter.recordFailure("10.0.0.3");
        }
        assertThatCode(() -> limiter.checkAllowed("10.0.0.3")).doesNotThrowAnyException();
    }

    @Test
    void clearForgetsEverything() {
        for (int i = 0; i < 5; i++) {
            limiter.recordFailure("10.0.0.4");
        }
        limiter.clear();
        assertThatCode(() -> limiter.checkAllowed("10.0.0.4")).doesNotThrowAnyException();
    }
}
