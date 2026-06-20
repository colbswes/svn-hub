package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.RepoAccess
import com.svnhub.SvnRepo
import java.time.Instant
import java.time.ZoneId

/**
 * The SvnHub statistics differentiator: per-user checkout/update insight that
 * GitHub's anonymous traffic numbers cannot provide.  Reads the access_event
 * firehose, the daily rollups, and working_copy_state.
 *
 * Pass repoId to scope to one repository (requires read access); omit it (0)
 * for a cross-repository view (requires admin).
 */
class StatsService {

    /** Headline numbers for a repository. */
    void repoSummary(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        Record r = db.fetchOne("select name, head_revision from repository where repo_id = ?", repoId)
        JSONObject byCat = new JSONObject()
        Record agg = db.fetchOne("""select
                coalesce(sum(checkout_count),0) as c, coalesce(sum(update_count),0) as u,
                coalesce(sum(switch_count),0) as s,  coalesce(sum(browse_count),0) as b,
                coalesce(sum(commit_count),0) as k,  coalesce(sum(other_count),0) as o
                from access_daily_rollup where repo_id = ?""", repoId)
        byCat.put("checkout", agg.getLong("c"))
        byCat.put("update", agg.getLong("u"))
        byCat.put("switch", agg.getLong("s"))
        byCat.put("browse", agg.getLong("b"))
        byCat.put("commit", agg.getLong("k"))
        byCat.put("other", agg.getLong("o"))
        outjson.put("name", r?.getString("name"))
        outjson.put("headRevision", r?.getInt("head_revision"))
        outjson.put("byCategory", byCat)
        outjson.put("distinctUsers", db.fetchOne("select count(distinct user_id) as n from access_event where repo_id = ? and user_id is not null", repoId).getLong("n"))
        outjson.put("distinctClients", db.fetchOne("select count(distinct client_host) as n from access_event where repo_id = ?", repoId).getLong("n"))
        outjson.put("totalEvents", db.fetchOne("select count(*) as n from access_event where repo_id = ?", repoId).getLong("n"))
    }

    /** Flagship: each developer's working copy, how many revisions behind HEAD. */
    void freshness(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        JSONArray rows = db.fetchAllJSON("""select
                coalesce(u.user_name, w.raw_user) as "userName",
                w.last_synced_revision as "lastSyncedRevision",
                r.head_revision as "headRevision",
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind",
                w.last_sync_ts as "lastSyncTs",
                w.last_any_activity_ts as "lastActivityTs"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where w.repo_id = ?
                order by "revisionsBehind" desc, "userName" """, repoId)
        outjson.put("rows", rows)
    }

    /** Checkout vs update counts per user (a high checkout ratio = re-cloning). */
    void checkoutVsUpdate(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        JSONArray rows = db.fetchAllJSON("""select
                coalesce(u.user_name, '(unmapped)') as "userName",
                sum(d.checkout_count) as "checkouts",
                sum(d.update_count) as "updates"
                from access_daily_rollup d
                left join users u on u.user_id = d.user_id
                where d.repo_id = ?
                group by u.user_name
                order by "checkouts" desc, "updates" desc""", repoId)
        outjson.put("rows", rows)
    }

    /** Reads and writes per day (line chart). */
    void activityByDay(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        JSONArray rows = db.fetchAllJSON("""select event_day as "day",
                sum(case when verb_class='read'  then 1 else 0 end) as "reads",
                sum(case when verb_class='write' then 1 else 0 end) as "writes"
                from access_event where repo_id = ?
                group by event_day order by event_day""", repoId)
        outjson.put("rows", rows)
    }

    /** Most-fetched paths (read hotspots). */
    void hotPaths(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        int limit = injson.getInt("limit", 20)
        JSONArray rows = db.fetchAllJSON(limit, """select path as "path", count(*) as "hits"
                from access_event
                where repo_id = ? and path is not null and verb_class = 'read'
                group by path order by count(*) desc""", repoId)
        outjson.put("rows", rows)
    }

    /** Working copies not touched in `days` days (abandonment detection). */
    void staleWorkingCopies(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        int days = injson.getInt("days", 14)
        long cutoff = System.currentTimeMillis() - days * 86400000L
        JSONArray rows = db.fetchAllJSON("""select
                coalesce(u.user_name, w.raw_user) as "userName",
                w.last_any_activity_ts as "lastActivityTs",
                w.last_synced_revision as "lastSyncedRevision",
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where w.repo_id = ? and coalesce(w.last_any_activity_ts,0) < ?
                order by w.last_any_activity_ts""", repoId, cutoff)
        outjson.put("rows", rows)
        outjson.put("days", days)
    }

    /** Read load by client host (separate CI machines from humans). */
    void clientLoad(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        JSONArray rows = db.fetchAllJSON("""select client_host as "clientHost", count(*) as "events"
                from access_event where repo_id = ?
                group by client_host order by count(*) desc""", repoId)
        outjson.put("rows", rows)
    }

    /** How many distinct users have pulled at or past a given revision. */
    void revisionAdoption(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        int rev = injson.getInt("revision")
        long adopters = db.fetchOne("""select count(distinct user_id) as n from access_event
                where repo_id = ? and user_id is not null and revision >= ? and verb_class = 'read'""", repoId, rev).getLong("n")
        long total = db.fetchOne("select count(distinct user_id) as n from working_copy_state where repo_id = ? and user_id is not null", repoId).getLong("n")
        outjson.put("revision", rev)
        outjson.put("adopters", adopters)
        outjson.put("totalUsers", total)
    }

    /** Read-activity heatmap: counts bucketed by day-of-week (1=Mon..7=Sun) and hour. */
    void heatmap(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        List<Record> recs = db.fetchAll("select event_ts from access_event where repo_id = ? and verb_class = 'read'", repoId)
        int[][] grid = new int[8][24]
        ZoneId zone = ZoneId.systemDefault()
        for (Record r : recs) {
            Long ts = r.getLong("event_ts")
            if (ts == null)
                continue
            def ldt = Instant.ofEpochMilli(ts).atZone(zone)
            int dow = ldt.getDayOfWeek().getValue()   // 1..7
            int hour = ldt.getHour()
            grid[dow][hour]++
        }
        JSONArray cells = new JSONArray()
        for (int d = 1; d <= 7; d++)
            for (int h = 0; h < 24; h++)
                if (grid[d][h] > 0) {
                    JSONObject c = new JSONObject()
                    c.put("dow", d)
                    c.put("hour", h)
                    c.put("count", grid[d][h])
                    cells.put(c)
                }
        outjson.put("cells", cells)
    }

    /**
     * Everything the Insights screen shows for one repository over an inclusive
     * date range (beginDay/endDay as YYYYMMDD).  Repository facts (created, last
     * commit, current revision, size, file count, branches, tags, clones) are
     * point-in-time; the activity counts (checkouts/updates/commits and the
     * distinct users behind them) honor the date range.
     */
    void insights(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        String fsPath = RepoAccess.fsPath(db, repoId)
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        long head = SvnRepo.getLatestRevision(fsPath)

        // ---- repository facts (point-in-time) ----
        outjson.put("headRevision", (int) head)
        long created = SvnRepo.getRevisionDate(fsPath, 0L)
        long lastCommit = SvnRepo.getRevisionDate(fsPath, head)
        if (created >= 0)
            outjson.put("createdTs", created)
        if (lastCommit >= 0)
            outjson.put("lastCommitTs", lastCommit)
        outjson.put("sizeBytes", new File(fsPath).directorySize())
        outjson.put("fileCount", SvnRepo.countFiles(fsPath, head))

        JSONArray branches = listChildren(fsPath, "branches", head)
        JSONArray tags = listChildren(fsPath, "tags", head)
        outjson.put("branchCount", branches.length())
        outjson.put("tagCount", tags.length())
        outjson.put("branches", branches)
        outjson.put("tags", tags)

        // ---- activity in the inclusive date range (portable conditional aggregation) ----
        Record a = db.fetchOne("""select
                sum(case when action='checkout-or-export' then 1 else 0 end) as checkouts,
                sum(case when action='update' then 1 else 0 end) as updates,
                sum(case when action='commit' then 1 else 0 end) as commits,
                count(distinct case when action='checkout-or-export' then user_id end) as u_checkout,
                count(distinct case when action='update' then user_id end) as u_update,
                count(distinct case when action='commit' then user_id end) as u_commit
                from access_event
                where repo_id = ? and event_day >= ? and event_day <= ?""", repoId, beginDay, endDay)
        outjson.put("checkouts", a.getLong("checkouts") ?: 0L)
        outjson.put("updates", a.getLong("updates") ?: 0L)
        outjson.put("commits", a.getLong("commits") ?: 0L)
        outjson.put("uniqueCheckoutUsers", a.getLong("u_checkout") ?: 0L)
        outjson.put("uniqueUpdateUsers", a.getLong("u_update") ?: 0L)
        outjson.put("uniqueCommitUsers", a.getLong("u_commit") ?: 0L)

        // ---- clones: all-time working copies, one per (user, client host) that has checked out ----
        List<Record> crecs = db.fetchAll("""select ae.user_id as uid, ae.client_host as host,
                max(u.user_name) as user_name, max(ae.raw_user) as raw_user,
                min(case when ae.action='checkout-or-export' then ae.event_ts end) as cloned_ts,
                max(case when ae.action in ('checkout-or-export','update','switch') then ae.revision end) as synced_rev,
                max(ae.event_ts) as last_ts
                from access_event ae left join users u on u.user_id = ae.user_id
                where ae.repo_id = ?
                group by ae.user_id, ae.client_host
                having sum(case when ae.action='checkout-or-export' then 1 else 0 end) > 0
                order by ae.user_id""", repoId)
        JSONArray clones = new JSONArray()
        for (Record r : crecs) {
            JSONObject o = new JSONObject()
            String uname = r.getString("user_name") ?: (r.getString("raw_user") ?: "(anonymous)")
            o.put("username", uname)
            o.put("clientHost", r.getString("host"))
            o.put("clonedTs", r.getLong("cloned_ts"))
            o.put("lastTs", r.getLong("last_ts"))
            Integer synced = r.getInt("synced_rev")
            o.put("syncedRevision", synced)
            if (synced != null) {
                int diff = (int) head - synced
                o.put("behind", diff)
                o.put("direction", diff > 0 ? "behind" : (diff < 0 ? "ahead" : "even"))
            }
            clones.put(o)
        }
        outjson.put("cloneCount", clones.length())
        outjson.put("clones", clones)
    }

    /** Branch/tag listing: immediate sub-directories of {@code dir} at a revision. */
    private static JSONArray listChildren(String fsPath, String dir, long rev) {
        JSONArray arr = new JSONArray()
        try {
            if (SvnRepo.nodeKind(fsPath, dir, rev) != "dir")
                return arr
            List entries = SvnRepo.listDir(fsPath, dir, rev)
            for (Object o : entries) {
                Map e = (Map) o
                if (e.get("kind") != "dir")
                    continue
                JSONObject j = new JSONObject()
                j.put("name", e.get("name"))
                j.put("revision", e.get("revision"))
                j.put("author", e.get("author"))
                j.put("date", e.get("date"))
                arr.put(j)
            }
        } catch (ignored) {
        }
        return arr
    }

    // ---------------------------------------------------------------- helpers

    /** Resolve and authorize the repo scope.  repoId>0 -> that repo (read); else admin-only cross-repo. */
    private static int scope(JSONObject injson, Connection db, ProcessServlet servlet) {
        Integer userId = (Integer) servlet.getUserData().getUserId()
        int repoId = injson.getInt("repoId", 0)
        if (repoId > 0) {
            RepoAccess.requireRead(db, userId, repoId)
            return repoId
        }
        throw new UserException("repoId is required.")
    }
}
