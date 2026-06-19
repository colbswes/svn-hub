package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.RepoAccess
import com.svnhub.SvnRepo

/**
 * Code review / merge requests: a proposal to merge one path (e.g. a branch)
 * into another (e.g. trunk), with an inline-commentable diff.  Approving a
 * request performs the real SVN merge + commit via SVNKit.
 */
class MergeRequestService {

    /** List merge requests for a repo (optionally by status). */
    void list(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String status = injson.getString("status", "")
        String sql = """select m.number as "number", m.title as "title", m.status as "status",
                m.source_path as "sourcePath", m.target_path as "targetPath",
                m.created_ts as "createdTs", m.merged_rev as "mergedRev", u.user_name as "createdBy"
                from merge_request m join users u on u.user_id = m.created_by where m.repo_id = ?"""
        JSONArray rows
        if (status)
            rows = db.fetchAllJSON(sql + " and m.status = ? order by m.number desc", repoId, status)
        else
            rows = db.fetchAllJSON(sql + " order by m.number desc", repoId)
        outjson.put("rows", rows)
    }

    /** One merge request with its comments. */
    void get(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        Record m = db.fetchOne("""select m.*, u.user_name as created_by_name from merge_request m
                join users u on u.user_id = m.created_by where m.repo_id = ? and m.number = ?""", repoId, number)
        if (m == null)
            throw new UserException("Merge request not found.")
        JSONObject mr = new JSONObject()
        mr.put("number", m.getInt("number"))
        mr.put("title", m.getString("title"))
        mr.put("body", m.getString("body"))
        mr.put("status", m.getString("status"))
        mr.put("sourcePath", m.getString("source_path"))
        mr.put("targetPath", m.getString("target_path"))
        mr.put("mergedRev", m.getInt("merged_rev"))
        mr.put("createdBy", m.getString("created_by_name"))
        mr.put("createdTs", m.getLong("created_ts"))
        outjson.put("mr", mr)
        outjson.put("canMerge", RepoAccess.canWrite(db, userId, repoId))

        JSONArray comments = db.fetchAllJSON("""select c.file_path as "filePath", c.line_no as "lineNo",
                c.body as "body", c.created_ts as "createdTs", u.user_name as "userName"
                from mr_comment c join users u on u.user_id = c.user_id
                join merge_request m on m.mr_id = c.mr_id
                where m.repo_id = ? and m.number = ? order by c.created_ts""", repoId, number)
        outjson.put("comments", comments)
    }

    /** Create a merge request (branch -> target). */
    void create(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String source = injson.getString("sourcePath", "")
        String target = injson.getString("targetPath", "")
        String title = injson.getString("title", "")
        if (source != null)
            source = source.trim()
        if (target != null)
            target = target.trim()
        if (title != null)
            title = title.trim()
        if (!source || !target)
            throw new UserException("Source and target paths are required.")
        if (source == target)
            throw new UserException("Source and target must differ.")
        if (!title)
            title = "Merge " + source + " into " + target

        int number = db.fetchOne("select coalesce(max(number),0)+1 as n from merge_request where repo_id = ?", repoId).getInt("n")
        String fsPath = RepoAccess.fsPath(db, repoId)
        long head = SvnRepo.getLatestRevision(fsPath)
        Record rec = db.newRecord("merge_request")
        rec.set("repo_id", repoId)
        rec.set("number", number)
        rec.set("source_path", source)
        rec.set("target_path", target)
        rec.set("title", title)
        rec.set("body", injson.getString("body", ""))
        rec.set("status", "open")
        rec.set("source_rev", (int) head)
        rec.set("target_rev", (int) head)
        rec.set("created_by", userId)
        rec.set("created_ts", System.currentTimeMillis())
        rec.addRecord()
        outjson.put("number", number)
    }

    /** The diff that approving this request would apply to the target. */
    void diffPreview(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        Record m = db.fetchOne("select source_path, target_path from merge_request where repo_id = ? and number = ?", repoId, number)
        if (m == null)
            throw new UserException("Merge request not found.")
        String fsPath = RepoAccess.fsPath(db, repoId)
        // diff target..source : what source would bring into target
        outjson.put("diff", SvnRepo.diffPaths(fsPath, m.getString("target_path"), -1L, m.getString("source_path"), -1L))
    }

    /** Add a comment (optionally anchored to a file/line in the diff). */
    void comment(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        String body = injson.getString("body", "")
        if (body != null)
            body = body.trim()
        if (!body)
            throw new UserException("Comment must not be empty.")
        Record m = db.fetchOne("select mr_id from merge_request where repo_id = ? and number = ?", repoId, number)
        if (m == null)
            throw new UserException("Merge request not found.")
        Record c = db.newRecord("mr_comment")
        c.set("mr_id", m.getInt("mr_id"))
        c.set("user_id", userId)
        c.set("file_path", injson.getString("filePath", null))
        if (injson.has("lineNo"))
            c.set("line_no", injson.getInt("lineNo"))
        c.set("body", body)
        c.set("created_ts", System.currentTimeMillis())
        c.addRecord()
    }

    /** Approve and perform the merge (writer only). */
    void approveAndMerge(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireWrite(db, userId, repoId)
        int number = injson.getInt("number")
        Record m = db.fetchOne("select * from merge_request where repo_id = ? and number = ?", repoId, number)
        if (m == null)
            throw new UserException("Merge request not found.")
        if (m.getString("status") != "open")
            throw new UserException("This merge request is not open.")
        String fsPath = RepoAccess.fsPath(db, repoId)
        String author = db.fetchOne("select user_name from users where user_id = ?", userId).getString("user_name")
        String msg = injson.getString("message", "")
        if (!msg)
            msg = "Merge " + m.getString("source_path") + " into " + m.getString("target_path") +
                  " (merge request #" + number + ")"

        long newRev = SvnRepo.merge(fsPath, m.getString("source_path"), m.getString("target_path"), msg, author)

        m.set("status", "merged")
        m.set("merged_ts", System.currentTimeMillis())
        if (newRev >= 0)
            m.set("merged_rev", (int) newRev)
        m.update()
        outjson.put("mergedRev", newRev)
    }

    /** Close without merging (author or writer). */
    void close(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        Record m = db.fetchOne("select * from merge_request where repo_id = ? and number = ?", repoId, number)
        if (m == null)
            throw new UserException("Merge request not found.")
        boolean isAuthor = ((Integer) m.getInt("created_by")) == userId
        if (!isAuthor && !RepoAccess.canWrite(db, userId, repoId))
            throw new UserException("Only the author or a writer may close this request.")
        m.set("status", "closed")
        m.set("closed_ts", System.currentTimeMillis())
        m.update()
    }

    private static Integer uid(ProcessServlet servlet) {
        return (Integer) servlet.getUserData().getUserId()
    }
}
