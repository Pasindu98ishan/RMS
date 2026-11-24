package com.santhula.rms.common.validation;

import com.santhula.rms.common.error.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Range rules for money in requests. The exact format (a text with 2 decimals) is enforced while
 * the JSON is read (StrictDecimalDeserializer); this checks the meaning.
 */
public final class Amounts {

    /** numeric(12,2): at most 10 digits before the point. */
    private static final BigDecimal MAX = new BigDecimal("9999999999.99");

    private Amounts() {
    }

    /** A price, fee or price delta: required, not negative, fits the column. Returns it with scale 2. */
    public static BigDecimal nonNegative(BigDecimal value, String field, String label) {
        if (value == null) {
            throw ApiException.validation(field, label + " is required");
        }
        if (value.signum() < 0) {
            throw ApiException.validation(field, label + " cannot be negative");
        }
        if (value.compareTo(MAX) > 0) {
            throw ApiException.validation(field, label + " is too large");
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    /** Same, but the value may be absent (an optional foreign price). */
    public static BigDecimal nonNegativeOrNull(BigDecimal value, String field, String label) {
        return value == null ? null : nonNegative(value, field, label);
    }
}
