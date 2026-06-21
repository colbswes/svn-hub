package com.svnhub;

import java.security.SecureRandom;
import org.kissweb.database.Connection;
import org.kissweb.database.Record;
import org.kissweb.restServer.MainServlet;

/**
 * Short-lived, single-use 6-digit verification codes used by email verification
 * and password reset.
 *
 * <p>Codes are generated with {@link SecureRandom} (un-guessable) and stored
 * zero-padded as a 6-character string, because a code may legitimately begin
 * with {@code 0}.  There is at most one active code per {@code (user, purpose)};
 * issuing a new code replaces any prior one.  Codes expire, are attempt-limited,
 * and are consumed (deleted) on a successful match.</p>
 *
 * <p>Backed by the {@code verification_code} table (added in schema v4).</p>
 */
public final class VerificationCodes {

    /** Purpose: confirm a newly registered email address. */
    public static final String PURPOSE_EMAIL = "email_verify";
    /** Purpose: authorize a forgotten-password reset. */
    public static final String PURPOSE_RESET = "password_reset";

    /** Default code lifetime, in minutes (email verification). */
    public static final int DEFAULT_TTL_MINUTES = 15;
    /** Password-reset code lifetime, in minutes — the temporary-login window. */
    public static final int RESET_TTL_MINUTES = 30;
    /** Maximum wrong guesses before a code is invalidated. */
    public static final int MAX_ATTEMPTS = 5;

    private static final SecureRandom RANDOM = new SecureRandom();

    private VerificationCodes() {
    }

    /** Generate a uniformly-random 6-digit code (000000–999999) as a zero-padded string. */
    public static String generate() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    /**
     * Issue a fresh code for {@code (userId, purpose)}, replacing any existing
     * one, and return it so the caller can email it.
     *
     * @param ttlMinutes how long the code remains valid
     * @return the freshly generated code
     */
    public static String issue(Connection db, int userId, String purpose, int ttlMinutes) throws Exception {
        String code = generate();
        long now = System.currentTimeMillis();
        long expires = now + (long) ttlMinutes * 60_000L;
        db.execute("delete from verification_code where user_id = ? and purpose = ?", userId, purpose);
        Record rec = db.newRecord("verification_code");
        rec.set("user_id", userId);
        rec.set("purpose", purpose);
        rec.set("code", code);
        rec.set("expires_ts", expires);
        rec.set("attempts", 0);
        rec.set("created_ts", now);
        rec.addRecord();
        return code;
    }

    /**
     * Age, in milliseconds, of the active {@code (userId, purpose)} code, or
     * {@code -1} if none exists.  Used to throttle resend requests.
     */
    public static long ageMillis(Connection db, int userId, String purpose) throws Exception {
        Record rec = db.fetchOne("select created_ts from verification_code where user_id = ? and purpose = ?",
                userId, purpose);
        if (rec == null)
            return -1L;
        return System.currentTimeMillis() - rec.getLong("created_ts");
    }

    /**
     * Verify a candidate code for {@code (userId, purpose)} and <b>consume</b> it
     * on success (single-use — used by email verification).  Returns true only on
     * an exact, unexpired, within-attempt-limit match.  A wrong code increments
     * the attempt counter.
     */
    public static boolean verify(Connection db, int userId, String purpose, String candidate) throws Exception {
        return evaluate(db, userId, purpose, candidate, true, true);
    }

    /**
     * Check a candidate code for {@code (userId, purpose)} <b>without consuming
     * it</b> — used where the code acts as a temporary credential (a password-reset
     * code that works as a login for its whole 30-minute window).  Returns true on
     * an exact, unexpired, within-attempt-limit match.
     *
     * @param countMiss when true, a wrong candidate increments the attempt
     *        counter (use at login); pass false for periodic re-validation so a
     *        live session does not burn attempts.
     */
    public static boolean check(Connection db, int userId, String purpose, String candidate, boolean countMiss) throws Exception {
        return evaluate(db, userId, purpose, candidate, false, countMiss);
    }

    /** Delete all codes for {@code (userId, purpose)} — e.g. after a password change. */
    public static void clear(Connection db, int userId, String purpose) throws Exception {
        db.execute("delete from verification_code where user_id = ? and purpose = ?", userId, purpose);
    }

    private static boolean evaluate(Connection db, int userId, String purpose, String candidate,
                                    boolean consumeOnMatch, boolean countMiss) throws Exception {
        if (candidate == null)
            return false;
        candidate = candidate.trim();
        Record rec = db.fetchOne(
                "select code_id, code, expires_ts, attempts from verification_code where user_id = ? and purpose = ?",
                userId, purpose);
        if (rec == null)
            return false;
        int codeId = rec.getInt("code_id");
        long expires = rec.getLong("expires_ts");
        int attempts = rec.getInt("attempts");
        if (System.currentTimeMillis() > expires || attempts >= MAX_ATTEMPTS) {
            // Clean up independently — callers often throw a UserException on a
            // failed check, which rolls back the request's transaction
            // (see ProcessServlet.errorReturn).
            runCommitted("delete from verification_code where code_id = ?", codeId);
            return false;
        }
        String stored = rec.getString("code");
        if (stored != null && stored.trim().equals(candidate)) {
            if (consumeOnMatch)
                db.execute("delete from verification_code where code_id = ?", codeId);
            return true;
        }
        if (countMiss)
            // Increment on a separate, immediately-committed connection so the
            // attempt limit survives the caller's rollback.
            runCommitted("update verification_code set attempts = attempts + 1 where code_id = ?", codeId);
        return false;
    }

    /**
     * Run a single statement on its own connection and commit it immediately, so
     * the change persists even when the calling service later throws (and the
     * request transaction is rolled back).  Best-effort: a failure here only
     * weakens the attempt counter and must not break verification.
     */
    private static void runCommitted(String sql, Object... args) {
        Connection c = null;
        boolean ok = false;
        try {
            c = MainServlet.openNewConnection();
            c.execute(sql, args);
            ok = true;
        } catch (Exception e) {
            // best-effort hardening; ignore
        } finally {
            if (c != null) {
                try {
                    MainServlet.closeConnection(c, ok);
                } catch (Exception ignore) {
                }
            }
        }
    }
}
