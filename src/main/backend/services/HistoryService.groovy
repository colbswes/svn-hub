package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.SvnRepo
import com.svnhub.RepoAccess
import com.svnhub.Json

/**
 * Repository history: commit log, per-revision detail (changed paths + diff),
 * and arbitrary two-revision diffs, via SVNKit.
 */
class HistoryService {

    /** Commit log for a path ("" = whole repo). */
    void log(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        String path = injson.getString("path", "")
        int limit = injson.getInt("limit", 50)
        long startRev = injson.getLong("startRev", -1L)
        boolean withPaths = injson.getBoolean("withPaths", false)

        outjson.put("commits", Json.toJsonArray(SvnRepo.log(fsPath, path, startRev, 0L, limit, withPaths)))
    }

    /** Full detail for one revision: metadata, changed paths, and its diff. */
    void revisionDetail(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        int rev = injson.getInt("revision")

        List entries = SvnRepo.log(fsPath, "", (long) rev, (long) rev, 1, true)
        if (entries.isEmpty())
            throw new UserException("Revision not found.")
        Map e = (Map) entries.get(0)
        outjson.put("revision", e.get("revision"))
        outjson.put("author", e.get("author"))
        outjson.put("date", e.get("date"))
        outjson.put("message", e.get("message"))
        outjson.put("paths", Json.toJson(e.get("paths") == null ? new ArrayList() : e.get("paths")))
        // Diff of the whole revision (rev-1 .. rev).
        String diff = rev > 0 ? SvnRepo.unifiedDiff(fsPath, "", (long) (rev - 1), (long) rev) : ""
        outjson.put("diff", diff)
    }

    /** Unified diff of a path between two revisions. */
    void diff(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        String path = injson.getString("path", "")
        long rev1 = injson.getLong("rev1")
        long rev2 = injson.getLong("rev2")
        outjson.put("diff", SvnRepo.unifiedDiff(fsPath, path, rev1, rev2))
    }

    private static Integer uid(ProcessServlet servlet) {
        def ud = servlet.getUserData()
        return ud == null ? null : (Integer) ud.getUserId()
    }
}
