package com.santhula.rms.common.error;

import com.santhula.rms.common.error.ApiException.FieldViolation;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;

/**
 * A rule that spans a request body and its headers (for example "deviceToken together with X-Terminal-Id").
 * Such rules normally run in the service, which a body with Bean Validation errors never reaches; the
 * exception handler also runs every matching check then, so the 422 lists all field errors at once (BUG-1-009).
 * The service keeps its own check for bodies that are otherwise valid.
 */
public interface BodyCrossCheck {

    /** True when this check applies to the body (usually an instanceof test on the generated DTO). */
    boolean supports(Object body);

    List<FieldViolation> check(Object body, HttpServletRequest request);
}
