package com.santhula.rms.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.AuthAttemptsRepository;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.testsupport.MutableClock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** PinApprovalService rules (P1-AUTH-05, QA Q10). The 3-strikes counter itself is PinFailureRecorder. */
class PinApprovalServiceTest {

    private static final UUID BRANCH = UUID.randomUUID();
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final AppUserRepository users = mock(AppUserRepository.class);
    private final PermissionResolver permissions = mock(PermissionResolver.class);
    private final PinFailureRecorder failures = mock(PinFailureRecorder.class);
    private final AuthAttemptsRepository attempts = mock(AuthAttemptsRepository.class);
    private final MutableClock clock = new MutableClock();
    private PinApprovalService service;
    private AppUser manager;

    @BeforeEach
    void setUp() {
        RmsProperties props = new RmsProperties(BRANCH, ZoneId.of("Asia/Colombo"),
                new RmsProperties.Security("", Duration.ofMinutes(15), Duration.ofHours(12), 4, 5, Duration.ofMinutes(15), 3,
                        Duration.ofMinutes(5)), null, null, null, null);
        service = new PinApprovalService(users, encoder, permissions, failures, attempts, props, clock);
        manager = new AppUser(BRANCH, "manager1", encoder.encode("password1"), "Kamal Silva", null);
        manager.changePinHash(encoder.encode("4321"));
        when(users.findByUsernameIgnoreCase("manager1")).thenReturn(Optional.of(manager));
        when(permissions.hasPermission(manager, "BILL_VOID")).thenReturn(true);
    }

    @Test
    void correctPin_ofAnApproverWithThePermission_isAccepted() {
        PinApprovalService.Approver approver = service.approve("manager1", "4321", "BILL_VOID");
        assertThat(approver.id()).isEqualTo(manager.getId());
        assertThat(approver.username()).isEqualTo("manager1");
        verify(failures, never()).recordFailure(any(), anyString());
    }

    @Test
    void missingApproval_isApprovalRequired() {
        assertCode(() -> service.approve(null, null, "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_REQUIRED");
        assertCode(() -> service.approve("manager1", "", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_REQUIRED");
    }

    @Test
    void wrongPin_isCounted_andRefused() {
        assertCode(() -> service.approve("manager1", "0000", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        verify(failures).recordFailure(manager.getId(), "BILL_VOID");
    }

    @Test
    void P1_AUTH_05_theFailureThatLocksThePin_answers423() {
        when(failures.recordFailure(manager.getId(), "BILL_VOID")).thenReturn(Instant.now().plus(Duration.ofMinutes(5)));
        assertCode(() -> service.approve("manager1", "0000", "BILL_VOID"), HttpStatus.LOCKED, "PIN_LOCKED");
    }

    @Test
    void lockedPin_isRefusedEvenWhenCorrect_untilTheLockEnds() {
        manager.recordPinFailure(0, Instant.now(clock).plus(Duration.ofMinutes(5)));
        assertCode(() -> service.approve("manager1", "4321", "BILL_VOID"), HttpStatus.LOCKED, "PIN_LOCKED");
        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(service.approve("manager1", "4321", "BILL_VOID").id()).isEqualTo(manager.getId());
    }

    @Test
    void approverWithoutThePermission_isRefused_evenWithTheRightPin() {
        when(permissions.hasPermission(manager, "DISCOUNT_OWNER")).thenReturn(false);
        assertCode(() -> service.approve("manager1", "4321", "DISCOUNT_OWNER"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        verify(failures, never()).recordFailure(any(), anyString());
    }

    @Test
    void unknownOrInactiveApprover_isRefused() {
        assertCode(() -> service.approve("ghost", "4321", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        manager.setActive(false);
        assertCode(() -> service.approve("manager1", "4321", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
    }

    @Test
    void approverWithoutAPin_isRefused() {
        AppUser noPin = new AppUser(BRANCH, "manager2", encoder.encode("password1"), "No Pin", null);
        when(users.findByUsernameIgnoreCase("manager2")).thenReturn(Optional.of(noPin));
        assertCode(() -> service.approve("manager2", "4321", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
    }

    @Test
    void successClearsEarlierWrongPins_withAnAtomicUpdate_notAnEntityWrite() {
        service.approve("manager1", "4321", "BILL_VOID");
        verify(attempts).clearPinFailures(eq(manager.getId()), any());
        verify(users, never()).save(any());
    }

    private static void assertCode(Runnable call, HttpStatus status, String code) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getStatus()).isEqualTo(status);
            assertThat(e.getCode()).isEqualTo(code);
        });
    }
}
