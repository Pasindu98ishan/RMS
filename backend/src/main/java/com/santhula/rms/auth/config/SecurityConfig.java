package com.santhula.rms.auth.config;

import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.config.WebConfig;
import com.santhula.rms.common.error.ProblemWriter;
import com.santhula.rms.common.security.TokenClaims;
import com.santhula.rms.common.web.TraceIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless bearer-token security. URL rules only separate public from authenticated calls;
 * the permission of each operation is checked with @PreAuthorize on the controller method
 * (matching the spec's x-permission, verified by PermissionContractTest).
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private static final String API = WebConfig.API_PREFIX;

    /** Operations with `security: []` in the spec. A stale bearer token sent to them is ignored. */
    static final RequestMatcher PUBLIC_API = new OrRequestMatcher(
            new AntPathRequestMatcher(API + "/auth/login", HttpMethod.POST.name()),
            new AntPathRequestMatcher(API + "/auth/refresh", HttpMethod.POST.name()),
            new AntPathRequestMatcher(API + "/terminals", HttpMethod.POST.name()),
            new AntPathRequestMatcher(API + "/terminals/setup-options", HttpMethod.POST.name()));

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ProblemWriter problems, RmsProperties properties) throws Exception {
        http
                .csrf(c -> c.disable())
                .cors(c -> c.configurationSource(corsConfigurationSource(properties)))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .logout(l -> l.disable())
                .authorizeHttpRequests(a -> a
                        .requestMatchers(PUBLIC_API).permitAll()
                        .requestMatchers("/actuator/health/**", "/actuator/health", "/actuator/info").permitAll()
                        .requestMatchers("/ws/**").permitAll() // STOMP authenticates on CONNECT
                        .requestMatchers("/error").permitAll()
                        // QA helpers exist only under the `test` profile; elsewhere these paths are 404.
                        .requestMatchers(API + "/test/**").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(o -> o
                        .bearerTokenResolver(bearerTokenResolver())
                        .jwt(j -> j.jwtAuthenticationConverter(jwtAuthenticationConverter()))
                        .authenticationEntryPoint(entryPoint(problems))
                        .accessDeniedHandler(accessDenied(problems)))
                .exceptionHandling(e -> e
                        .authenticationEntryPoint(entryPoint(problems))
                        .accessDeniedHandler(accessDenied(problems)))
                .addFilterAfter(new TerminalHeaderFilter(problems), BearerTokenAuthenticationFilter.class);
        return http.build();
    }

    static JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName(TokenClaims.PERMISSIONS);
        authorities.setAuthorityPrefix("");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }

    private static BearerTokenResolver bearerTokenResolver() {
        DefaultBearerTokenResolver delegate = new DefaultBearerTokenResolver();
        return (HttpServletRequest request) -> PUBLIC_API.matches(request) ? null : delegate.resolve(request);
    }

    private static AuthenticationEntryPoint entryPoint(ProblemWriter problems) {
        return (request, response, ex) -> {
            boolean expired = ex instanceof InvalidBearerTokenException && ex.getMessage() != null
                    && ex.getMessage().toLowerCase().contains("expired");
            response.setHeader("WWW-Authenticate", "Bearer");
            problems.write(request, response, HttpStatus.UNAUTHORIZED, expired ? "TOKEN_EXPIRED" : "UNAUTHENTICATED",
                    "Please log in", expired ? "Your session has expired. Please log in again." : "Please log in to continue.");
        };
    }

    private static AccessDeniedHandler accessDenied(ProblemWriter problems) {
        return (request, response, ex) -> problems.write(request, response, HttpStatus.FORBIDDEN, "FORBIDDEN",
                "Not allowed", "You do not have permission to do this.");
    }

    private static CorsConfigurationSource corsConfigurationSource(RmsProperties properties) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        List<String> origins = properties.corsAllowedOrigins();
        if (origins != null && !origins.isEmpty()) {
            CorsConfiguration cfg = new CorsConfiguration();
            cfg.setAllowedOrigins(origins);
            cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
            cfg.setAllowedHeaders(List.of("Authorization", "Content-Type", TokenClaims.TERMINAL_HEADER, "Idempotency-Key"));
            cfg.setExposedHeaders(List.of(TraceIdFilter.HEADER, "Content-Disposition"));
            cfg.setMaxAge(3600L);
            source.registerCorsConfiguration("/**", cfg);
        }
        return source;
    }
}
