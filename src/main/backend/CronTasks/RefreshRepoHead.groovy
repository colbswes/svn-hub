package CronTasks

import org.kissweb.database.Connection
import org.kissweb.database.Record
import com.svnhub.SvnRepo
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger

/**
 * Periodically refresh each repository's cached HEAD revision and warm the
 * commit_cache with any newly-committed revisions (metadata + changed paths).
 *
 * Bounded to a fixed number of new revisions per repo per run so a large
 * backlog is filled in over several runs rather than one long transaction.
 */
class RefreshRepoHead {

    private static final Logger logger = LogManager.getLogger(RefreshRepoHead.class)
    private static boolean warnedNoDb = false

    static final int MAX_REVS_PER_RUN = 200

    static void start(Object obj) {
        Connection db = (Connection) obj
        if (db == null) {
            if (!warnedNoDb) {
                warnedNoDb = true
                logger.warn("RefreshRepoHead idle: no database configured. Copy src/main/backend/application.template.ini to application.ini, set the Database* keys, and restart. (Shown once.)")
            }
            return
        }
        long now = System.currentTimeMillis()
        List<Record> repos = db.fetchAll("select * from repository where is_active = 'Y'")
        for (Record r : repos) {
            int repoId = r.getInt("repo_id")
            String fsPath = r.getString("fs_path")
            long head
            try {
                head = SvnRepo.getLatestRevision(fsPath)
            } catch (ignored) {
                continue
            }
            Integer cachedHead = r.getInt("head_revision")
            if (cachedHead == null || cachedHead != (int) head) {
                r.set("head_revision", (int) head)
                r.set("head_revision_ts", now)
                r.update()
            }
            warmCommitCache(db, repoId, fsPath, (int) head)
        }
    }

    private static void warmCommitCache(Connection db, int repoId, String fsPath, int head) {
        Record mx = db.fetchOne("select max(revision) as mx from commit_cache where repo_id = ?", repoId)
        int from = 1
        if (mx != null && mx.getInt("mx") != null)
            from = mx.getInt("mx") + 1
        int to = head
        if (to < from)
            return
        if (to - from + 1 > MAX_REVS_PER_RUN)
            to = from + MAX_REVS_PER_RUN - 1
        for (int rev = from; rev <= to; rev++) {
            List entries = SvnRepo.log(fsPath, "", (long) rev, (long) rev, 1, true)
            if (entries.isEmpty())
                continue
            Map e = (Map) entries.get(0)
            Record c = db.newRecord("commit_cache")
            c.set("repo_id", repoId)
            c.set("revision", rev)
            c.set("author", e.get("author"))
            c.set("commit_ts", e.get("date"))
            c.set("message", trunc((String) e.get("message"), 4000))
            int changed = e.get("changedCount") == null ? 0 : ((Number) e.get("changedCount")).intValue()
            c.set("changed_count", changed)
            int commitId = ((Number) c.addRecordAutoInc()).intValue()
            List paths = (List) e.get("paths")
            if (paths != null) {
                for (Object po : paths) {
                    Map p = (Map) po
                    Record cp = db.newRecord("commit_cache_path")
                    cp.set("commit_id", commitId)
                    cp.set("change_type", normType((String) p.get("type")))
                    cp.set("path", trunc((String) p.get("path"), 1000))
                    cp.set("copy_from_path", p.get("copyFromPath"))
                    Object cfr = p.get("copyFromRev")
                    if (cfr != null && ((Number) cfr).intValue() >= 0)
                        cp.set("copy_from_rev", ((Number) cfr).intValue())
                    cp.addRecord()
                }
            }
        }
    }

    private static String normType(String t) {
        if (t == null || t.isEmpty())
            return "M"
        String c = t.substring(0, 1).toUpperCase()
        if (c == "A" || c == "M" || c == "D" || c == "R")
            return c
        return "M"
    }

    private static String trunc(String s, int max) {
        if (s == null)
            return null
        return s.length() <= max ? s : s.substring(0, max)
    }
}
