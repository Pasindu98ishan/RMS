package com.santhula.rms.common.error;

import java.util.List;
import org.springframework.http.HttpStatus;

/**
 * A business error that becomes an RFC 7807 problem. `detail` is shown to the cashier as-is, so
 * write it in plain English.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final String title;
    private final List<FieldViolation> fieldErrors;
    private final java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();

    public ApiException(HttpStatus status, String code, String title, String detail, List<FieldViolation> fieldErrors) {
        super(detail);
        this.status = status;
        this.code = code;
        this.title = title;
        this.fieldErrors = fieldErrors == null ? List.of() : List.copyOf(fieldErrors);
    }

    public ApiException(HttpStatus status, String code, String title, String detail) {
        this(status, code, title, detail, List.of());
    }

    public static ApiException notFound(String what) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found", what + " does not exist.");
    }

    public static ApiException conflict(String code, String title, String detail) {
        return new ApiException(HttpStatus.CONFLICT, code, title, detail);
    }

    public static ApiException versionConflict(String what) {
        return conflict("VERSION_CONFLICT", "Someone else changed this record",
                "This " + what + " was changed by someone else. Reload and try again.");
    }

    public static ApiException forbidden(String code, String title, String detail) {
        return new ApiException(HttpStatus.FORBIDDEN, code, title, detail);
    }

    public static ApiException unauthorized(String code, String title, String detail) {
        return new ApiException(HttpStatus.UNAUTHORIZED, code, title, detail);
    }

    public static ApiException locked(String code, String title, String detail) {
        return new ApiException(HttpStatus.LOCKED, code, title, detail);
    }

    public static ApiException validation(String field, String message) {
        return validation(List.of(new FieldViolation(field, message)));
    }

    public static ApiException validation(List<FieldViolation> violations) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED",
                "Please check the highlighted fields", "Some fields are missing or invalid.", violations);
    }

    /** Adds a response header (e.g. Retry-After). */
    public ApiException withHeader(String name, String value) {
        headers.put(name, value);
        return this;
    }

    public java.util.Map<String, String> getHeaders() {
        return java.util.Map.copyOf(headers);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public String getTitle() {
        return title;
    }

    public List<FieldViolation> getFieldErrors() {
        return fieldErrors;
    }

    public record FieldViolation(String field, String message) {
    }
}
