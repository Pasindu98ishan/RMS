package com.santhula.rms.auth.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.santhula.rms.auth.service.AccessTokenService;
import com.santhula.rms.common.config.RmsProperties;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/** HS256 JWT signing key from RMS_JWT_SECRET (base64, >= 32 bytes) and the password hasher. */
@Configuration
public class JwtConfig {

    private static final Logger log = LoggerFactory.getLogger(JwtConfig.class);

    @Bean
    SecretKey jwtSigningKey(RmsProperties properties) {
        String secret = properties.security().jwtSecret();
        byte[] key;
        if (secret == null || secret.isBlank()) {
            key = new byte[32];
            new SecureRandom().nextBytes(key);
            log.warn("RMS_JWT_SECRET is not set: using a random signing key. Tokens stop working when the app restarts. "
                    + "Set RMS_JWT_SECRET (base64, at least 32 bytes) outside local development.");
        } else {
            key = Base64.getDecoder().decode(secret.trim());
            if (key.length < 32) {
                throw new IllegalStateException("RMS_JWT_SECRET must decode to at least 32 bytes");
            }
        }
        return new SecretKeySpec(key, "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey jwtSigningKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(jwtSigningKey));
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey jwtSigningKey, java.time.Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwtSigningKey).macAlgorithm(MacAlgorithm.HS256).build();
        // Expiry is checked against the app clock (movable under the test profile), 30 s skew.
        org.springframework.security.oauth2.jwt.JwtTimestampValidator timestamps =
                new org.springframework.security.oauth2.jwt.JwtTimestampValidator(java.time.Duration.ofSeconds(30));
        timestamps.setClock(clock);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                timestamps, new org.springframework.security.oauth2.jwt.JwtIssuerValidator(AccessTokenService.ISSUER)));
        return decoder;
    }

    @Bean
    PasswordEncoder passwordEncoder(RmsProperties properties) {
        return new BCryptPasswordEncoder(properties.security().bcryptStrength());
    }
}
