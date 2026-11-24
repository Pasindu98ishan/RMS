package com.santhula.rms.auth.api;

import com.santhula.rms.api.generated.api.UsersApi;
import com.santhula.rms.api.generated.model.AssignUserRolesRequest;
import com.santhula.rms.api.generated.model.CreateUserRequest;
import com.santhula.rms.api.generated.model.ResetUserPasswordRequest;
import com.santhula.rms.api.generated.model.ResetUserPinRequest;
import com.santhula.rms.api.generated.model.UpdateUserRequest;
import com.santhula.rms.api.generated.model.User;
import com.santhula.rms.api.generated.model.UserOption;
import com.santhula.rms.api.generated.model.UserPage;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.service.UserService;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UsersController implements UsersApi {

    private final UserService users;
    private final AuthMapper mapper;

    public UsersController(UserService users, AuthMapper mapper) {
        this.users = users;
        this.mapper = mapper;
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<UserPage> listUsers(Integer page, Integer size, String sort, Boolean active, UUID roleId, String search) {
        Page<AppUser> result = users.list(new UserService.UserFilter(active, roleId, search),
                page == null ? 0 : page, size == null ? 50 : size, sort);
        return ResponseEntity.ok(new UserPage(result.getNumber(), result.getSize(), result.getTotalElements(),
                result.getContent().stream().map(mapper::userSummary).toList()));
    }

    /** Narrow lookup for the audit log user filter: AUDIT_VIEW, not USER_MANAGE. */
    @Override
    @PreAuthorize("hasAuthority('AUDIT_VIEW')")
    public ResponseEntity<java.util.List<UserOption>> listUserOptions() {
        return ResponseEntity.ok(users.options().stream().map(mapper::userOption).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> createUser(CreateUserRequest req) {
        AppUser user = users.create(new UserService.NewUser(req.getUsername(), req.getFullName(), req.getPhone(),
                req.getPassword(), req.getPin(), req.getRoleIds()));
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.user(user));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> getUser(UUID userId) {
        return ResponseEntity.ok(mapper.user(users.get(userId)));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> updateUser(UUID userId, UpdateUserRequest req) {
        return ResponseEntity.ok(mapper.user(users.update(userId, req.getFullName(), req.getPhone(), req.getVersion())));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> deactivateUser(UUID userId) {
        return ResponseEntity.ok(mapper.user(users.deactivate(userId)));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> activateUser(UUID userId) {
        return ResponseEntity.ok(mapper.user(users.activate(userId)));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> unlockUser(UUID userId) {
        return ResponseEntity.ok(mapper.user(users.unlock(userId)));
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<Void> resetUserPassword(UUID userId, ResetUserPasswordRequest req) {
        users.resetPassword(userId, req.getNewPassword());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<Void> resetUserPin(UUID userId, ResetUserPinRequest req) {
        users.resetPin(userId, req.getNewPin());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PreAuthorize("hasAuthority('USER_MANAGE')")
    public ResponseEntity<User> assignUserRoles(UUID userId, AssignUserRolesRequest req) {
        return ResponseEntity.ok(mapper.user(users.assignRoles(userId, req.getRoleIds(), req.getVersion())));
    }
}
