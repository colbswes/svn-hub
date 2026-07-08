import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.UserCache
import org.kissweb.restServer.UserData
import org.kissweb.PasswordHash
import com.svnhub.migrate.SchemaStatus
import com.svnhub.VerificationCodes

/**
 * This module handles user authentication.  Passwords are stored as salted PBKDF2 hashes
 * (see {@link org.kissweb.PasswordHash}).  Legacy plain-text and 64-character SHA-256 values
 * are still accepted so pre-existing accounts continue to work until their password is next changed.
 */
class Login {

    /**
     * Verify a candidate password against the stored value, accepting the current PBKDF2 hash format
     * as well as legacy plain-text and SHA-256 values.
     */
    private static boolean passwordMatches(String stored, String entered) {
        if (PasswordHash.isHashed(stored))
            return PasswordHash.verify(entered, stored)
        // Legacy formats (pre-hashing): 64-character SHA-256 hex, or plain text.
        if (stored.length() == 64)
            return stored.equals(entered.sha256())
        return stored.equals(entered)
    }

    /**
     * Validate a user's login name and password.  May also associate user specific data.
     *
     * @param db
     * @param user
     * @param password
     * @param outjson  extra data sent back to the front-end
     * @return
     */
    public static UserData login(Connection db, String user, String password, JSONObject outjson, ProcessServlet servlet) {
        // Fail-closed: never serve on a half-migrated database (see AutoUpdate.md).
        // The framework reports the generic "Invalid login." for a null return; the
        // real reason (schema migration incomplete) is in the startup log banner.
        if (!SchemaStatus.isReady())
            return null
        Record rec = db.fetchOne("select user_id, user_password, is_admin, handle, email, email_verified from users where user_name = ? and user_active = 'Y'", user)
        if (rec == null)
            return null    //  invalid user
        Integer userId = (Integer) rec.getInt("user_id")
        String pw = rec.getString("user_password")
        boolean ok = pw != null && passwordMatches(pw, password)
        boolean viaResetCode = false
        if (!ok) {
            // Forgotten-password: a valid, unexpired reset code works as a temporary
            // login credential.  Requesting a reset never changes the stored
            // password, so the real password keeps working the whole time.
            if (VerificationCodes.check(db, userId, VerificationCodes.PURPOSE_RESET, password, true)) {
                ok = true
                viaResetCode = true
            }
        }
        if (!ok)
            return null
        UserData ud = UserCache.newUser(user, password, userId)
        ud.putUserData("usedResetCode", viaResetCode)
        // Let the front-end gate admin-only UI (the back-end still enforces it).
        outjson.put("isAdmin", "Y".equals(rec.getString("is_admin")))
        // The front-end gates the app on an unverified email and shows the handle
        // in the account area; the email drives the "we sent a code to ..." text.
        outjson.put("emailVerified", "Y".equals(rec.getString("email_verified")))
        outjson.put("handle", rec.getString("handle"))
        outjson.put("email", rec.getString("email") ?: "")
        // Signed in with a reset code → the front-end routes them to set a new password.
        outjson.put("usedResetCode", viaResetCode)
        return ud
    }

    /**
     * Re-validate a user.
     *
     * Users get re-validated about once every two minutes.  This assures that a user is logged out if their login
     * gets disabled while they're in the system.
     *
     * @param db
     * @param ud
     * @return true if the user is still valid, false if not
     */
    public static Boolean checkLogin(Connection db, UserData ud, ProcessServlet servlet) {
        Record rec = db.fetchOne("select user_id, user_password from users where user_name = ? and user_active = 'Y'", ud.getUsername())
        if (rec == null)
            return false    //  invalid user
        String pw = rec.getString("user_password")
        if (pw != null && passwordMatches(pw, ud.getPassword()))
            return true
        // Keep a reset-code login session valid while the code is unexpired.  Do
        // not count periodic re-validation as a failed attempt (countMiss=false).
        Integer userId = (Integer) rec.getInt("user_id")
        return VerificationCodes.check(db, userId, VerificationCodes.PURPOSE_RESET, ud.getPassword(), false)
    }
}
