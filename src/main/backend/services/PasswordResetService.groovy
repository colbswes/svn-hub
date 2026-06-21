package services

import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.VerificationCodes
import com.svnhub.Mailer
import com.svnhub.EmailBodies

/**
 * Forgotten-password support.  The single method here is the only one that runs
 * without a session (allow-listed in KissInit.groovy) — necessarily so, since the
 * user cannot be logged in when they have forgotten their password.
 *
 * Design (deliberate): requesting a reset NEVER changes or invalidates the
 * existing password.  Instead it emails a 6-digit code that works as a TEMPORARY
 * login credential for 30 minutes (see {@code Login.login}).  So a third party
 * who triggers a reset for someone else cannot disrupt that user — the real
 * password keeps working, and only the genuine owner (who receives the email) can
 * use the code.  After signing in with the code, the user sets a new password via
 * the authenticated {@code AccountService.changePassword}.
 *
 * requestReset never reveals whether an account exists (no enumeration).
 */
class PasswordResetService {

    void requestReset(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        if (db == null)
            throw new UserException("Password reset is unavailable (no database configured).")
        String email = injson.getString("email", "")
        if (email != null)
            email = email.trim().toLowerCase()

        // Always report success regardless of whether the account exists.
        outjson.put("sent", true)
        if (!email)
            return
        Record rec = db.fetchOne("select user_id, full_name from users where lower(email) = ? and user_active = 'Y'", email)
        if (rec == null)
            return
        Integer userId = (Integer) rec.getInt("user_id")
        try {
            String code = VerificationCodes.issue(db, userId, VerificationCodes.PURPOSE_RESET, VerificationCodes.RESET_TTL_MINUTES)
            Mailer.sendHtml(email, rec.getString("full_name"), "Reset your Svn-Hub password", EmailBodies.passwordReset(code))
        } catch (Exception e) {
            println "* * * PasswordResetService.requestReset: could not send reset email to " + email + ": " + e.getMessage()
        }
    }
}
