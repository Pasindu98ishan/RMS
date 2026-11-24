package com.santhula.rms.support;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.hamcrest.Matchers;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultMatcher;

/** Assertions for RFC 7807 responses. */
public final class ProblemMatchers {

    private ProblemMatchers() {
    }

    public static ResultMatcher problem(int status, String code) {
        return ResultMatcher.matchAll(
                status().is(status),
                content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON),
                jsonPath("$.status").value(status),
                jsonPath("$.code").value(code),
                jsonPath("$.title").isNotEmpty(),
                jsonPath("$.traceId").isNotEmpty());
    }

    public static ResultMatcher forbidden() {
        return problem(403, "FORBIDDEN");
    }

    /** 422 VALIDATION_FAILED with a field error on {@code field}. */
    public static ResultMatcher fieldError(String field) {
        return ResultMatcher.matchAll(
                problem(422, "VALIDATION_FAILED"),
                jsonPath("$.fieldErrors[*].field", Matchers.hasItem(field)));
    }

    public static ResultMatcher malformed() {
        return problem(400, "MALFORMED_REQUEST");
    }
}
