package com.santhula.rms.auth.repo;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Wrong-password and wrong-PIN counters, updated with single atomic SQL statements (BUG-1-001,
 * BUG-1-002). Reading the counter into an entity, adding one and saving it loses increments under
 * concurrency (parallel guesses all read the same value) and, with optimistic locking, fails the
 * requests with VERSION_CONFLICT. One UPDATE ... RETURNING lets Postgres serialise the attempts on
 * the row, so N parallel wrong passwords always count N. These statements deliberately do not
 * touch the row's `version`: a login attempt is not an edit.
 *
 * <p>Rule (the same as {@code LockoutPolicy}): the Nth wrong attempt in a row locks for the lock
 * duration and restarts the counter at 0; attempts while a lock is active do not change anything
 * (they don't extend it); an expired lock starts a fresh count.
 */
@Repository
public class AuthAttemptsRepository {

    /** Counter and lock after the update. {@code justLocked}: this very attempt created the lock. */
    public record Result(int attempts, Instant lockedUntil, boolean justLocked) {
        public boolean isLocked(Instant now) {
            return lockedUntil != null && lockedUntil.isAfter(now);
        }
    }

    /**
     * The row is locked first (FOR UPDATE in the CTE), so the old lock state read here is the state this
     * very statement acts on. {@code was_locked} tells whether a lock was already active; the attempt that
     * created the lock is the one where it was not active before and is set afterwards. Comparing lock
     * timestamps instead is not safe: two attempts that read the clock in the same microsecond compute the
     * same lock time.
     */
    private static final String FAILURE_SQL = """
            WITH o AS (SELECT id, {locked} AS old_locked FROM app_user WHERE id = :id FOR UPDATE)
            UPDATE app_user u SET
              {attempts} = CASE
                WHEN u.{locked} IS NOT NULL AND u.{locked} > :now THEN u.{attempts}
                WHEN (CASE WHEN u.{locked} IS NOT NULL THEN 0 ELSE u.{attempts} END) + 1 >= :max THEN 0
                ELSE (CASE WHEN u.{locked} IS NOT NULL THEN 0 ELSE u.{attempts} END) + 1 END,
              {locked} = CASE
                WHEN u.{locked} IS NOT NULL AND u.{locked} > :now THEN u.{locked}
                WHEN (CASE WHEN u.{locked} IS NOT NULL THEN 0 ELSE u.{attempts} END) + 1 >= :max THEN :lockUntil
                ELSE NULL END
            FROM o WHERE u.id = o.id
            RETURNING u.{attempts} AS attempts, u.{locked} AS locked_until,
                      (o.old_locked IS NOT NULL AND o.old_locked > :now) AS was_locked""";

    private static final String CLEAR_SQL = """
            UPDATE app_user SET {attempts} = 0, {locked} = NULL
            WHERE id = :id AND ({attempts} <> 0 OR {locked} IS NOT NULL)
              AND ({locked} IS NULL OR {locked} <= :now)""";

    private final NamedParameterJdbcTemplate jdbc;

    public AuthAttemptsRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Result registerPasswordFailure(UUID userId, Instant now, int maxAttempts, Duration lockDuration) {
        return registerFailure("failed_attempts", "locked_until", userId, now, maxAttempts, lockDuration);
    }

    public Result registerPinFailure(UUID userId, Instant now, int maxAttempts, Duration lockDuration) {
        return registerFailure("pin_failed_attempts", "pin_locked_until", userId, now, maxAttempts, lockDuration);
    }

    /** After a correct password: resets the counter, but never removes an active lock. */
    public void clearPasswordFailures(UUID userId, Instant now) {
        clear("failed_attempts", "locked_until", userId, now);
    }

    public void clearPinFailures(UUID userId, Instant now) {
        clear("pin_failed_attempts", "pin_locked_until", userId, now);
    }

    private Result registerFailure(String attemptsCol, String lockedCol, UUID userId, Instant now, int max, Duration lock) {
        // Postgres stores microseconds.
        Instant lockUntil = now.plus(lock).truncatedTo(ChronoUnit.MICROS);
        String sql = FAILURE_SQL.replace("{attempts}", attemptsCol).replace("{locked}", lockedCol);
        var params = new MapSqlParameterSource()
                .addValue("id", userId)
                .addValue("now", utc(now))
                .addValue("max", max)
                .addValue("lockUntil", utc(lockUntil));
        return jdbc.queryForObject(sql, params, (rs, i) -> {
            OffsetDateTime locked = rs.getObject("locked_until", OffsetDateTime.class);
            Instant lockedUntil = locked == null ? null : locked.toInstant();
            boolean wasLocked = rs.getBoolean("was_locked");
            return new Result(rs.getInt("attempts"), lockedUntil, !wasLocked && lockedUntil != null && lockedUntil.isAfter(now));
        });
    }

    private void clear(String attemptsCol, String lockedCol, UUID userId, Instant now) {
        String sql = CLEAR_SQL.replace("{attempts}", attemptsCol).replace("{locked}", lockedCol);
        jdbc.update(sql, new MapSqlParameterSource().addValue("id", userId).addValue("now", utc(now)));
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
