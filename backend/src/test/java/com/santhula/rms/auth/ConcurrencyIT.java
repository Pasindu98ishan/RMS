package com.santhula.rms.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.auth.service.PinApprovalService;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.support.IntegrationTestBase;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Regression tests for BUG-1-001 (valid logins must never fail on optimistic-lock collisions)
 * and BUG-1-002 (the lockout cannot be bypassed by parallel wrong attempts, security-critical).
 * The calls run in parallel threads through the real filter chain against a real Postgres.
 */
class ConcurrencyIT extends IntegrationTestBase {

    @Autowired
    PinApprovalService approvals;
    @Autowired
    TransactionTemplate tx;

    /** Runs all calls at the same moment and returns their results in order. */
    private <T> List<T> inParallel(List<Callable<T>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        try {
            CountDownLatch ready = new CountDownLatch(calls.size());
            CountDownLatch go = new CountDownLatch(1);
            List<Future<T>> futures = new ArrayList<>();
            for (Callable<T> call : calls) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return call.call();
                }));
            }
            ready.await();
            go.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> f : futures) {
                results.add(f.get());
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private int loginStatus(String username, String password, TerminalKey terminal) throws Exception {
        return loginRequest(username, password, terminal).andReturn().getResponse().getStatus();
    }

    // ------------------------------------------------------------------ BUG-1-001

    @Test
    void BUG_1_001_sameUser_sameTerminal_parallelValidLogins_allSucceed() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        for (int n : new int[] {2, 4, 8, 16}) {
            List<Callable<Integer>> calls = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                calls.add(() -> loginStatus(user, PASSWORD, pos));
            }
            assertThat(inParallel(calls)).as("%d parallel logins", n).containsOnly(200);
        }
    }

    @Test
    void BUG_1_001_differentUsers_oneTerminal_allSucceed() throws Exception {
        Session owner = asOwner();
        TerminalKey pos = registerTerminal("CASHIER_POS");
        List<String> users = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            users.add(createUser(owner, SystemRole.CASHIER, null));
        }
        List<Callable<Integer>> calls = new ArrayList<>();
        for (String u : users) {
            calls.add(() -> loginStatus(u, PASSWORD, pos));
        }
        assertThat(inParallel(calls)).containsOnly(200);
    }

    @Test
    void BUG_1_001_sameUser_threeTerminals_allSucceed() throws Exception {
        String user = createUser(asOwner(), SystemRole.CASHIER, null);
        List<TerminalKey> terminals = List.of(registerTerminal("CASHIER_POS"), registerTerminal("CASHIER_POS"), registerTerminal("CASHIER_POS"));
        List<Callable<Integer>> calls = new ArrayList<>();
        for (TerminalKey t : terminals) {
            calls.add(() -> loginStatus(user, PASSWORD, t));
        }
        assertThat(inParallel(calls)).containsOnly(200);
    }

    @Test
    void BUG_1_001_aLoginStillStampsLastLogin_withoutBumpingTheUserVersion() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        UUID id = userId(owner, user);
        int versionBefore = body(doGet(owner, "/users/" + id)).get("version").asInt();
        login(user, PASSWORD, registerTerminal("CASHIER_POS"));
        var after = body(doGet(owner, "/users/" + id));
        assertThat(after.get("lastLoginAt")).isNotNull();
        // Logging in is not an edit: an admin form loaded before the login still saves.
        assertThat(after.get("version").asInt()).isEqualTo(versionBefore);
        doPut(owner, "/users/" + id, Map.of("fullName", "Renamed Cashier", "version", versionBefore))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }

    // ------------------------------------------------------------------ BUG-1-002

    @Test
    void BUG_1_002_thirtyParallelWrongPasswords_lockTheAccount() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        UUID id = userId(owner, user);
        TerminalKey pos = registerTerminal("CASHIER_POS");

        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            calls.add(() -> loginStatus(user, "wrong-password", pos));
        }
        List<Integer> statuses = inParallel(calls);

        // Never a conflict or a server error; the account locked (some attempts saw the lock).
        assertThat(statuses).containsOnly(401, 423);
        assertThat(statuses).contains(423);
        // The correct password is now refused too.
        assertThat(loginStatus(user, PASSWORD, pos)).isEqualTo(423);
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.locked").value(true));
        // One lock, not one per racing request.
        doGet(owner, "/audit-log?action=ACCOUNT_LOCKED&entityType=USER&entityId=" + id).andExpect(jsonPath("$.totalItems").value(1));
        // The lock ends after 15 minutes as usual.
        clock.advance(Duration.ofMinutes(16));
        assertThat(loginStatus(user, PASSWORD, pos)).isEqualTo(200);
    }

    @Test
    void BUG_1_002_fiveParallelWrongPasswords_areAllCounted() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            calls.add(() -> loginStatus(user, "wrong-password", pos));
        }
        assertThat(inParallel(calls)).containsOnly(401, 423);
        // Exactly 5 counted: the account is locked now, not "4 counted and 1 lost".
        assertThat(loginStatus(user, PASSWORD, pos)).isEqualTo(423);
    }

    @Test
    void BUG_1_002_parallelWrongPins_lockThePin() throws Exception {
        Session owner = asOwner();
        String manager = createUser(owner, SystemRole.MANAGER, "4321");
        UUID id = userId(owner, manager);

        // 4 threads: each holds one connection for the outer transaction and needs a second one for the
        // REQUIRES_NEW failure recorder, so more than 4 would exhaust the pool of 10 and deadlock.
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            calls.add(() -> {
                try {
                    tx.execute(status -> {
                        status.setRollbackOnly();
                        return approvals.approve(manager, "0000", "BILL_VOID");
                    });
                    return 200;
                } catch (ApiException e) {
                    return e.getStatus().value();
                }
            });
        }
        List<Integer> statuses = inParallel(calls);

        assertThat(statuses).containsOnly(403, 423);
        assertThat(statuses).contains(423);
        doGet(owner, "/users/" + id).andExpect(jsonPath("$.pinLocked").value(true));
        // The correct PIN is refused while locked.
        Integer correctPinStatus = tx.execute(status -> {
            status.setRollbackOnly();
            try {
                approvals.approve(manager, "4321", "BILL_VOID");
                return 200;
            } catch (ApiException e) {
                return e.getStatus().value();
            }
        });
        assertThat(correctPinStatus).isEqualTo(423);
        doGet(owner, "/audit-log?action=PIN_LOCKED&entityType=USER&entityId=" + id).andExpect(jsonPath("$.totalItems").value(1));
    }

    @Test
    void QA_Q32_aCorrectLoginResetsTheCounter_butNeverAnActiveLock() throws Exception {
        Session owner = asOwner();
        String user = createUser(owner, SystemRole.CASHIER, null);
        TerminalKey pos = registerTerminal("CASHIER_POS");
        for (int i = 0; i < 4; i++) {
            assertThat(loginStatus(user, "wrong-password", pos)).isEqualTo(401);
        }
        assertThat(loginStatus(user, PASSWORD, pos)).isEqualTo(200);       // resets the 4
        for (int i = 0; i < 4; i++) {
            assertThat(loginStatus(user, "wrong-password", pos)).isEqualTo(401);
        }
        assertThat(loginStatus(user, "wrong-password", pos)).isEqualTo(423); // the 5th of the NEW series
    }
}
