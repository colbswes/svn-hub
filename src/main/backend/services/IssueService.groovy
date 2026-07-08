package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.RepoAccess

/**
 * Lightweight per-repository issue tracker.  Any user with read access can file
 * and comment; closing is allowed for the issue's author or anyone with write
 * access.  Issues are numbered per repository.
 */
class IssueService {

    /** List issues for a repo, optionally filtered by status ('open'/'closed'/'' = all). */
    void list(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String status = injson.getString("status", "")
        String sql = """select i.number as "number", i.title as "title", i.status as "status",
                i.created_ts as "createdTs", u.user_name as "createdBy",
                (select count(*) from issue_comment c where c.issue_id = i.issue_id) as "comments"
                from issue i join users u on u.user_id = i.created_by
                where i.repo_id = ?"""
        JSONArray rows
        if (status == "open" || status == "closed")
            rows = db.fetchAllJSON(sql + " and i.status = ? order by i.number desc", repoId, status)
        else
            rows = db.fetchAllJSON(sql + " order by i.number desc", repoId)
        outjson.put("rows", rows)
    }

    /** One issue with its comments. */
    void get(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        Record i = db.fetchOne("""select i.*, u.user_name as created_by_name from issue i
                join users u on u.user_id = i.created_by where i.repo_id = ? and i.number = ?""", repoId, number)
        if (i == null)
            throw new UserException("Issue not found.")
        JSONObject issue = new JSONObject()
        issue.put("number", i.getInt("number"))
        issue.put("title", i.getString("title"))
        issue.put("body", i.getString("body"))
        issue.put("status", i.getString("status"))
        issue.put("createdBy", i.getString("created_by_name"))
        issue.put("createdTs", i.getLong("created_ts"))
        issue.put("closedTs", i.getLong("closed_ts"))
        outjson.put("issue", issue)

        JSONArray comments = db.fetchAllJSON("""select c.body as "body", c.created_ts as "createdTs",
                u.user_name as "userName" from issue_comment c join users u on u.user_id = c.user_id
                join issue i on i.issue_id = c.issue_id
                where i.repo_id = ? and i.number = ? order by c.created_ts""", repoId, number)
        outjson.put("comments", comments)
    }

    /** File a new issue; returns the assigned per-repo number. */
    void create(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String title = injson.getString("title", "")
        if (title != null)
            title = title.trim()
        if (!title)
            throw new UserException("Title is required.")
        int number = db.fetchOne("select coalesce(max(number),0)+1 as n from issue where repo_id = ?", repoId).getInt("n")
        Record rec = db.newRecord("issue")
        rec.set("repo_id", repoId)
        rec.set("number", number)
        rec.set("title", title)
        rec.set("body", injson.getString("body", ""))
        rec.set("status", "open")
        rec.set("created_by", userId)
        rec.set("created_ts", System.currentTimeMillis())
        rec.addRecord()
        outjson.put("number", number)
    }

    /** Add a comment to an issue. */
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
        Record i = db.fetchOne("select issue_id from issue where repo_id = ? and number = ?", repoId, number)
        if (i == null)
            throw new UserException("Issue not found.")
        Record c = db.newRecord("issue_comment")
        c.set("issue_id", i.getInt("issue_id"))
        c.set("user_id", userId)
        c.set("body", body)
        c.set("created_ts", System.currentTimeMillis())
        c.addRecord()
    }

    /** Open or close an issue (author or a writer). */
    void setStatus(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        int number = injson.getInt("number")
        String status = injson.getString("status", "")
        if (status != "open" && status != "closed")
            throw new UserException("Status must be 'open' or 'closed'.")
        Record i = db.fetchOne("select * from issue where repo_id = ? and number = ?", repoId, number)
        if (i == null)
            throw new UserException("Issue not found.")
        boolean isAuthor = ((Integer) i.getInt("created_by")) == userId
        if (!isAuthor && !RepoAccess.canWrite(db, userId, repoId))
            throw new UserException("Only the author or a writer may change an issue's status.")
        i.set("status", status)
        i.set("closed_ts", status == "closed" ? System.currentTimeMillis() : null)
        i.update()
    }

    private static Integer uid(ProcessServlet servlet) {
        def ud = servlet.getUserData()
        return ud == null ? null : (Integer) ud.getUserId()
    }
}
