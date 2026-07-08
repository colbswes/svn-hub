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
                coalesce(u.full_name, u.handle, w.raw_user, '(anonymous)') as "userName",
                w.last_synced_revision as "lastSyncedRevision",
                r.head_revision as "headRevision",
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind",
                w.last_client_host as "clientHost",
                w.last_sync_ts as "lastSyncTs",
                w.last_any_activity_ts as "lastActivityTs"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where w.repo_id = ? and w.last_synced_revision is not null
                order by "revisionsBehind" desc, "userName" """, repoId)
        outjson.put("rows", rows)
    }

    /** Checkout vs update counts per user (a high checkout ratio = re-cloning). */
    void checkoutVsUpdate(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        JSONArray rows = db.fetchAllJSON("""select
                coalesce(u.user_name, 'Unknown user') as "userName",
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

    /** Top contributors within an inclusive date range (commits, checkouts, updates). */
    void contributors(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        int limit = injson.getInt("limit", 8)
        JSONArray rows = db.fetchAllJSON(limit, """select
                coalesce(u.full_name, u.handle, ae.raw_user, 'Unknown contributor') as "userName",
                coalesce(u.handle, ae.raw_user) as "handle",
                sum(case when ae.action='commit' then 1 else 0 end) as "commits",
                sum(case when ae.action='checkout-or-export' then 1 else 0 end) as "checkouts",
                sum(case when ae.action='update' then 1 else 0 end) as "updates",
                count(*) as "events"
                from access_event ae
                left join users u on u.user_id = ae.user_id
                where ae.repo_id = ? and ae.event_day >= ? and ae.event_day <= ?
                group by u.full_name, u.handle, ae.raw_user
                having sum(case when ae.action='commit' then 1 else 0 end) > 0
                order by "commits" desc, "events" desc""", repoId, beginDay, endDay)
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
                coalesce(u.user_name, w.raw_user, '(anonymous)') as "userName",
                w.last_any_activity_ts as "lastActivityTs",
                w.last_synced_revision as "lastSyncedRevision",
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where w.repo_id = ? and w.last_synced_revision is not null and coalesce(w.last_any_activity_ts,0) < ?
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

    /**
     * Full activity detail for one repository over an inclusive day range.
     * This collects the smaller activity/clone endpoints into one payload for
     * the Insights page, while still reading only the existing event/rollup/WC
     * tables.
     */
    void activityDetail(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        int staleDays = injson.getInt("staleDays", 14)
        int limit = injson.getInt("limit", 12)
        Record repo = db.fetchOne("select head_revision from repository where repo_id = ?", repoId)
        int head = repo?.getInt("head_revision") ?: 0

        putActivityDetail(outjson, db,
                "d.repo_id = ?", "ae.repo_id = ?", "w.repo_id = ?",
                [repoId], beginDay, endDay, staleDays, limit)

        JSONObject ad = new JSONObject()
        long adopters = db.fetchOne("""select count(distinct user_id) as n from access_event
                where repo_id = ? and user_id is not null and revision >= ? and verb_class = 'read'""", repoId, head).getLong("n")
        long total = db.fetchOne("select count(distinct user_id) as n from working_copy_state where repo_id = ? and user_id is not null", repoId).getLong("n")
        ad.put("revision", head)
        ad.put("adopters", adopters)
        ad.put("totalUsers", total)
        outjson.put("revisionAdoption", ad)
    }

    /** Read-activity heatmap: counts bucketed by day-of-week (1=Mon..7=Sun) and hour. */
    void heatmap(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        List<Record> recs = db.fetchAll("select event_ts from access_event where repo_id = ? and verb_class = 'read'", repoId)
        outjson.put("cells", heatmapCells(recs))
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

    /**
     * Public-safe repository facts for the repository page side rail.  This keeps
     * anonymous public pages from exposing per-user/client activity details.
     */
    void repoFacts(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        int repoId = scope(injson, db, servlet)
        String fsPath = RepoAccess.fsPath(db, repoId)
        long head = SvnRepo.getLatestRevision(fsPath)

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

    /**
     * Cross-repository footprint for the CURRENT user (no admin required):
     * how many repositories they own, and their own commit/checkout activity
     * across every repository.  Backs the account page and profile stat blocks.
     */
    void userSummary(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        Record repos = db.fetchOne("select count(*) as n, coalesce(sum(head_revision),0) as revs from repository where owner_id = ? and is_active = 'Y'", userId)
        Record a = db.fetchOne("""select
                sum(case when action='commit' then 1 else 0 end) as commits,
                sum(case when action='checkout-or-export' then 1 else 0 end) as checkouts,
                count(distinct repo_id) as active_repos,
                count(*) as events
                from access_event where user_id = ?""", userId)
        outjson.put("reposOwned", repos.getLong("n"))
        outjson.put("totalRevisions", repos.getLong("revs"))
        outjson.put("commits", a.getLong("commits") ?: 0L)
        outjson.put("checkouts", a.getLong("checkouts") ?: 0L)
        outjson.put("activeRepos", a.getLong("active_repos") ?: 0L)
        outjson.put("events", a.getLong("events") ?: 0L)
    }

    /**
     * Day-bucketed commit counts for the last `days` days (default 30) across
     * every repository the current user owns.  Backs the dashboard's compact
     * commit-activity chart.  Days with no commits are returned with a zero
     * count so the series is contiguous.
     */
    void userCommitSeries(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int days = injson.getInt("days", 30)
        if (days < 1)
            days = 30
        if (days > 365)
            days = 365
        long cutoff = System.currentTimeMillis() - (long) days * 86400000L
        List<Record> recs = db.fetchAll("""select c.commit_ts from commit_cache c
                join repository r on r.repo_id = c.repo_id
                where r.owner_id = ? and r.is_active = 'Y' and c.commit_ts >= ?""", userId, cutoff)
        ZoneId zone = ZoneId.systemDefault()
        Map<Integer, Integer> counts = [:]
        for (Record r : recs) {
            Long ts = r.getLong("commit_ts")
            if (ts == null)
                continue
            def d = Instant.ofEpochMilli(ts).atZone(zone)
            int day = d.getYear() * 10000 + d.getMonthValue() * 100 + d.getDayOfMonth()
            counts[day] = (counts[day] ?: 0) + 1
        }
        def today = Instant.ofEpochMilli(System.currentTimeMillis()).atZone(zone).toLocalDate()
        JSONArray rows = new JSONArray()
        for (int i = days - 1; i >= 0; i--) {
            def d = today.minusDays(i)
            int day = d.getYear() * 10000 + d.getMonthValue() * 100 + d.getDayOfMonth()
            JSONObject o = new JSONObject()
            o.put("day", day)
            o.put("commits", counts[day] ?: 0)
            rows.put(o)
        }
        outjson.put("rows", rows)
        outjson.put("days", days)
    }

    /**
     * Working-copy freshness summary across the current user's OWNED
     * repositories: headline counts plus the most stale copies (each row
     * carries the repo ids so the UI can click through to the repository).
     * Backs the dashboard's "Working copies" panel.
     */
    void userWorkingCopySummary(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int limit = injson.getInt("limit", 5)
        if (limit < 1)
            limit = 5
        if (limit > 20)
            limit = 20
        int behindThreshold = injson.getInt("behindThreshold", 10)
        if (behindThreshold < 1)
            behindThreshold = 10
        Record agg = db.fetchOne("""select count(*) as total,
                sum(case when (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) >= ? then 1 else 0 end) as stale
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                where r.owner_id = ? and r.is_active = 'Y' and w.last_synced_revision is not null""", behindThreshold, userId)
        outjson.put("totalCopies", agg.getLong("total") ?: 0L)
        outjson.put("staleCopies", agg.getLong("stale") ?: 0L)
        outjson.put("behindThreshold", behindThreshold)
        List<Record> recs = db.fetchAll(limit, """select
                coalesce(u.full_name, u.handle, w.raw_user, '(anonymous)') as user_name,
                r.repo_id, r.repo_key, r.name,
                w.last_synced_revision,
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as revisions_behind,
                w.last_sync_ts, w.last_any_activity_ts
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where r.owner_id = ? and r.is_active = 'Y' and w.last_synced_revision is not null
                order by revisions_behind desc, coalesce(w.last_any_activity_ts,0)""", userId)
        JSONArray rows = new JSONArray()
        for (Record r : recs) {
            JSONObject o = new JSONObject()
            o.put("userName", r.getString("user_name"))
            o.put("repoId", r.getInt("repo_id"))
            o.put("repoKey", r.getString("repo_key"))
            o.put("repoName", r.getString("name"))
            o.put("lastSyncedRevision", r.getInt("last_synced_revision"))
            o.put("revisionsBehind", r.getInt("revisions_behind") ?: 0)
            o.put("lastSyncTs", r.getLong("last_sync_ts"))
            o.put("lastActivityTs", r.getLong("last_any_activity_ts"))
            rows.put(o)
        }
        outjson.put("rows", rows)
    }

    // ----- Aggregated views across the current user's OWNED repositories -----
    // These power the "All repositories" Insights view.  Same result shapes as
    // their per-repo counterparts so the frontend reuses the same renderers.

    /** Headline numbers across all owned repositories over an inclusive day range. */
    void aggSummary(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        Record repos = db.fetchOne("select count(*) as n, coalesce(sum(head_revision),0) as revs from repository where owner_id = ? and is_active = 'Y'", userId)
        Record a = db.fetchOne("""select
                sum(case when action='commit' then 1 else 0 end) as commits,
                sum(case when action='checkout-or-export' then 1 else 0 end) as checkouts,
                count(distinct case when action='commit' then user_id end) as u_commit
                from access_event
                where repo_id in (select repo_id from repository where owner_id = ? and is_active='Y')
                  and event_day >= ? and event_day <= ?""", userId, beginDay, endDay)
        long copies = db.fetchOne("select count(*) as n from working_copy_state where last_synced_revision is not null and repo_id in (select repo_id from repository where owner_id = ? and is_active='Y')", userId).getLong("n")
        outjson.put("repoCount", repos.getLong("n"))
        outjson.put("totalRevisions", repos.getLong("revs"))
        outjson.put("commits", a.getLong("commits") ?: 0L)
        outjson.put("checkouts", a.getLong("checkouts") ?: 0L)
        outjson.put("uniqueCommitUsers", a.getLong("u_commit") ?: 0L)
        outjson.put("cloneCount", copies)
    }

    /** Reads/writes per day summed across all owned repositories. */
    void aggActivityByDay(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        JSONArray rows = db.fetchAllJSON("""select event_day as "day",
                sum(case when verb_class='read'  then 1 else 0 end) as "reads",
                sum(case when verb_class='write' then 1 else 0 end) as "writes"
                from access_event
                where repo_id in (select repo_id from repository where owner_id = ? and is_active='Y')
                group by event_day order by event_day""", userId)
        outjson.put("rows", rows)
    }

    /** Top contributors across all owned repositories over an inclusive day range. */
    void aggContributors(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        int limit = injson.getInt("limit", 8)
        JSONArray rows = db.fetchAllJSON(limit, """select
                coalesce(u.full_name, u.handle, ae.raw_user, 'Unknown contributor') as "userName",
                coalesce(u.handle, ae.raw_user) as "handle",
                sum(case when ae.action='commit' then 1 else 0 end) as "commits",
                sum(case when ae.action='checkout-or-export' then 1 else 0 end) as "checkouts",
                sum(case when ae.action='update' then 1 else 0 end) as "updates",
                count(*) as "events"
                from access_event ae
                left join users u on u.user_id = ae.user_id
                where ae.repo_id in (select repo_id from repository where owner_id = ? and is_active='Y')
                  and ae.event_day >= ? and ae.event_day <= ?
                group by u.full_name, u.handle, ae.raw_user
                having sum(case when ae.action='commit' then 1 else 0 end) > 0
                order by "commits" desc, "events" desc""", userId, beginDay, endDay)
        outjson.put("rows", rows)
    }

    /** Working-copy freshness across all owned repositories (includes repo name). */
    void aggFreshness(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        JSONArray rows = db.fetchAllJSON("""select
                coalesce(u.full_name, u.handle, w.raw_user, '(anonymous)') as "userName",
                r.name as "repoName",
                w.last_synced_revision as "lastSyncedRevision",
                r.head_revision as "headRevision",
                (coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind",
                w.last_client_host as "clientHost",
                w.last_sync_ts as "lastSyncTs",
                w.last_any_activity_ts as "lastActivityTs"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where r.owner_id = ? and r.is_active='Y' and w.last_synced_revision is not null
                order by "revisionsBehind" desc, "userName" """, userId)
        outjson.put("rows", rows)
    }

    /** Full activity detail across all repositories owned by the current user. */
    void aggActivityDetail(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        if (userId == null)
            throw new UserException("Not signed in.")
        int beginDay = injson.getInt("beginDay")
        int endDay = injson.getInt("endDay")
        int staleDays = injson.getInt("staleDays", 14)
        int limit = injson.getInt("limit", 12)
        String owned = "select repo_id from repository where owner_id = ? and is_active = 'Y'"
        putActivityDetail(outjson, db,
                "d.repo_id in (" + owned + ")",
                "ae.repo_id in (" + owned + ")",
                "w.repo_id in (" + owned + ")",
                [userId], beginDay, endDay, staleDays, limit)
    }

    // ---------------------------------------------------------------- helpers

    private static void putActivityDetail(JSONObject outjson, Connection db,
                                          String rollupWhere, String eventWhere, String wcWhere,
                                          List baseParams, int beginDay, int endDay, int staleDays, int limit) {
        List rollParams = []
        rollParams.addAll(baseParams)
        rollParams.add(beginDay)
        rollParams.add(endDay)
        Record cat = db.fetchOne("""select
                coalesce(sum(checkout_count),0) as checkout,
                coalesce(sum(update_count),0) as update,
                coalesce(sum(switch_count),0) as switch,
                coalesce(sum(browse_count),0) as browse,
                coalesce(sum(commit_count),0) as commit,
                coalesce(sum(other_count),0) as other,
                coalesce(sum(total_bytes),0) as bytes
                from access_daily_rollup d
                where """ + rollupWhere + " and d.event_day >= ? and d.event_day <= ?", *rollParams)
        JSONObject byCat = new JSONObject()
        byCat.put("checkout", cat.getLong("checkout") ?: 0L)
        byCat.put("update", cat.getLong("update") ?: 0L)
        byCat.put("switch", cat.getLong("switch") ?: 0L)
        byCat.put("browse", cat.getLong("browse") ?: 0L)
        byCat.put("commit", cat.getLong("commit") ?: 0L)
        byCat.put("other", cat.getLong("other") ?: 0L)
        byCat.put("bytes", cat.getLong("bytes") ?: 0L)
        outjson.put("byCategory", byCat)

        List eventParams = []
        eventParams.addAll(baseParams)
        eventParams.add(beginDay)
        eventParams.add(endDay)
        Record totals = db.fetchOne("""select count(*) as events,
                count(distinct user_id) as users,
                count(distinct client_host) as clients,
                coalesce(sum(bytes),0) as bytes
                from access_event ae
                where """ + eventWhere + " and ae.event_day >= ? and ae.event_day <= ?", *eventParams)
        outjson.put("totalEvents", totals.getLong("events") ?: 0L)
        outjson.put("distinctUsers", totals.getLong("users") ?: 0L)
        outjson.put("distinctClients", totals.getLong("clients") ?: 0L)
        outjson.put("bytes", totals.getLong("bytes") ?: 0L)

        outjson.put("checkoutVsUpdate", db.fetchAllJSON(limit, """select
                coalesce(u.full_name, u.handle, 'Unknown user') as "userName",
                coalesce(u.handle, 'Unknown user') as "handle",
                sum(d.checkout_count) as "checkouts",
                sum(d.update_count) as "updates",
                sum(d.switch_count) as "switches",
                sum(d.commit_count) as "commits",
                sum(d.checkout_count + d.update_count + d.switch_count + d.browse_count + d.commit_count + d.other_count) as "events"
                from access_daily_rollup d
                left join users u on u.user_id = d.user_id
                where """ + rollupWhere + """ and d.event_day >= ? and d.event_day <= ?
                group by u.full_name, u.handle
                order by "checkouts" desc, "updates" desc, "events" desc""", *rollParams))

        outjson.put("hotPaths", db.fetchAllJSON(limit, """select ae.path as "path",
                count(*) as "hits", coalesce(sum(ae.bytes),0) as "bytes",
                max(ae.event_ts) as "lastTs"
                from access_event ae
                where """ + eventWhere + """ and ae.event_day >= ? and ae.event_day <= ?
                  and ae.path is not null and ae.verb_class = 'read'
                group by ae.path
                order by count(*) desc, coalesce(sum(ae.bytes),0) desc""", *eventParams))

        outjson.put("clientLoad", db.fetchAllJSON(limit, """select ae.client_host as "clientHost",
                count(*) as "events",
                sum(case when ae.verb_class='read' then 1 else 0 end) as "reads",
                sum(case when ae.verb_class='write' then 1 else 0 end) as "writes",
                coalesce(sum(ae.bytes),0) as "bytes",
                max(ae.event_ts) as "lastTs"
                from access_event ae
                where """ + eventWhere + """ and ae.event_day >= ? and ae.event_day <= ?
                group by ae.client_host
                order by count(*) desc""", *eventParams))

        outjson.put("cloneActivity", db.fetchAllJSON(limit, """select
                max(r.name) as "repoName",
                coalesce(max(u.full_name), max(u.handle), max(ae.raw_user), '(anonymous)') as "userName",
                ae.client_host as "clientHost",
                min(case when ae.action='checkout-or-export' then ae.event_ts end) as "clonedTs",
                max(case when ae.action in ('checkout-or-export','update','switch') then ae.revision end) as "syncedRevision",
                max(ae.event_ts) as "lastTs",
                sum(case when ae.action='checkout-or-export' then 1 else 0 end) as "checkouts",
                sum(case when ae.action='update' then 1 else 0 end) as "updates",
                sum(case when ae.action='switch' then 1 else 0 end) as "switches",
                count(*) as "events"
                from access_event ae
                join repository r on r.repo_id = ae.repo_id
                left join users u on u.user_id = ae.user_id
                where """ + eventWhere + """ and ae.event_day >= ? and ae.event_day <= ?
                group by ae.repo_id, ae.user_id, ae.client_host
                having sum(case when ae.action='checkout-or-export' then 1 else 0 end) > 0
                order by "clonedTs" desc, "events" desc""", *eventParams))

        long cutoff = System.currentTimeMillis() - staleDays * 86400000L
        List staleParams = []
        staleParams.addAll(baseParams)
        staleParams.add(cutoff)
        outjson.put("staleWorkingCopies", db.fetchAllJSON(limit, """select
                max(r.name) as "repoName",
                coalesce(max(u.full_name), max(u.handle), max(w.raw_user), '(anonymous)') as "userName",
                max(w.last_client_host) as "clientHost",
                max(w.last_any_activity_ts) as "lastActivityTs",
                max(w.last_synced_revision) as "lastSyncedRevision",
                max(coalesce(r.head_revision,0) - coalesce(w.last_synced_revision,0)) as "revisionsBehind"
                from working_copy_state w
                join repository r on r.repo_id = w.repo_id
                left join users u on u.user_id = w.user_id
                where """ + wcWhere + """ and w.last_synced_revision is not null and coalesce(w.last_any_activity_ts,0) < ?
                group by w.repo_id, w.user_id
                order by max(w.last_any_activity_ts)""", *staleParams))

        List<Record> heat = db.fetchAll("select ae.event_ts from access_event ae where " + eventWhere +
                " and ae.event_day >= ? and ae.event_day <= ? and ae.verb_class = 'read'", *eventParams)
        outjson.put("heatmap", heatmapCells(heat))
        outjson.put("staleDays", staleDays)
    }

    private static JSONArray heatmapCells(List<Record> recs) {
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
        return cells
    }

    /** Resolve and authorize the repo scope.  repoId>0 -> that repo (read); else admin-only cross-repo. */
    private static int scope(JSONObject injson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId", 0)
        if (repoId > 0) {
            RepoAccess.requireRead(db, userId, repoId)
            return repoId
        }
        throw new UserException("repoId is required.")
    }

    private static Integer uid(ProcessServlet servlet) {
        def ud = servlet.getUserData()
        return ud == null ? null : (Integer) ud.getUserId()
    }
}
