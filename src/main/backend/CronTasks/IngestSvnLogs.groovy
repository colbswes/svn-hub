package CronTasks

import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.MainServlet
import com.svnhub.SvnLogParser
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger

/**
 * Ingest the svnserve --log-file into the statistics firehose.
 *
 * Incremental and idempotent:
 *   - each physical log file is tracked by inode (Files.fileKey), surviving
 *     logrotate renames;
 *   - only complete (\n-terminated) lines are processed; a partial trailing
 *     line is left for the next run (so we never advance past a half-written line);
 *   - truncation (copytruncate) is detected (size < stored offset) and re-read;
 *   - every event carries a SHA-256 event_hash with a UNIQUE index, so re-reads
 *     never double-count.
 *
 * The Kiss cron contract commits on normal return / rolls back on exception, so
 * the advanced byte_offset is committed in the same transaction as its rows.
 */
class IngestSvnLogs {

    static final int DEFAULT_MAX_LINES = 50000
    static final long MAX_BYTES_PER_RUN = 8L * 1024 * 1024

    private static final Logger logger = LogManager.getLogger(IngestSvnLogs.class)
    private static boolean warnedNoDb = false

    static void start(Object obj) {
        Connection db = (Connection) obj
        if (db == null) {
            if (!warnedNoDb) {
                warnedNoDb = true
                logger.warn("IngestSvnLogs idle: no database configured. Copy src/main/backend/application.template.ini to application.ini, set the Database* keys, and restart. (Shown once.)")
            }
            return
        }
        String logFile = MainServlet.getEnvironment("SvnLogFile")
        if (!logFile)
            return
        File active = new File(logFile)
        int maxLines = parseInt(MainServlet.getEnvironment("SvnLogMaxLinesPerRun"), DEFAULT_MAX_LINES)
        String reposRoot = MainServlet.getEnvironment("SvnReposRoot")

        List<File> files = []
        if (active.exists())
            files.add(active)
        String glob = MainServlet.getEnvironment("SvnLogRotateGlob")
        if (glob && active.getParentFile() != null) {
            String regex = globToRegex(glob)
            File[] sibs = active.getParentFile().listFiles()
            if (sibs != null)
                for (File f : sibs)
                    if (f.isFile() && !f.getName().endsWith(".gz") && f.getName().matches(regex)
                            && f.getAbsolutePath() != active.getAbsolutePath())
                        files.add(f)
        }

        Map<String, Integer> userCache = [:]
        Map<String, Integer> repoCache = [:]
        for (File f : files)
            ingestFile(db, f, maxLines, reposRoot, userCache, repoCache)
    }

    private static void ingestFile(Connection db, File f, int maxLines, String reposRoot,
                                   Map<String, Integer> userCache, Map<String, Integer> repoCache) {
        Path path = f.toPath()
        String inode
        try {
            BasicFileAttributes at = Files.readAttributes(path, BasicFileAttributes.class)
            inode = String.valueOf(at.fileKey())
        } catch (ignored) {
            return
        }
        Record state = db.fetchOne("select * from log_ingest_state where source = 'svnserve' and inode = ?", inode)
        long offset = state != null ? state.getLong("byte_offset") : 0L
        long size = f.length()
        if (size < offset)            // truncated in place (copytruncate)
            offset = 0L
        if (size <= offset)
            return                    // nothing new

        long avail = Math.min(size - offset, MAX_BYTES_PER_RUN)
        byte[] buf = new byte[(int) avail]
        RandomAccessFile raf = new RandomAccessFile(f, "r")
        try {
            raf.seek(offset)
            raf.readFully(buf)
        } finally {
            raf.close()
        }

        int lineStart = 0
        int processed = 0
        long consumed = 0
        long now = System.currentTimeMillis()
        for (int i = 0; i < buf.length && processed < maxLines; i++) {
            if (buf[i] != (byte) 0x0A)
                continue
            int len = i - lineStart
            if (len > 0 && buf[lineStart + len - 1] == (byte) 0x0D)
                len--                 // strip trailing \r
            String line = new String(buf, lineStart, len, StandardCharsets.UTF_8)
            long lineByteStart = offset + lineStart
            processLine(db, inode, lineByteStart, line, now, reposRoot, userCache, repoCache)
            consumed = i + 1
            lineStart = i + 1
            processed++
        }

        long newOffset = offset + consumed
        long ingested = (state != null ? state.getLong("lines_ingested") : 0L) + processed
        if (state != null) {
            state.set("file_path", f.getAbsolutePath())
            state.set("byte_offset", newOffset)
            state.set("file_size", size)
            state.set("lines_ingested", ingested)
            state.set("status", "active")
            state.set("updated_ts", now)
            state.update()
        } else {
            Record ns = db.newRecord("log_ingest_state")
            ns.set("source", "svnserve")
            ns.set("file_path", f.getAbsolutePath())
            ns.set("inode", inode)
            ns.set("byte_offset", newOffset)
            ns.set("file_size", size)
            ns.set("lines_ingested", (long) processed)
            ns.set("status", "active")
            ns.set("updated_ts", now)
            ns.addRecord()
        }
    }

    private static void processLine(Connection db, String inode, long byteStart, String line, long now,
                                    String reposRoot, Map<String, Integer> userCache, Map<String, Integer> repoCache) {
        SvnLogParser.Event ev = SvnLogParser.parse(line)
        if (ev == null)
            return
        String hash = sha256(inode + ":" + byteStart + ":" + line)
        if (db.exists("select 1 from access_event where event_hash = ?", hash))
            return

        Integer repoId = mapRepo(db, ev.repoKey, reposRoot, repoCache)
        Integer userId = mapUser(db, ev.rawUser, userCache)

        Record e = db.newRecord("access_event")
        e.set("repo_id", repoId)
        e.set("repo_key", ev.repoKey)
        e.set("user_id", userId)
        e.set("raw_user", ev.rawUser)
        e.set("client_host", ev.clientHost)
        e.set("action", ev.action)
        e.set("verb_class", ev.verbClass)
        e.set("path", ev.path)
        if (ev.revision != null)
            e.set("revision", ev.revision)
        e.set("event_ts", ev.tsMillis)
        e.set("event_day", ev.day)
        e.set("source", "svnserve")
        e.set("extra", trunc(ev.extra, 2000))
        e.set("event_hash", hash)
        e.addRecord()

        if (repoId != null) {
            upsertRollup(db, repoId, userId, ev.day, ev.category, ev.tsMillis)
            upsertWorkingCopy(db, repoId, userId, ev.rawUser, ev.category, ev.revision, ev.tsMillis, ev.clientHost)
        }
    }

    // -------- mapping --------

    private static Integer mapRepo(Connection db, String repoKey, String reposRoot, Map<String, Integer> cache) {
        if (repoKey == null)
            return null
        if (cache.containsKey(repoKey))
            return cache.get(repoKey)
        Record r = db.fetchOne("select repo_id from repository where repo_key = ?", repoKey)
        Integer id
        if (r != null) {
            id = r.getInt("repo_id")
        } else {
            // Auto-provision a discovered repo so stats accrue immediately.
            Record nr = db.newRecord("repository")
            nr.set("repo_key", repoKey)
            nr.set("name", repoKey)
            nr.set("fs_path", (reposRoot ? reposRoot + "/" : "") + repoKey)
            nr.set("discovered", "Y")
            nr.set("is_active", "Y")
            nr.set("created_ts", System.currentTimeMillis())
            id = ((Number) nr.addRecordAutoInc()).intValue()
        }
        cache.put(repoKey, id)
        return id
    }

    private static Integer mapUser(Connection db, String rawUser, Map<String, Integer> cache) {
        if (rawUser == null)
            return null
        if (cache.containsKey(rawUser))
            return cache.get(rawUser)
        Integer id = null
        Record alias = db.fetchOne("select user_id from svn_user_alias where raw_user_name = ?", rawUser)
        if (alias != null) {
            id = alias.getInt("user_id")
        } else {
            Record u = db.fetchOne("select user_id from users where lower(user_name) = lower(?)", rawUser)
            if (u != null)
                id = u.getInt("user_id")
            // Always record the alias (even if unmatched) so an admin can reconcile later.
            Record na = db.newRecord("svn_user_alias")
            na.set("raw_user_name", rawUser)
            if (id != null)
                na.set("user_id", id)
            na.set("created_ts", System.currentTimeMillis())
            na.addRecord()
        }
        cache.put(rawUser, id)
        return id
    }

    // -------- rollups --------

    private static void upsertRollup(Connection db, int repoId, Integer userId, int day, String category, long ts) {
        Record r = userId == null
                ? db.fetchOne("select * from access_daily_rollup where repo_id = ? and user_id is null and event_day = ?",
                        repoId, day)
                : db.fetchOne("select * from access_daily_rollup where repo_id = ? and user_id = ? and event_day = ?",
                        repoId, userId, day)
        if (r == null) {
            r = db.newRecord("access_daily_rollup")
            r.set("repo_id", repoId)
            if (userId != null)
                r.set("user_id", userId)
            r.set("event_day", day)
            r.set("first_event_ts", ts)
            r.set("last_event_ts", ts)
            bump(r, category, true)
            r.addRecord()
        } else {
            bump(r, category, false)
            r.set("last_event_ts", ts)
            r.update()
        }
    }

    private static void bump(Record r, String category, boolean isNew) {
        String col = colFor(category)
        int cur = isNew ? 0 : (r.getInt(col) ?: 0)
        r.set(col, cur + 1)
    }

    private static String colFor(String category) {
        switch (category) {
            case "checkout": return "checkout_count"
            case "update":   return "update_count"
            case "switch":   return "switch_count"
            case "browse":   return "browse_count"
            case "commit":   return "commit_count"
            default:         return "other_count"
        }
    }

    // -------- working copy freshness --------

    private static void upsertWorkingCopy(Connection db, int repoId, Integer userId, String rawUser,
                                          String category, Integer revision, long ts, String host) {
        boolean isSync = (category == "checkout" || category == "update" || category == "switch" || category == "commit")
        Record w = findWorkingCopy(db, repoId, userId, rawUser, host)
        if (w == null) {
            if (!isSync || revision == null)
                return
            w = db.newRecord("working_copy_state")
            w.set("repo_id", repoId)
            if (userId != null)
                w.set("user_id", userId)
            if (rawUser != null)
                w.set("raw_user", rawUser)
            w.set("last_any_activity_ts", ts)
            w.set("last_client_host", host)
            w.set("last_synced_revision", revision)
            w.set("last_sync_ts", ts)
            if (category == "checkout")
                w.set("last_checkout_ts", ts)
            w.addRecord()
        } else {
            w.set("last_any_activity_ts", ts)
            w.set("last_client_host", host)
            if (isSync && revision != null) {
                Integer prev = w.getInt("last_synced_revision")
                if (prev == null || revision >= prev) {
                    w.set("last_synced_revision", revision)
                    w.set("last_sync_ts", ts)
                }
            }
            if (category == "checkout")
                w.set("last_checkout_ts", ts)
            w.update()
        }
    }

    private static Record findWorkingCopy(Connection db, int repoId, Integer userId, String rawUser, String host) {
        if (userId != null)
            return db.fetchOne("select * from working_copy_state where repo_id = ? and user_id = ?", repoId, userId)
        if (rawUser != null)
            return db.fetchOne("select * from working_copy_state where repo_id = ? and user_id is null and raw_user = ?", repoId, rawUser)
        if (host != null)
            return db.fetchOne("select * from working_copy_state where repo_id = ? and user_id is null and raw_user is null and last_client_host = ?", repoId, host)
        return null
    }

    // -------- helpers --------

    private static String sha256(String s) {
        MessageDigest md = MessageDigest.getInstance("SHA-256")
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8))
        StringBuilder sb = new StringBuilder(64)
        for (byte b : d)
            sb.append(Integer.toHexString((b & 0xFF) | 0x100).substring(1))
        return sb.toString()
    }

    private static String globToRegex(String glob) {
        StringBuilder sb = new StringBuilder()
        for (char c : glob.toCharArray()) {
            switch (c) {
                case '*': sb.append(".*"); break
                case '?': sb.append('.'); break
                case '.': sb.append("\\."); break
                default:  sb.append(c)
            }
        }
        return sb.toString()
    }

    private static int parseInt(String s, int dflt) {
        if (s == null || s.isEmpty())
            return dflt
        try {
            return Integer.parseInt(s.trim())
        } catch (ignored) {
            return dflt
        }
    }

    private static String trunc(String s, int max) {
        if (s == null)
            return null
        return s.length() <= max ? s : s.substring(0, max)
    }
}
