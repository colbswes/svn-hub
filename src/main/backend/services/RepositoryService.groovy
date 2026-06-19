package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.MainServlet
import org.kissweb.UserException
import com.svnhub.SvnRepo
import com.svnhub.SvnAuthManager
import com.svnhub.RepoAccess

/**
 * Repository management for SvnHub.
 *
 * Creates and curates Subversion repositories under SvnReposRoot, and (because
 * SvnHub runs in full-management mode) provisions the svnserve auth files for
 * each new repo via {@link com.svnhub.SvnAuthManager}.
 */
class RepositoryService {

    // ---------------------------------------------------------------- queries

    /** Repositories visible to the caller (all of them for an admin). */
    void getRepositories(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        boolean admin = RepoAccess.isAdmin(db, userId)
        List<Record> recs
        if (admin)
            recs = db.fetchAll("select * from repository where is_active = 'Y' order by name")
        else
            recs = db.fetchAll("""select r.* from repository r
                    join repository_access ra on ra.repo_id = r.repo_id
                    where r.is_active = 'Y' and ra.user_id = ? and ra.can_read = 'Y'
                    order by r.name""", userId)
        JSONArray rows = new JSONArray()
        for (Record r : recs)
            rows.put(repoRow(r))
        outjson.put("rows", rows)
        outjson.put("isAdmin", admin)
    }

    /** A single repository plus the caller's access level. */
    void getRepository(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        Record r = db.fetchOne("select * from repository where repo_id = ?", repoId)
        if (r == null)
            throw new UserException("Repository not found.")
        outjson.put("repo", repoRow(r))
        outjson.put("access", accessJson(db, userId, repoId))
    }

    // ----------------------------------------------------------------- create

    /** Create a new FSFS repository and provision its svnserve auth. */
    void createRepository(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        String repoKey = injson.getString("repoKey", "")
        if (repoKey != null)
            repoKey = repoKey.trim()
        String name = injson.getString("name", "")
        if (name != null)
            name = name.trim()
        String description = injson.getString("description", "")
        boolean stdLayout = injson.getBoolean("standardLayout", true)

        if (!repoKey || !(repoKey ==~ /[A-Za-z0-9_-]{1,100}/))
            throw new UserException("Invalid repository key. Use 1-100 letters, digits, dash or underscore.")
        if (!name)
            name = repoKey
        if (db.exists("select 1 from repository where repo_key = ?", repoKey))
            throw new UserException("A repository named '" + repoKey + "' already exists.")

        String fsPath = reposRoot() + "/" + repoKey
        if (new File(fsPath).exists())
            throw new UserException("A directory already exists at " + fsPath)

        // Provision the on-disk FSFS repository (optionally with trunk/branches/tags).
        SvnRepo.createLocalRepository(fsPath, stdLayout)
        long head = SvnRepo.getLatestRevision(fsPath)
        long now = System.currentTimeMillis()

        Record rec = db.newRecord("repository")
        rec.set("repo_key", repoKey)
        rec.set("name", name)
        rec.set("fs_path", fsPath)
        rec.set("description", description)
        rec.set("default_branch", stdLayout ? "trunk" : null)
        rec.set("discovered", "N")
        rec.set("is_active", "Y")
        rec.set("created_ts", now)
        rec.set("head_revision", (int) head)
        rec.set("head_revision_ts", now)
        int repoId = ((Number) rec.addRecordAutoInc()).intValue()

        // Creator gets full access.
        Record acc = db.newRecord("repository_access")
        acc.set("repo_id", repoId)
        acc.set("user_id", userId)
        acc.set("can_read", "Y")
        acc.set("can_write", "Y")
        acc.set("can_admin", "Y")
        acc.set("granted_ts", now)
        acc.addRecord()

        // Regenerate svnserve auth so the new repo is immediately usable.
        SvnAuthManager.regeneratePasswd(db, sharedPasswdPath())
        SvnAuthManager.regenerateRepoAuth(db, repoId, sharedPasswdPath())

        outjson.put("repoId", repoId)
        outjson.put("repoKey", repoKey)
    }

    // ----------------------------------------------------------------- update

    /** Update mutable repository attributes (admin of the repo, or a global admin). */
    void updateRepository(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireAdmin(db, userId, repoId)
        Record r = db.fetchOne("select * from repository where repo_id = ?", repoId)
        if (r == null)
            throw new UserException("Repository not found.")
        if (injson.has("name"))
            r.set("name", injson.getString("name"))
        if (injson.has("description"))
            r.set("description", injson.getString("description"))
        if (injson.has("defaultBranch"))
            r.set("default_branch", injson.getString("defaultBranch"))
        if (injson.has("isActive"))
            r.set("is_active", injson.getBoolean("isActive") ? "Y" : "N")
        r.update()
    }

    // ------------------------------------------------------------------- scan

    /**
     * Register FSFS repositories that already exist under SvnReposRoot but are
     * not yet tracked (e.g. created outside SvnHub). Global admins only.
     */
    void scanRepositories(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        if (!RepoAccess.isAdmin(db, userId))
            throw new UserException("Only an administrator may scan for repositories.")
        File root = new File(reposRoot())
        int added = 0
        File[] children = root.listFiles()
        if (children != null) {
            for (File dir : children) {
                if (!dir.isDirectory())
                    continue
                // An FSFS repo has a 'format' file and a 'db' subdirectory.
                if (!(new File(dir, "format").isFile() && new File(dir, "db").isDirectory()))
                    continue
                String key = dir.getName()
                if (db.exists("select 1 from repository where repo_key = ?", key))
                    continue
                long now = System.currentTimeMillis()
                long head = 0
                try {
                    head = SvnRepo.getLatestRevision(dir.getAbsolutePath())
                } catch (ignored) {
                }
                Record rec = db.newRecord("repository")
                rec.set("repo_key", key)
                rec.set("name", key)
                rec.set("fs_path", dir.getAbsolutePath())
                rec.set("default_branch", "trunk")
                rec.set("discovered", "Y")
                rec.set("is_active", "Y")
                rec.set("created_ts", now)
                rec.set("head_revision", (int) head)
                rec.set("head_revision_ts", now)
                rec.addRecord()
                added++
            }
        }
        outjson.put("added", added)
    }

    // ---------------------------------------------------------------- helpers

    private static Integer currentUser(ProcessServlet servlet) {
        return (Integer) servlet.getUserData().getUserId()
    }

    private static String reposRoot() {
        String r = MainServlet.getEnvironment("SvnReposRoot")
        if (!r)
            throw new UserException("SvnReposRoot is not configured in application.ini.")
        return r
    }

    private static String sharedPasswdPath() {
        String c = MainServlet.getEnvironment("SvnConfDir")
        if (!c)
            throw new UserException("SvnConfDir is not configured in application.ini.")
        return c + "/passwd"
    }

    /** {read, write, admin} for the caller on a repo (an admin gets all). */
    private static JSONObject accessJson(Connection db, Integer userId, int repoId) {
        JSONObject a = new JSONObject()
        a.put("read", RepoAccess.canRead(db, userId, repoId))
        a.put("write", RepoAccess.canWrite(db, userId, repoId))
        a.put("admin", RepoAccess.canAdmin(db, userId, repoId))
        return a
    }

    private static JSONObject repoRow(Record r) {
        JSONObject o = new JSONObject()
        o.put("repoId", r.getInt("repo_id"))
        o.put("repoKey", r.getString("repo_key"))
        o.put("name", r.getString("name"))
        o.put("description", r.getString("description"))
        o.put("defaultBranch", r.getString("default_branch"))
        o.put("discovered", r.getString("discovered"))
        o.put("isActive", r.getString("is_active"))
        o.put("headRevision", r.getInt("head_revision"))
        o.put("headRevisionTs", r.getLong("head_revision_ts"))
        o.put("createdTs", r.getLong("created_ts"))
        return o
    }
}
