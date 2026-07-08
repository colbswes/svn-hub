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
        // "My Repositories" shows only the repos the caller OWNS — not repos merely
        // granted to them, and not (for admins) everyone's.  Other repositories are
        // found via Explore / Discover.
        List<Record> recs = db.fetchAll(
                "select * from repository where is_active = 'Y' and owner_id = ? order by name", userId)
        String base = baseUrl()
        JSONArray rows = new JSONArray()
        for (Record r : recs)
            rows.put(repoRow(r, userId, base))
        outjson.put("rows", rows)
        outjson.put("isAdmin", admin)
    }

    /**
     * Discover other repositories the caller may checkout/clone: public ones, plus
     * any private repos they have been granted read access to.  Optional `query`
     * filters by name or key.
     */
    void searchRepositories(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        boolean admin = RepoAccess.isAdmin(db, userId)
        String q = injson.getString("query", "")
        if (q != null)
            q = q.trim()
        String like = "%" + (q == null ? "" : q.toLowerCase()) + "%"
        List<Record> recs
        if (admin)
            recs = db.fetchAll("""select * from repository where is_active = 'Y'
                    and (lower(name) like ? or lower(coalesce(description,'')) like ? or lower(repo_key) like ?)
                    order by name""", like, like, like)
        else
            recs = db.fetchAll("""select r.* from repository r
                    where r.is_active = 'Y'
                    and (lower(r.name) like ? or lower(coalesce(r.description,'')) like ? or lower(r.repo_key) like ?)
                    and ( r.visibility = 'public'
                          or exists (select 1 from repository_access ra
                                     where ra.repo_id = r.repo_id and ra.user_id = ? and ra.can_read = 'Y') )
                    order by r.name""", like, like, like, userId)
        String base = baseUrl()
        JSONArray rows = new JSONArray()
        for (Record r : recs)
            rows.put(repoRow(r, userId, base))
        outjson.put("rows", rows)
    }

    /**
     * Recently changed repositories visible to the caller (owned, public, or
     * granted read), ordered by most recent HEAD revision (or creation) first.
     * Backs the "Welcome back" home overview's Recently changed container.
     */
    void getRecentRepositories(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        boolean admin = RepoAccess.isAdmin(db, userId)
        int limit = injson.getInt("limit", 6)
        if (limit < 1)
            limit = 6
        if (limit > 24)
            limit = 24
        List<Record> recs
        if (admin)
            recs = db.fetchAll("""select * from repository where is_active = 'Y'
                    order by coalesce(head_revision_ts, created_ts) desc""")
        else
            recs = db.fetchAll("""select r.* from repository r
                    where r.is_active = 'Y'
                    and ( r.owner_id = ?
                          or r.visibility = 'public'
                          or exists (select 1 from repository_access ra
                                     where ra.repo_id = r.repo_id and ra.user_id = ? and ra.can_read = 'Y') )
                    order by coalesce(r.head_revision_ts, r.created_ts) desc""", userId, userId)
        String base = baseUrl()
        JSONArray rows = new JSONArray()
        int n = Math.min(limit, recs.size())
        for (int i = 0; i < n; i++)
            rows.put(repoRow(recs[i], userId, base))
        outjson.put("rows", rows)
    }

    /**
     * Recent commit activity across repositories the caller can see (owned,
     * public, or granted read; all for admins). Backs the home overview's
     * "Recent activity" feed. Returns the most recent cached revisions.
     */
    void getRecentActivity(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        boolean admin = RepoAccess.isAdmin(db, userId)
        int limit = injson.getInt("limit", 10)
        if (limit < 1)
            limit = 10
        if (limit > 50)
            limit = 50
        String visWhere
        List params = []
        if (admin) {
            visWhere = "r.is_active = 'Y'"
        } else {
            visWhere = """r.is_active = 'Y' and (
                    r.owner_id = ?
                    or r.visibility = 'public'
                    or exists (select 1 from repository_access ra
                               where ra.repo_id = r.repo_id and ra.user_id = ? and ra.can_read = 'Y'))"""
            params = [userId, userId]
        }
        String sql = """select c.revision as "revision",
                c.repo_id as "repoId",
                r.name as "repoName",
                r.repo_key as "repoKey",
                r.visibility as "visibility",
                r.owner_id as "ownerId",
                c.author as "author",
                c.commit_ts as "commitTs",
                c.message as "message",
                c.changed_count as "changedCount"
                from commit_cache c
                join repository r on r.repo_id = c.repo_id
                where """ + visWhere + """
                order by c.commit_ts desc nulls last"""
        JSONArray rows = db.fetchAllJSON(limit, sql, *params)
        outjson.put("rows", rows)
    }

    /**
     * Open issues and merge requests across every repository the caller OWNS:
     * headline counts plus the most recently filed open items.  Backs the home
     * overview's "Needs attention" panel.
     */
    void getAttentionItems(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int limit = injson.getInt("limit", 5)
        if (limit < 1)
            limit = 5
        if (limit > 20)
            limit = 20
        Record counts = db.fetchOne("""select
                (select count(*) from issue i join repository r on r.repo_id = i.repo_id
                  where r.owner_id = ? and r.is_active = 'Y' and i.status = 'open') as open_issues,
                (select count(*) from merge_request m join repository r on r.repo_id = m.repo_id
                  where r.owner_id = ? and r.is_active = 'Y' and m.status = 'open') as open_mrs""", userId, userId)
        outjson.put("openIssues", counts.getLong("open_issues") ?: 0L)
        outjson.put("openMergeRequests", counts.getLong("open_mrs") ?: 0L)
        List<Record> recs = db.fetchAll(limit, """select t.* from (
                select 'issue' as item_type, i.number as number, i.title as title, i.created_ts as created_ts,
                       r.repo_id as repo_id, r.repo_key as repo_key, r.name as name
                from issue i join repository r on r.repo_id = i.repo_id
                where r.owner_id = ? and r.is_active = 'Y' and i.status = 'open'
                union all
                select 'mr' as item_type, m.number, m.title, m.created_ts,
                       r.repo_id, r.repo_key, r.name
                from merge_request m join repository r on r.repo_id = m.repo_id
                where r.owner_id = ? and r.is_active = 'Y' and m.status = 'open'
                ) t order by t.created_ts desc""", userId, userId)
        JSONArray rows = new JSONArray()
        for (Record r : recs) {
            JSONObject o = new JSONObject()
            o.put("type", r.getString("item_type"))
            o.put("number", r.getInt("number"))
            o.put("title", r.getString("title"))
            o.put("createdTs", r.getLong("created_ts"))
            o.put("repoId", r.getInt("repo_id"))
            o.put("repoKey", r.getString("repo_key"))
            o.put("repoName", r.getString("name"))
            rows.put(o)
        }
        outjson.put("rows", rows)
    }

    /** A single repository plus the caller's access level. */
    void getRepository(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        Record r = db.fetchOne("select * from repository where repo_id = ?", repoId)
        if (r == null)
            throw new UserException("Repository not found.")
        JSONObject repo = repoRow(r, userId, baseUrl())
        addCounts(repo, db, repoId)
        outjson.put("repo", repo)
        outjson.put("access", accessJson(db, userId, repoId))
    }

    // ----------------------------------------------------------------- create

    /** Create a new FSFS repository and provision its svnserve auth. */
    void createRepository(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = currentUser(servlet)
        // The form's "Repository Name" is the name within the caller's namespace.
        String name = injson.getString("repoKey", "")
        if (name != null)
            name = name.trim()
        String description = injson.getString("description", "")
        boolean stdLayout = injson.getBoolean("standardLayout", true)
        String visibility = injson.getString("visibility", "private")
        if (visibility != "public" && visibility != "private")
            visibility = "private"

        if (!name || !(name ==~ /[A-Za-z0-9_-]{1,100}/))
            throw new UserException("Invalid repository name. Use 1-100 letters, digits, dash or underscore (no spaces).")

        // Namespace the repo under the owner's handle: repo_key = "<handle>/<name>".
        String handle = userHandle(db, userId)
        String repoKey = handle + "/" + name
        if (db.exists("select 1 from repository where repo_key = ?", repoKey))
            throw new UserException("You already have a repository named '" + name + "'.")

        // Ensure the owner's namespace directory exists, then create the repo under it.
        new File(reposRoot() + "/" + handle).mkdirs()
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
        rec.set("owner_id", userId)
        rec.set("visibility", visibility)
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
        if (injson.has("name")) {
            String name = injson.getString("name", "")
            if (name != null)
                name = name.trim()
            if (!name || name.length() > 100 || name.contains("/"))
                throw new UserException("Invalid repository display name.")
            r.set("name", name)
        }
        if (injson.has("description"))
            r.set("description", injson.getString("description", ""))
        if (injson.has("defaultBranch")) {
            String branch = injson.getString("defaultBranch", "")
            r.set("default_branch", branch == null || branch.trim().isEmpty() ? null : branch.trim())
        }
        if (injson.has("isActive"))
            r.set("is_active", injson.getBoolean("isActive") ? "Y" : "N")
        boolean visChanged = false
        if (injson.has("visibility")) {
            String v = injson.getString("visibility")
            if (v == "public" || v == "private") {
                r.set("visibility", v)
                visChanged = true
            }
        }
        r.update()
        // Visibility drives the catch-all authz rule, so re-emit it.
        if (visChanged)
            SvnAuthManager.regenerateRepoAuth(db, repoId, sharedPasswdPath())
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
        // Repos live two levels deep: <root>/<handle>/<name>.
        File root = new File(reposRoot())
        int added = 0
        File[] handleDirs = root.listFiles()
        if (handleDirs != null) {
            for (File hdir : handleDirs) {
                if (!hdir.isDirectory())
                    continue
                String handle = hdir.getName()
                Record owner = db.fetchOne("select user_id from users where handle = ?", handle)
                File[] repoDirs = hdir.listFiles()
                if (repoDirs == null)
                    continue
                for (File dir : repoDirs) {
                    if (!dir.isDirectory())
                        continue
                    // An FSFS repo has a 'format' file and a 'db' subdirectory.
                    if (!(new File(dir, "format").isFile() && new File(dir, "db").isDirectory()))
                        continue
                    String key = handle + "/" + dir.getName()
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
                    rec.set("name", dir.getName())
                    rec.set("fs_path", dir.getAbsolutePath())
                    if (owner != null)
                        rec.set("owner_id", owner.getInt("user_id"))
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
        }
        outjson.put("added", added)
    }

    // ---------------------------------------------------------------- helpers

    private static Integer currentUser(ProcessServlet servlet) {
        def ud = servlet.getUserData()
        return ud == null ? null : (Integer) ud.getUserId()
    }

    /** The caller's URL-safe handle (the repo namespace). */
    private static String userHandle(Connection db, Integer userId) {
        Record u = db.fetchOne("select handle from users where user_id = ?", userId)
        if (u == null || !u.getString("handle"))
            throw new UserException("Your account has no username set, so a repository cannot be created.")
        return u.getString("handle")
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

    private static JSONObject repoRow(Record r, Integer userId, String base) {
        JSONObject o = new JSONObject()
        String key = r.getString("repo_key")
        o.put("repoId", r.getInt("repo_id"))
        o.put("repoKey", key)
        // repo_key is "<handle>/<name>"; surface the owner handle for display.
        o.put("ownerHandle", key != null && key.contains("/") ? key.substring(0, key.indexOf("/")) : null)
        o.put("name", r.getString("name"))
        o.put("description", r.getString("description"))
        o.put("visibility", r.getString("visibility"))
        Integer ownerId = r.getInt("owner_id")
        o.put("ownerId", ownerId)
        o.put("owned", ownerId != null && userId != null && ownerId == userId)
        o.put("defaultBranch", r.getString("default_branch"))
        o.put("discovered", r.getString("discovered"))
        o.put("isActive", r.getString("is_active"))
        o.put("headRevision", r.getInt("head_revision"))
        o.put("headRevisionTs", r.getLong("head_revision_ts"))
        o.put("createdTs", r.getLong("created_ts"))
        o.put("checkoutUrl", (base ? base : "") + "/" + r.getString("repo_key"))
        return o
    }

    private static void addCounts(JSONObject o, Connection db, int repoId) {
        Record issues = db.fetchOne("""select
                count(*) as issue_count,
                sum(case when status = 'open' then 1 else 0 end) as open_issue_count
                from issue where repo_id = ?""", repoId)
        Record mrs = db.fetchOne("""select
                count(*) as merge_request_count,
                sum(case when status = 'open' then 1 else 0 end) as open_merge_request_count
                from merge_request where repo_id = ?""", repoId)
        o.put("issueCount", issues?.getLong("issue_count") ?: 0L)
        o.put("openIssueCount", issues?.getLong("open_issue_count") ?: 0L)
        o.put("mergeRequestCount", mrs?.getLong("merge_request_count") ?: 0L)
        o.put("openMergeRequestCount", mrs?.getLong("open_merge_request_count") ?: 0L)
    }

    private static String baseUrl() {
        String b = MainServlet.getEnvironment("SvnBaseUrl")
        return b == null ? "" : b.replaceAll('/$', '')
    }
}
