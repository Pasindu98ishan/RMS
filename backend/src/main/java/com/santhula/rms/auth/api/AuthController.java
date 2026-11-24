package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.api.AuthApi;
import com.santhula.rms.api.generated.model.AuthSession;
import com.santhula.rms.api.generated.model.ChangeOwnPasswordRequest;
import com.santhula.rms.api.generated.model.CurrentUserProfile;
import com.santhula.rms.api.generated.model.LoginRequest;
import com.santhula.rms.api.generated.model.LogoutRequest;
import com.santhula.rms.api.generated.model.RefreshTokenRequest;
import com.santhula.rms.api.generated.model.SetOwnPinRequest;
import com.santhula.rms.auth.service.AuthService;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController implements AuthApi {

    private final AuthService auth;
    private final AuthMapper mapper;

    public AuthController(AuthService auth, AuthMapper mapper) {
        this.auth = auth;
        this.mapper = mapper;
    }

    @Override
    @PreAuthorize("permitAll()")
    public ResponseEntity<AuthSession> login(LoginRequest req, UUID xTerminalId) {
        return ResponseEntity.ok(mapper.session(auth.login(xTerminalId, req.getUsername(), req.getPassword(), req.getDeviceToken())));
    }

    @Override
    @PreAuthorize("permitAll()")
    public ResponseEntity<AuthSession> refreshToken(RefreshTokenRequest req, UUID xTerminalId) {
        return ResponseEntity.ok(mapper.session(auth.refresh(xTerminalId, req.getRefreshToken())));
    }

    @Override
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> logout(LogoutRequest req) {
        auth.logout(req.getRefreshToken(), req.getReason() == null ? null : req.getReason().getValue());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<CurrentUserProfile> getCurrentUser() {
        List<String> perms = SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .toList();
        return ResponseEntity.ok(mapper.profile(auth.currentProfile(perms)));
    }

    @Override
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> changeOwnPassword(ChangeOwnPasswordRequest req) {
        auth.changeOwnPassword(req.getCurrentPassword(), req.getNewPassword());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> setOwnPin(SetOwnPinRequest req) {
        auth.setOwnPin(req.getCurrentPassword(), req.getNewPin());
        return ResponseEntity.noContent().build();
    }
}
