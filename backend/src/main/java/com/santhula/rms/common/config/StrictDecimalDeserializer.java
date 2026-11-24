package com.santhula.rms.common.config;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.regex.Pattern;

/**
 * Money and rates are JSON <em>strings</em> with exactly 2 decimals ("10.00", contract schemas
 * Money and Rate). The generated DTOs hold them as BigDecimal, so Jackson would otherwise accept
 * "5", "1e2", "5.0" and even the number 5 and silently normalise them (BUG-1-005). This
 * deserializer enforces the contract format; range rules (rates 0-100, prices not negative) are
 * checked by the services. A violation becomes a 422 field error (GlobalExceptionHandler).
 */
public class StrictDecimalDeserializer extends JsonDeserializer<BigDecimal> {

    static final Pattern FORMAT = Pattern.compile("^-?\\d{1,10}\\.\\d{2}$");
    static final String MESSAGE = "must be a text amount with exactly 2 decimals, like \"10.00\"";

    @Override
    public BigDecimal deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        if (p.currentToken() == JsonToken.VALUE_STRING) {
            String text = p.getText();
            if (FORMAT.matcher(text).matches()) {
                return new BigDecimal(text);
            }
            throw ctxt.weirdStringException(text, BigDecimal.class, MESSAGE);
        }
        if (p.currentToken() == JsonToken.VALUE_NUMBER_INT || p.currentToken() == JsonToken.VALUE_NUMBER_FLOAT) {
            throw ctxt.weirdNumberException(p.getNumberValue(), BigDecimal.class, MESSAGE);
        }
        return (BigDecimal) ctxt.handleUnexpectedToken(BigDecimal.class, p);
    }
}
