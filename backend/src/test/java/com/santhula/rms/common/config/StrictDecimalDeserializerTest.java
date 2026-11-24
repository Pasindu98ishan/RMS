package com.santhula.rms.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import java.math.BigDecimal;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

/** BUG-1-005: the server enforces the contract's Money / Rate format and strict integer typing. */
class StrictDecimalDeserializerTest {

    public static class Body {
        public BigDecimal rate;
        public Integer minutes;
        public Boolean flag;
    }

    private final ObjectMapper mapper = JsonMapper.builder()
            .addModule(new SimpleModule().addDeserializer(BigDecimal.class, new StrictDecimalDeserializer()))
            .configure(DeserializationFeature.ACCEPT_FLOAT_AS_INT, false)
            .configure(MapperFeature.ALLOW_COERCION_OF_SCALARS, false)
            .build();

    @ParameterizedTest
    @ValueSource(strings = {"0.00", "5.00", "10.00", "99.99", "100.00", "-1.50", "1234567890.12"})
    void exactlyTwoDecimals_isAccepted(String amount) throws Exception {
        Body b = mapper.readValue("{\"rate\":\"" + amount + "\"}", Body.class);
        assertThat(b.rate).isEqualByComparingTo(amount).hasToString(amount);
    }

    @ParameterizedTest
    @ValueSource(strings = {"5", "1e2", "1E2", "5.0", "5.000", "10.555", ".50", "5.", "+5.00", " 5.00", "5.00 ", "", "ten", "1,000.00", "12345678901.00"})
    void anythingElseAsText_isRejected(String amount) {
        assertThatThrownBy(() -> mapper.readValue("{\"rate\":\"" + amount + "\"}", Body.class))
                .isInstanceOfSatisfying(InvalidFormatException.class, e -> {
                    assertThat(e.getTargetType()).isEqualTo(BigDecimal.class);
                    assertThat(e.getPath().get(0).getFieldName()).isEqualTo("rate");
                });
    }

    @ParameterizedTest
    @ValueSource(strings = {"5", "5.00", "1e2", "0"})
    void aJsonNumber_isRejected_becauseMoneyIsAString(String number) {
        assertThatThrownBy(() -> mapper.readValue("{\"rate\":" + number + "}", Body.class))
                .isInstanceOf(InvalidFormatException.class);
    }

    @Test
    void nullStaysNull() throws Exception {
        assertThat(mapper.readValue("{\"rate\":null}", Body.class).rate).isNull();
    }

    @Test
    void anIntegerFieldMustBeAnInteger_7point5IsNotCutTo7() throws Exception {
        assertThat(parseMinutes("7")).isEqualTo(7);
        assertThatThrownBy(() -> parseMinutes("7.5")).isInstanceOf(MismatchedInputException.class);
        assertThatThrownBy(() -> parseMinutes("7.0")).isInstanceOf(MismatchedInputException.class);
    }

    @Test
    void numbersAndBooleansSentAsText_areRejected() {
        assertThatThrownBy(() -> parseMinutes("\"7\"")).isInstanceOf(MismatchedInputException.class);
        assertThatThrownBy(() -> mapper.readValue("{\"flag\":\"true\"}", Body.class)).isInstanceOf(MismatchedInputException.class);
        assertThatThrownBy(() -> mapper.readValue("{\"flag\":1}", Body.class)).isInstanceOf(MismatchedInputException.class);
    }

    private Integer parseMinutes(String json) throws Exception {
        return mapper.readValue("{\"minutes\":" + json + "}", Body.class).minutes;
    }
}
