package com.santhula.rms.settings.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.santhula.rms.common.error.ApiException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/** Service charge / tax rates: 0.00-100.00, at most 2 decimals, normalised to scale 2 (P1-SET-01/02). */
class RateValidationTest {

    @Test
    void validRatesAreNormalisedToTwoDecimals() {
        assertThat(SettingsService.checkRate(new BigDecimal("10"), "rate")).isEqualByComparingTo("10.00").hasToString("10.00");
        assertThat(SettingsService.checkRate(new BigDecimal("0"), "rate")).hasToString("0.00");
        assertThat(SettingsService.checkRate(new BigDecimal("100.00"), "rate")).hasToString("100.00");
        assertThat(SettingsService.checkRate(new BigDecimal("12.5"), "rate")).hasToString("12.50");
    }

    @Test
    void outOfRangeOrTooPreciseRatesAreFieldErrors() {
        for (String bad : new String[] {"-0.01", "100.01", "10.005"}) {
            assertThatThrownBy(() -> SettingsService.checkRate(new BigDecimal(bad), "rules[0].rate"))
                    .isInstanceOfSatisfying(ApiException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("VALIDATION_FAILED");
                        assertThat(e.getFieldErrors()).extracting(ApiException.FieldViolation::field).containsExactly("rules[0].rate");
                    });
        }
        assertThatThrownBy(() -> SettingsService.checkRate(null, "rate")).isInstanceOf(ApiException.class);
    }
}
