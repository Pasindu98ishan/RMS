package com.santhula.rms.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.auth.service.PinApprovalService;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.support.IntegrationTestBase;
import java.time.Duration;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PinApprovalService against the real database (P1-AUTH-05, QA Q10): 3 wrong PINs lock the PIN
 * for 5 minutes, and the count survives the rollback of the action that asked for approval.
 * End-to-end approval tests come with the first operation that takes an `approval` (M1.2+).
 */
class PinApprovalServiceIT extends IntegrationTestBase {

    @Autowired
    PinApprovalService approvals;
    @Autowired
    TransactionTemplate tx;

    /** Runs the approval inside a transaction that is always rolled back, like a refused void. */
    private PinApprovalService.Approver approveAndRollBack(String username, String pin, String permission) {
        return tx.execute(status -> {
            status.setRollbackOnly();
            return approvals.approve(username, pin, permission);
        });
    }

    private void assertCode(Runnable call, HttpStatus status, String code) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getStatus()).isEqualTo(status);
            assertThat(e.getCode()).isEqualTo(code);
        });
    }

    @Test
    void P1_AUTH_05_managerPin_approvesAVoid() throws Exception {
        String manager = createUser(asOwner(), SystemRole.MANAGER, "4321");
        PinApprovalService.Approver approver = approveAndRollBack(manager, "4321", "BILL_VOID");
        assertThat(approver.username()).isEqualTo(manager);
    }

    @Test
    void P1_AUTH_05_threeWrongPins_lockFor5Minutes_evenThoughEachActionRolledBack() throws Exception {
        Session owner = asOwner();
        String manager = createUser(owner, SystemRole.MANAGER, "4321");
        UUID id = userId(owner, manager);

        assertCode(() -> approveAndRollBack(manager, "0000", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        assertCode(() -> approveAndRollBack(manager, "1111", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        assertCode(() -> approveAndRollBack(manager, "2222", "BILL_VOID"), HttpStatus.LOCKED, "PIN_LOCKED");
        assertCode(() -> approveAndRollBack(manager, "4321", "BILL_VOID"), HttpStatus.LOCKED, "PIN_LOCKED");

        doGet(owner, "/users/" + id).andExpect(jsonPath("$.pinLocked").value(true)).andExpect(jsonPath("$.pinLockedUntil").exists());
        doGet(owner, "/audit-log?entityType=USER&entityId=" + id)
                .andExpect(jsonPath("$.items[*].action", Matchers.hasItems("PIN_FAILED", "PIN_LOCKED")))
                .andExpect(jsonPath("$.items[?(@.action=='PIN_LOCKED')].approver.username").value(Matchers.contains(manager)));

        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(approveAndRollBack(manager, "4321", "BILL_VOID").username()).isEqualTo(manager);
    }

    @Test
    void ownerCanUnlockALockedPin() throws Exception {
        Session owner = asOwner();
        String manager = createUser(owner, SystemRole.MANAGER, "4321");
        for (String wrong : new String[] {"0000", "1111", "2222"}) {
            assertThatThrownBy(() -> approveAndRollBack(manager, wrong, "REFUND")).isInstanceOf(ApiException.class);
        }
        doPost(owner, "/users/" + userId(owner, manager) + "/unlock", null);
        assertThat(approveAndRollBack(manager, "4321", "REFUND").username()).isEqualTo(manager);
    }

    @Test
    void aCashierPin_neverApproves() throws Exception {
        String cashier = createUser(asOwner(), SystemRole.CASHIER, "5555");
        assertCode(() -> approveAndRollBack(cashier, "5555", "BILL_VOID"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        assertCode(() -> approveAndRollBack(cashier, "5555", "LINE_CANCEL_AFTER_KOT"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
    }

    @Test
    void managerCannotApproveOwnerOnlyDiscounts_ownerCan() throws Exception {
        String manager = createUser(asOwner(), SystemRole.MANAGER, "4321");
        assertCode(() -> approveAndRollBack(manager, "4321", "DISCOUNT_OWNER"), HttpStatus.FORBIDDEN, "APPROVAL_INVALID");
        assertThat(approveAndRollBack(OWNER, OWNER_PIN, "DISCOUNT_OWNER").username()).isEqualTo(OWNER);
    }

    @Test
    void approvalOutsideATransaction_isAProgrammingError() {
        assertThatThrownBy(() -> approvals.approve(OWNER, OWNER_PIN, "BILL_VOID"))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }
}
