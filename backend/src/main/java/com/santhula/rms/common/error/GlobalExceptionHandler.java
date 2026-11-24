package com.santhula.rms.common.error;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.exc.ValueInstantiationException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.common.security.TokenClaims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Turns every error into application/problem+json (conventions.md, Errors). */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final ProblemWriter problems;
    private final List<BodyCrossCheck> crossChecks;

    public GlobalExceptionHandler(ProblemWriter problems, List<BodyCrossCheck> crossChecks) {
        this.problems = problems;
        this.crossChecks = crossChecks;
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> api(ApiException e, HttpServletRequest req) {
        ResponseEntity<Object> entity = problems.entity(e.getStatus(), e.getCode(), e.getTitle(), e.getMessage(),
                e.getFieldErrors(), req.getRequestURI());
        if (e.getHeaders().isEmpty()) {
            return entity;
        }
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.putAll(entity.getHeaders());
        e.getHeaders().forEach(headers::set);
        return new ResponseEntity<>(entity.getBody(), headers, entity.getStatusCode());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Object> bodyInvalid(MethodArgumentNotValidException e, HttpServletRequest req) {
        List<FieldViolation> violations = new ArrayList<>(e.getBindingResult().getFieldErrors().stream()
                .map(fe -> new FieldViolation(fe.getField(), FieldMessages.message(fe.getField(), fe.getCode(), fe.getDefaultMessage())))
                .toList());
        // Rules spanning body and headers live in the service, which this body never reaches: run them here too,
        // so every field error is reported at once (BUG-1-009).
        Object body = e.getBindingResult().getTarget();
        if (body != null) {
            for (BodyCrossCheck check : crossChecks) {
                if (check.supports(body)) {
                    check.check(body, req).stream()
                            .filter(v -> violations.stream().noneMatch(existing -> existing.field().equals(v.field())))
                            .forEach(violations::add);
                }
            }
        }
        return validationFailed(violations, req);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<Object> paramsInvalid(HandlerMethodValidationException e, HttpServletRequest req) {
        List<FieldViolation> violations = new ArrayList<>();
        e.getParameterValidationResults().forEach(r -> {
            String name = r.getMethodParameter().getParameterName();
            r.getResolvableErrors().forEach(err -> violations.add(new FieldViolation(
                    name, FieldMessages.message(name, err.getCodes() == null ? null : lastCode(err.getCodes()), err.getDefaultMessage()))));
        });
        return validationFailed(violations, req);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<Object> constraintInvalid(ConstraintViolationException e, HttpServletRequest req) {
        List<FieldViolation> violations = e.getConstraintViolations().stream()
                .map(v -> {
                    String path = v.getPropertyPath().toString();
                    String field = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1) : path;
                    return new FieldViolation(field, FieldMessages.message(field, null, v.getMessage()));
                })
                .toList();
        return validationFailed(violations, req);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Object> unreadable(HttpMessageNotReadableException e, HttpServletRequest req) {
        // A wrong value in an otherwise valid JSON body (bad enum, bad UUID, text for a number) is a
        // field error the cashier can fix; broken JSON is a malformed request.
        if (e.getCause() instanceof InvalidFormatException ife && !ife.getPath().isEmpty()) {
            String field = jsonPath(ife);
            String message = ife.getTargetType() == java.math.BigDecimal.class
                    ? "Enter an amount with exactly 2 decimals, like 10.00"
                    : "This value is not valid";
            return validationFailed(List.of(new FieldViolation(field, message)), req);
        }
        if (e.getCause() instanceof MismatchedInputException mie && !mie.getPath().isEmpty()) {
            String field = jsonPath(mie);
            return validationFailed(List.of(new FieldViolation(field, "This value has the wrong type")), req);
        }
        // The generated enums reject an unknown value in fromValue(); Jackson wraps that in a
        // ValueInstantiationException (not an InvalidFormatException), e.g. a made-up role permission.
        if (e.getCause() instanceof ValueInstantiationException vie && !vie.getPath().isEmpty()) {
            String field = jsonPath(vie);
            return validationFailed(List.of(new FieldViolation(field, "Choose one of the allowed values")), req);
        }
        return malformed("The request could not be read.", req);
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<Object> tooLarge(org.springframework.web.multipart.MaxUploadSizeExceededException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_FILE_INVALID", "This file cannot be read",
                "The file is larger than 5 MB.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
    ResponseEntity<Object> missingPart(org.springframework.web.multipart.support.MissingServletRequestPartException e, HttpServletRequest req) {
        return validationFailed(List.of(new FieldViolation(e.getRequestPartName(), "Choose a file to upload")), req);
    }

    @ExceptionHandler(org.springframework.web.multipart.MultipartException.class)
    ResponseEntity<Object> notMultipart(org.springframework.web.multipart.MultipartException e, HttpServletRequest req) {
        return malformed("Send the file as multipart/form-data.", req);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Object> typeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest req) {
        return malformed("'" + e.getName() + "' has an invalid value.", req);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<Object> missingParam(MissingServletRequestParameterException e, HttpServletRequest req) {
        return malformed("'" + e.getParameterName() + "' is required.", req);
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<Object> missingHeader(MissingRequestHeaderException e, HttpServletRequest req) {
        if (TokenClaims.TERMINAL_HEADER.equalsIgnoreCase(e.getHeaderName())) {
            return problems.entity(HttpStatus.FORBIDDEN, "TERMINAL_NOT_REGISTERED", "This device is not registered",
                    "This device is not registered as a terminal. Ask the owner to set it up.", List.of(), req.getRequestURI());
        }
        return malformed("Header '" + e.getHeaderName() + "' is required.", req);
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    ResponseEntity<Object> optimisticLock(ObjectOptimisticLockingFailureException e, HttpServletRequest req) {
        return api(ApiException.versionConflict("record"), req);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Object> integrity(DataIntegrityViolationException e, HttpServletRequest req) {
        log.warn("Data integrity violation: {}", e.getMostSpecificCause().getMessage());
        return problems.entity(HttpStatus.CONFLICT, "DUPLICATE", "Conflicting data",
                "This conflicts with an existing record. Reload and try again.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<Object> denied(AccessDeniedException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.FORBIDDEN, "FORBIDDEN", "Not allowed",
                "You do not have permission to do this.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<Object> unauthenticated(AuthenticationException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Please log in",
                "Your session has ended. Please log in again.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Object> noResource(NoResourceFoundException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found", "This address does not exist.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Object> method(HttpRequestMethodNotSupportedException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "Not supported",
                "This action is not supported here.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Object> mediaType(HttpMediaTypeNotSupportedException e, HttpServletRequest req) {
        return problems.entity(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Not supported",
                "Send the request as application/json.", List.of(), req.getRequestURI());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> unexpected(Exception e, HttpServletRequest req) {
        log.error("Unexpected error on {} {}", req.getMethod(), req.getRequestURI(), e);
        return problems.entity(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Something went wrong",
                "Something went wrong on the server. Try again; if it keeps happening, tell the manager.", List.of(), req.getRequestURI());
    }

    private ResponseEntity<Object> validationFailed(List<FieldViolation> violations, HttpServletRequest req) {
        ApiException e = ApiException.validation(violations);
        return problems.entity(e.getStatus(), e.getCode(), e.getTitle(), e.getMessage(), violations, req.getRequestURI());
    }

    private ResponseEntity<Object> malformed(String detail, HttpServletRequest req) {
        return problems.entity(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "Malformed request", detail, List.of(), req.getRequestURI());
    }

    private static String lastCode(String[] codes) {
        // Codes go from most to least specific; the last is the bare constraint name (e.g. "Size").
        return codes.length == 0 ? null : codes[codes.length - 1];
    }

    private static String jsonPath(JsonMappingException e) {
        StringBuilder sb = new StringBuilder();
        for (JsonMappingException.Reference ref : e.getPath()) {
            if (ref.getFieldName() != null) {
                if (!sb.isEmpty()) {
                    sb.append('.');
                }
                sb.append(ref.getFieldName());
            } else if (ref.getIndex() >= 0) {
                sb.append('[').append(ref.getIndex()).append(']');
            }
        }
        return sb.toString();
    }
}
