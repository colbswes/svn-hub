package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.MainServlet
import org.kissweb.UserException
import com.svnhub.SvnAuthManager
import com.svnhub.RepoAccess

/**
 * Per-repository access management.  Every change re-serializes the svnserve
 * authz (and passwd) files so the running svnserve enforces the new rules.
 */
class RepositoryAccessService {

    /** Current grants for a repository, plus the active users available to add. */
    void getAccess(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireAdmin(db, userId, repoId)

        List<Record> grants = db.fetchAll("""select ra.*, u.user_name, u.full_name, u.svn_password
                from repository_access ra join users u on u.user_id = ra.user_id
                where ra.repo_id = ? order by u.user_name""", repoId)
        JSONArray rows = new JSONArray()
        for (Record r : grants) {
            JSONObject o = new JSONObject()
            o.put("userId", r.getInt("user_id"))
            o.put("userName", r.getString("user_name"))
            o.put("fullName", r.getString("full_name"))
            o.put("canRead", r.getString("can_read"))
            o.put("canWrite", r.getString("can_write"))
            o.put("canAdmin", r.getString("can_admin"))
            o.put("hasSvnPassword", r.getString("svn_password") ? "Y" : "N")
            rows.put(o)
        }
        outjson.put("rows", rows)

        // All active users (the picker supports both granting and updating, since grant() upserts).
        List<Record> avail = db.fetchAll("""select user_id, user_name, full_name from users
                where user_active = 'Y' order by user_name""")
        JSONArray users = new JSONArray()
        for (Record u : avail) {
            JSONObject o = new JSONObject()
            o.put("userId", u.getInt("user_id"))
            o.put("userName", u.getString("user_name"))
            o.put("fullName", u.getString("full_name"))
            users.put(o)
        }
        outjson.put("availableUsers", users)
    }

    /** Grant or update a user's access to a repository. */
    void grant(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireAdmin(db, userId, repoId)
        int targetUser = injson.getInt("userId")
        String canRead = injson.getBoolean("canRead", true) ? "Y" : "N"
        String canWrite = injson.getBoolean("canWrite", false) ? "Y" : "N"
        String canAdmin = injson.getBoolean("canAdmin", false) ? "Y" : "N"

        Record ra = db.fetchOne("select * from repository_access where repo_id = ? and user_id = ?", repoId, targetUser)
        if (ra == null) {
            ra = db.newRecord("repository_access")
            ra.set("repo_id", repoId)
            ra.set("user_id", targetUser)
            ra.set("can_read", canRead)
            ra.set("can_write", canWrite)
            ra.set("can_admin", canAdmin)
            ra.set("granted_ts", System.currentTimeMillis())
            ra.addRecord()
        } else {
            ra.set("can_read", canRead)
            ra.set("can_write", canWrite)
            ra.set("can_admin", canAdmin)
            ra.update()
        }
        regenerate(db, repoId)
    }

    /** Remove a user's access to a repository. */
    void revoke(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireAdmin(db, userId, repoId)
        int targetUser = injson.getInt("userId")
        db.execute("delete from repository_access where repo_id = ? and user_id = ?", repoId, targetUser)
        regenerate(db, repoId)
    }

    /**
     * Set an SVN password for a user (what they authenticate to svnserve with).
     * A user may set their own; a global admin may set anyone's.  The svnserve
     * passwd format stores this in the clear, so it is intentionally distinct
     * from the PBKDF2 login hash.
     */
    void setSvnPassword(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int targetUser = injson.getInt("userId", userId)
        if (targetUser != userId && !RepoAccess.isAdmin(db, userId))
            throw new UserException("You may only set your own SVN password.")
        String pw = injson.getString("svnPassword", "")
        if (!pw)
            throw new UserException("SVN password must not be empty.")
        Record u = db.fetchOne("select * from users where user_id = ?", targetUser)
        if (u == null)
            throw new UserException("User not found.")
        u.set("svn_password", pw)
        u.update()
        SvnAuthManager.regeneratePasswd(db, sharedPasswdPath())
    }

    // ---------------------------------------------------------------- helpers

    private static void regenerate(Connection db, int repoId) {
        SvnAuthManager.regeneratePasswd(db, sharedPasswdPath())
        SvnAuthManager.regenerateRepoAuth(db, repoId, sharedPasswdPath())
    }

    private static Integer currentUser(ProcessServlet servlet) {
        return (Integer) servlet.getUserData().getUserId()
    }

    private static String sharedPasswdPath() {
        String c = MainServlet.getEnvironment("SvnConfDir")
        if (!c)
            throw new UserException("SvnConfDir is not configured in application.ini.")
        return c + "/passwd"
    }
}
