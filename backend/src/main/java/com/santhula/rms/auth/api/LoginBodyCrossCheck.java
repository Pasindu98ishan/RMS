package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.model.LoginRequest;
import com.santhula.rms.auth.service.AuthService;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.common.error.BodyCrossCheck;
import com.santhula.rms.common.security.TokenClaims;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.stereotype.Component;

/** Login: deviceToken and the X-Terminal-Id header go together or not at all (ADR-008), reported with the other field errors. */
@Component
class LoginBodyCrossCheck implements BodyCrossCheck {

    @Override
    public boolean supports(Object body) {
        return body instanceof LoginRequest;
    }

    @Override
    public List<FieldViolation> check(Object body, HttpServletRequest request) {
        String header = request.getHeader(TokenClaims.TERMINAL_HEADER);
        boolean headerSent = header != null && !header.isBlank();
        boolean tokenSent = ((LoginRequest) body).getDeviceToken() != null;
        return headerSent == tokenSent ? List.of() : List.of(new FieldViolation("deviceToken", AuthService.DEVICE_TOKEN_PAIRING));
    }
}
