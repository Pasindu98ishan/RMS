package com.santhula.rms.common.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.santhula.rms.common.web.TraceIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/** Builds RFC 7807 bodies: type, title, status, detail, instance, code, fieldErrors, traceId. */
@Component
public class ProblemWriter {

    public static final MediaType PROBLEM_JSON = MediaType.APPLICATION_PROBLEM_JSON;
    private static final String TYPE_BASE = "https://rms/errors/";

    private final ObjectMapper objectMapper;

    public ProblemWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> body(HttpStatus status, String code, String title, String detail,
                                    List<ApiException.FieldViolation> fieldErrors, String instance) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", TYPE_BASE + code.toLowerCase(Locale.ROOT).replace('_', '-'));
        body.put("title", title);
        body.put("status", status.value());
        if (detail != null) {
            body.put("detail", detail);
        }
        if (instance != null) {
            body.put("instance", instance);
        }
        body.put("code", code);
        if (fieldErrors != null && !fieldErrors.isEmpty()) {
            body.put("fieldErrors", fieldErrors.stream()
                    .map(f -> Map.of("field", f.field(), "message", f.message()))
                    .toList());
        }
        String traceId = MDC.get(TraceIdFilter.MDC_KEY);
        if (traceId != null) {
            body.put("traceId", traceId);
        }
        return body;
    }

    public ResponseEntity<Object> entity(HttpStatus status, String code, String title, String detail,
                                         List<ApiException.FieldViolation> fieldErrors, String instance) {
        return ResponseEntity.status(status)
                .contentType(PROBLEM_JSON)
                .body(body(status, code, title, detail, fieldErrors, instance));
    }

    /** For filters and security handlers, which run outside Spring MVC. */
    public void write(HttpServletRequest request, HttpServletResponse response, HttpStatus status,
                      String code, String title, String detail) throws IOException {
        response.setStatus(status.value());
        response.setHeader(HttpHeaders.CONTENT_TYPE, PROBLEM_JSON.toString());
        objectMapper.writeValue(response.getOutputStream(),
                body(status, code, title, detail, List.of(), request.getRequestURI()));
    }
}
