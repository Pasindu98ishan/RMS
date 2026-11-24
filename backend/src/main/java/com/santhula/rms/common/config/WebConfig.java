package com.santhula.rms.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerTypePredicate;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Every RMS REST controller is served under /api/v1 (the spec's server URL). */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    public static final String API_PREFIX = "/api/v1";

    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        configurer.addPathPrefix(API_PREFIX,
                HandlerTypePredicate.forAnnotation(RestController.class).and(HandlerTypePredicate.forBasePackage("com.santhula.rms")));
    }
}
