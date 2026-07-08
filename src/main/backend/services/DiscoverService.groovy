package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.MainServlet
import org.kissweb.UserException
import com.svnhub.RepoAccess

/**
 * GitHub-style discovery: find people and browse their public repositories.
 *
 * Any logged-in user may use this.  Email addresses are never exposed here
 * (email is the login credential) — only the public handle, full name, and
 * public-repo counts.  A profile shows a user's public repos to everyone; the
 * owner (and admins) additionally see that user's private repos.
 *
 * All listing methods are paginated: they accept `page` (0-based) and
 * `pageSize`, and return `{rows|repos, total, page, pageSize}` so the UI can
 * offer next/previous buttons.  Searches are case-insensitive substring matches.
 */
class DiscoverService {

    static final int DEFAULT_PAGE_SIZE = 20
    static final int MAX_PAGE_SIZE = 100

    /** Search active users by handle or full name.  Returns public, non-PII fields only. */
    void searchUsers(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        String like = likeOf(injson)
        int page = injson.getInt("page", 0)
        int pageSize = pageSizeOf(injson)
        String where = "u.user_active = 'Y' and (lower(u.handle) like ? or lower(coalesce(u.full_name,'')) like ?)"

        long total = db.fetchCount("select u.user_id from users u where " + where, like, like)
        List<Record> recs = db.fetchAll(page, pageSize, """
                select u.user_id, u.handle, u.full_name,
                       (select count(*) from repository r
                          where r.owner_id = u.user_id and r.visibility = 'public' and r.is_active = 'Y') as public_repos
                from users u where """ + where + " order by public_repos desc, u.handle", like, like)
        JSONArray rows = new JSONArray()
        for (Record r : recs) {
            JSONObject o = new JSONObject()
            o.put("handle", r.getString("handle"))
            o.put("fullName", r.getString("full_name"))
            o.put("publicRepoCount", r.getLong("public_repos"))
            rows.put(o)
        }
        putPage(outjson, "rows", rows, total, page, pageSize)
    }

    /**
     * Search public repositories by name, description, or key (all substring, case-insensitive).
     * Admins additionally see private repos.
     */
    void searchRepos(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer viewerId = uid(servlet)
        boolean admin = RepoAccess.isAdmin(db, viewerId)
        String like = likeOf(injson)
        int page = injson.getInt("page", 0)
        int pageSize = pageSizeOf(injson)
        String match = "(lower(name) like ? or lower(coalesce(description,'')) like ? or lower(repo_key) like ?)"
        String where = admin ? "is_active = 'Y' and " + match
                             : "is_active = 'Y' and visibility = 'public' and " + match

        long total = db.fetchCount("select repo_id from repository where " + where, like, like, like)
        List<Record> recs = db.fetchAll(page, pageSize,
                "select * from repository where " + where + " order by name", like, like, like)
        String base = baseUrl()
        JSONArray rows = new JSONArray()
        for (Record r : recs)
            rows.put(repoJson(r, base))
        putPage(outjson, "rows", rows, total, page, pageSize)
    }

    /** A user's public profile: their info plus their public repositories (and private ones if the viewer owns them or is an admin). */
    void getProfile(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer viewerId = uid(servlet)
        String handle = injson.getString("handle", "")
        if (handle != null)
            handle = handle.trim().toLowerCase()
        if (!handle)
            throw new UserException("No username given.")
        Record u = db.fetchOne("select user_id, handle, full_name, created_ts from users where lower(handle) = ? and user_active = 'Y'", handle)
        if (u == null)
            throw new UserException("User not found.")
        int ownerId = u.getInt("user_id")
        int page = injson.getInt("page", 0)
        int pageSize = pageSizeOf(injson)

        JSONObject profile = new JSONObject()
        profile.put("handle", u.getString("handle"))
        profile.put("fullName", u.getString("full_name"))
        profile.put("memberSince", u.getLong("created_ts"))
        outjson.put("profile", profile)

        boolean privileged = (viewerId != null && ownerId == viewerId) || RepoAccess.isAdmin(db, viewerId)
        String where = privileged ? "owner_id = ? and is_active = 'Y'"
                                  : "owner_id = ? and is_active = 'Y' and visibility = 'public'"
        long total = db.fetchCount("select repo_id from repository where " + where, ownerId)
        List<Record> repos = db.fetchAll(page, pageSize,
                "select * from repository where " + where + " order by name", ownerId)
        String base = baseUrl()
        JSONArray rows = new JSONArray()
        for (Record r : repos)
            rows.put(repoJson(r, base))
        putPage(outjson, "repos", rows, total, page, pageSize)
    }

    /**
     * Standalone person detail: profile identity, visible owned repositories,
     * and recent commit activity by that person across repositories visible to
     * this viewer.  Uses only existing identity/repository/activity tables.
     */
    void getPersonDetail(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer viewerId = uid(servlet)
        String handle = injson.getString("handle", "")
        if (handle != null)
            handle = handle.trim().toLowerCase()
        if (!handle)
            throw new UserException("No username given.")

        Record u = db.fetchOne("select user_id, handle, full_name, created_ts from users where lower(handle) = ? and user_active = 'Y'", handle)
        if (u == null)
            throw new UserException("User not found.")
        int personId = u.getInt("user_id")
        boolean privileged = (viewerId != null && personId == viewerId) || RepoAccess.isAdmin(db, viewerId)
        int page = injson.getInt("page", 0)
        int pageSize = pageSizeOf(injson)
        int activityLimit = injson.getInt("activityLimit", 12)
        if (activityLimit < 1)
            activityLimit = 12
        if (activityLimit > 50)
            activityLimit = 50

        JSONObject profile = new JSONObject()
        profile.put("handle", u.getString("handle"))
        profile.put("fullName", u.getString("full_name"))
        profile.put("memberSince", u.getLong("created_ts"))
        profile.put("viewerCanSeePrivate", privileged)
        outjson.put("profile", profile)

        String ownedWhere = privileged ? "owner_id = ? and is_active = 'Y'"
                                      : "owner_id = ? and is_active = 'Y' and visibility = 'public'"
        Record repoStats = db.fetchOne("""select count(*) as repo_count,
                coalesce(sum(coalesce(head_revision, 0)), 0) as total_revisions
                from repository where """ + ownedWhere, personId)

        String activityVisibility = privileged ? "r.is_active = 'Y'"
                                               : "r.is_active = 'Y' and r.visibility = 'public'"
        Record commitStats = db.fetchOne("""select count(*) as commit_count,
                max(coalesce(cc.commit_ts, ae.event_ts)) as last_commit_ts
                from access_event ae
                join repository r on r.repo_id = ae.repo_id
                left join commit_cache cc on cc.repo_id = ae.repo_id and cc.revision = ae.revision
                where ae.user_id = ? and ae.action = 'commit' and """ + activityVisibility, personId)

        JSONObject stats = new JSONObject()
        stats.put("visibleRepoCount", repoStats?.getLong("repo_count") ?: 0L)
        stats.put("visibleRevisionCount", repoStats?.getLong("total_revisions") ?: 0L)
        stats.put("commitCount", commitStats?.getLong("commit_count") ?: 0L)
        stats.put("lastCommitTs", commitStats?.getLong("last_commit_ts"))
        outjson.put("stats", stats)

        long total = db.fetchCount("select repo_id from repository where " + ownedWhere, personId)
        List<Record> repos = db.fetchAll(page, pageSize,
                "select * from repository where " + ownedWhere + " order by name", personId)
        String base = baseUrl()
        JSONArray repoRows = new JSONArray()
        for (Record r : repos)
            repoRows.put(repoJson(r, base))
        putPage(outjson, "repos", repoRows, total, page, pageSize)

        List<Record> acts = db.fetchAll(activityLimit, """select
                r.repo_id, r.repo_key, r.name, r.visibility,
                ae.revision,
                max(coalesce(cc.message, '')) as message,
                max(coalesce(cc.commit_ts, ae.event_ts)) as commit_ts,
                max(coalesce(cc.changed_count, 0)) as changed_count
                from access_event ae
                join repository r on r.repo_id = ae.repo_id
                left join commit_cache cc on cc.repo_id = ae.repo_id and cc.revision = ae.revision
                where ae.user_id = ? and ae.action = 'commit' and """ + activityVisibility + """
                group by r.repo_id, r.repo_key, r.name, r.visibility, ae.revision
                order by max(coalesce(cc.commit_ts, ae.event_ts)) desc""", personId)
        JSONArray activity = new JSONArray()
        for (Record r : acts) {
            JSONObject o = new JSONObject()
            String key = r.getString("repo_key")
            o.put("repoId", r.getInt("repo_id"))
            o.put("repoKey", key)
            o.put("ownerHandle", key != null && key.contains("/") ? key.substring(0, key.indexOf("/")) : null)
            o.put("repoName", r.getString("name"))
            o.put("visibility", r.getString("visibility"))
            o.put("revision", r.getInt("revision"))
            o.put("message", r.getString("message"))
            o.put("commitTs", r.getLong("commit_ts"))
            o.put("changedCount", r.getLong("changed_count"))
            activity.put(o)
        }
        outjson.put("activity", activity)

        // Commits-per-week for the last WEEKS weeks (item: header sparkline).  Same
        // visibility rules as the commit stats above.  Every week bucket is emitted,
        // including zero weeks, so the UI never has to reconstruct the timeline.
        final int WEEKS = 26
        final long WEEK_MS = 7L * 24L * 60L * 60L * 1000L
        long nowMs = System.currentTimeMillis()
        // Anchor the most recent bucket to the start of the current week (Monday 00:00 UTC-ish).
        long weekStart = nowMs - (nowMs % WEEK_MS)
        long rangeStart = weekStart - (WEEKS - 1) * WEEK_MS
        long[] weekCounts = new long[WEEKS]
        List<Record> weekly = db.fetchAll("""select coalesce(cc.commit_ts, ae.event_ts) as ts
                from access_event ae
                join repository r on r.repo_id = ae.repo_id
                left join commit_cache cc on cc.repo_id = ae.repo_id and cc.revision = ae.revision
                where ae.user_id = ? and ae.action = 'commit' and """ + activityVisibility + """
                and coalesce(cc.commit_ts, ae.event_ts) >= ?""", personId, rangeStart)
        for (Record w : weekly) {
            Long ts = w.getLong("ts")
            if (ts == null)
                continue
            int idx = (int) ((ts - rangeStart) / WEEK_MS)
            if (idx < 0)
                idx = 0
            if (idx >= WEEKS)
                idx = WEEKS - 1
            weekCounts[idx] = weekCounts[idx] + 1
        }
        JSONArray weeklyActivity = new JSONArray()
        for (int i = 0; i < WEEKS; i++) {
            JSONObject wk = new JSONObject()
            wk.put("weekStartTs", rangeStart + i * WEEK_MS)
            wk.put("count", weekCounts[i])
            weeklyActivity.put(wk)
        }
        outjson.put("weeklyActivity", weeklyActivity)

        // Top repositories by THIS person's commit count (item: side-rail widget).
        // Same visibility rules; group by repo and take the busiest few.
        List<Record> tops = db.fetchAll(5, """select r.repo_id, r.repo_key, r.name,
                count(distinct ae.revision) as commit_count
                from access_event ae
                join repository r on r.repo_id = ae.repo_id
                where ae.user_id = ? and ae.action = 'commit' and """ + activityVisibility + """
                group by r.repo_id, r.repo_key, r.name
                order by commit_count desc, r.name""", personId)
        JSONArray topRepos = new JSONArray()
        for (Record r : tops) {
            JSONObject o = new JSONObject()
            String key = r.getString("repo_key")
            o.put("repoId", r.getInt("repo_id"))
            o.put("repoKey", key)
            o.put("repoName", r.getString("name"))
            o.put("commitCount", r.getLong("commit_count"))
            topRepos.put(o)
        }
        outjson.put("topRepos", topRepos)
    }

    // ---------------------------------------------------------------- helpers

    private static String likeOf(JSONObject injson) {
        String q = injson.getString("query", "")
        q = q == null ? "" : q.trim().toLowerCase()
        return "%" + q + "%"
    }

    private static Integer uid(ProcessServlet servlet) {
        def ud = servlet.getUserData()
        return ud == null ? null : (Integer) ud.getUserId()
    }

    private static int pageSizeOf(JSONObject injson) {
        int n = injson.getInt("pageSize", DEFAULT_PAGE_SIZE)
        if (n < 1)
            n = DEFAULT_PAGE_SIZE
        if (n > MAX_PAGE_SIZE)
            n = MAX_PAGE_SIZE
        return n
    }

    private static void putPage(JSONObject outjson, String key, JSONArray rows, long total, int page, int pageSize) {
        outjson.put(key, rows)
        outjson.put("total", total)
        outjson.put("page", page)
        outjson.put("pageSize", pageSize)
    }

    /** Repo summary JSON shared by searchRepos and getProfile.  ownerHandle is the repo_key prefix. */
    private static JSONObject repoJson(Record r, String base) {
        JSONObject o = new JSONObject()
        String key = r.getString("repo_key")
        o.put("repoId", r.getInt("repo_id"))
        o.put("repoKey", key)
        o.put("ownerHandle", key != null && key.contains("/") ? key.substring(0, key.indexOf("/")) : null)
        o.put("name", r.getString("name"))
        o.put("description", r.getString("description"))
        o.put("visibility", r.getString("visibility"))
        o.put("headRevision", r.getInt("head_revision"))
        o.put("headRevisionTs", r.getLong("head_revision_ts"))
        o.put("createdTs", r.getLong("created_ts"))
        o.put("checkoutUrl", (base ? base : "") + "/" + key)
        return o
    }

    private static String baseUrl() {
        String b = MainServlet.getEnvironment("SvnBaseUrl")
        return b == null ? "" : b.replaceAll('/$', '')
    }
}
