package com.santhula.rms.common.config;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.module.SimpleModule;
import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Money and rates travel as JSON strings ("1100.00") and are BigDecimal in Java (ADR-005).
 * Null fields are omitted (spring.jackson.default-property-inclusion=non_null, ADR-006).
 */
@Configuration
public class JacksonConfig {

    @Bean
    Jackson2ObjectMapperBuilderCustomizer bigDecimalAsString() {
        return builder -> builder
                .deserializerByType(BigDecimal.class, new StrictDecimalDeserializer())
                .postConfigurer(mapper -> {
                    mapper.configOverride(BigDecimal.class).setFormat(JsonFormat.Value.forShape(JsonFormat.Shape.STRING));
                    // Contract arrays marked uniqueItems become Java Sets; keep the order the client sent
                    // (e.g. the display order of the modifier groups attached to an item).
                    mapper.registerModule(new SimpleModule().addAbstractTypeMapping(Set.class, LinkedHashSet.class));
                });
    }
}
