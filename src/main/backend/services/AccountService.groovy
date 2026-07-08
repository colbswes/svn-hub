package services

import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.MainServlet
import org.kissweb.PasswordHash
import org.kissweb.UserException
import com.svnhub.SvnAuthManager
import com.svnhub.VerificationCodes
import com.svnhub.Mailer
import com.svnhub.EmailBodies

/**
 * Authenticated account self-service:
 *   status()            — current handle / email / name / verification / admin state
 *   verifyEmail(code)   — confirm the email with the emailed 6-digit code
 *   resendVerification()— re-issue and resend the code (lightly throttled)
 *   changePassword(...) — change one's own password (web hash + SVN credential)
 *   updateProfile(...)  — change one's own display name (full_name)
 *
 * The current user is taken from the session (servlet.getUserData()), never from
 * the request body, so a user can only act on their own account.
 */
class AccountService {

    /** Current account status (used by refresh restore, the verify screen and the Framework shell). */
    void status(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        Record rec = db.fetchOne("select handle, email, full_name, email_verified, is_admin from users where user_id = ?", userId)
        if (rec == null)
            throw new UserException("Account not found.")
        outjson.put("handle", rec.getString("handle"))
        outjson.put("email", rec.getString("email") ?: "")
        outjson.put("fullName", rec.getString("full_name") ?: "")
        outjson.put("emailVerified", "Y".equals(rec.getString("email_verified")))
        outjson.put("isAdmin", "Y".equals(rec.getString("is_admin")))
        outjson.put("usedResetCode", Boolean.TRUE.equals(servlet.getUserData().getUserData("usedResetCode")))
    }

    /**
     * Update the current user's own profile.  Only the display name (full_name)
     * is self-editable: the handle is the repo namespace (handle/name) and the
     * email is the login credential, so both stay admin-managed.  The user is
     * taken from the session, never the request body.
     */
    void updateProfile(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        String fullName = injson.getString("fullName", "")
        fullName = fullName == null ? "" : fullName.trim()
        if (fullName.length() > 200)
            throw new UserException("Your name must be 200 characters or fewer.")
        Record rec = db.fetchOne("select user_id from users where user_id = ? and user_active = 'Y'", userId)
        if (rec == null)
            throw new UserException("Account not found.")
        db.execute("update users set full_name = ? where user_id = ?", fullName, userId)
        outjson.put("fullName", fullName)
    }

    /** Verify the current user's email with the 6-digit code that was emailed to them. */
    void verifyEmail(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        String code = injson.getString("code", "")
        if (!VerificationCodes.verify(db, userId, VerificationCodes.PURPOSE_EMAIL, code))
            throw new UserException("That code is incorrect or has expired. Please try again or resend a new code.")
        db.execute("update users set email_verified = 'Y' where user_id = ?", userId)
        outjson.put("emailVerified", true)
    }

    /** Re-issue and resend the email-verification code (throttled to once per minute). */
    void resendVerification(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        Record rec = db.fetchOne("select email, full_name, email_verified from users where user_id = ?", userId)
        if (rec == null)
            throw new UserException("Account not found.")
        if ("Y".equals(rec.getString("email_verified"))) {
            outjson.put("alreadyVerified", true)
            return
        }
        String email = rec.getString("email")
        if (!email)
            throw new UserException("Your account has no email address on file.")
        long age = VerificationCodes.ageMillis(db, userId, VerificationCodes.PURPOSE_EMAIL)
        if (age >= 0 && age < 60_000L)
            throw new UserException("A code was just sent. Please wait a minute before requesting another.")
        String code = VerificationCodes.issue(db, userId, VerificationCodes.PURPOSE_EMAIL, VerificationCodes.DEFAULT_TTL_MINUTES)
        Mailer.sendHtml(email, rec.getString("full_name"), "Verify your Svn-Hub email", EmailBodies.verifyEmail(code))
        outjson.put("sent", true)
    }

    /**
     * Change the current user's password (both the web login hash and the SVN
     * credential).  The "current" credential may be either the existing password
     * or a valid password-reset code — the latter is how a user who signed in
     * with an emailed code sets a new password.
     */
    void changePassword(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        String current = injson.getString("currentPassword", "")
        String next = injson.getString("newPassword", "")
        if (next == null || next.length() < 6)
            throw new UserException("Your new password must be at least 6 characters.")
        Record rec = db.fetchOne("select user_password from users where user_id = ?", userId)
        if (rec == null)
            throw new UserException("Account not found.")
        boolean ok = passwordMatches(rec.getString("user_password"), current)
        if (!ok)
            ok = VerificationCodes.check(db, userId, VerificationCodes.PURPOSE_RESET, current, true)
        if (!ok && Boolean.TRUE.equals(servlet.getUserData().getUserData("usedResetCode")))
            ok = VerificationCodes.check(db, userId, VerificationCodes.PURPOSE_RESET, servlet.getUserData().getPassword(), false)
        if (!ok)
            throw new UserException("Your current password is incorrect.")
        // One credential serves both the web UI (hashed) and svn clients (clear text).
        db.execute("update users set user_password = ?, svn_password = ? where user_id = ?",
                PasswordHash.hash(next), next, userId)
        // A password change invalidates any outstanding reset code.
        VerificationCodes.clear(db, userId, VerificationCodes.PURPOSE_RESET)
        String confDir = MainServlet.getEnvironment("SvnConfDir")
        if (confDir)
            SvnAuthManager.regeneratePasswd(db, confDir + "/passwd")
        outjson.put("changed", true)
    }

    /** Accept the current PBKDF2 hash as well as legacy plain-text / SHA-256 values. */
    private static boolean passwordMatches(String stored, String entered) {
        if (stored == null || entered == null)
            return false
        if (PasswordHash.isHashed(stored))
            return PasswordHash.verify(entered, stored)
        if (stored.length() == 64)
            return stored.equals(entered.sha256())
        return stored.equals(entered)
    }
}
