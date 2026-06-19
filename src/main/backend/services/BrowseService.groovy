package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.restServer.ProcessServlet
import org.kissweb.UserException
import com.svnhub.SvnRepo
import com.svnhub.RepoAccess
import com.svnhub.Json
import java.nio.charset.StandardCharsets

/**
 * Read-only repository browsing (directory listing, file contents, README) via
 * SVNKit.  The backend returns raw data only; the frontend renders it.
 */
class BrowseService {

    /** List a directory at a revision (-1 = HEAD). */
    void listDir(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        String path = injson.getString("path", "")
        long rev = injson.getLong("revision", -1L)

        outjson.put("entries", Json.toJsonArray(SvnRepo.listDir(fsPath, path, rev)))
        outjson.put("path", path)
        outjson.put("revision", rev < 0 ? SvnRepo.getLatestRevision(fsPath) : rev)
    }

    /** Fetch a file's contents at a revision.  Text is returned inline; binary as base64. */
    void cat(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        String path = injson.getString("path", "")
        long rev = injson.getLong("revision", -1L)

        byte[] bytes = SvnRepo.getFile(fsPath, path, rev)
        boolean binary = isBinary(bytes)
        outjson.put("name", basename(path))
        outjson.put("path", path)
        outjson.put("size", bytes.length)
        outjson.put("binary", binary)
        if (binary)
            outjson.put("contentBase64", bytes.encodeBase64().toString())
        else
            outjson.put("content", new String(bytes, StandardCharsets.UTF_8))
    }

    /**
     * Find and return the README markdown in a directory (raw text; the frontend
     * renders it).  Looks for README.md / readme.md (preferred) or a plain README.
     */
    void readme(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Integer userId = uid(servlet)
        int repoId = injson.getInt("repoId")
        RepoAccess.requireRead(db, userId, repoId)
        String fsPath = RepoAccess.fsPath(db, repoId)
        String path = injson.getString("path", "")
        long rev = injson.getLong("revision", -1L)

        List entries = SvnRepo.listDir(fsPath, path, rev)
        String chosen = null
        boolean chosenMd = false
        for (Object o : entries) {
            Map e = (Map) o
            if (!"file".equals(e.get("kind")))
                continue
            String n = (String) e.get("name")
            String low = n.toLowerCase()
            if (low == "readme.md") {
                chosen = n
                chosenMd = true
                break
            }
            if (chosen == null && (low == "readme" || low.startsWith("readme."))) {
                chosen = n
                chosenMd = low.endsWith(".md")
            }
        }
        if (chosen == null) {
            outjson.put("found", false)
            return
        }
        String filePath = (path == null || path.isEmpty()) ? chosen : (path.replaceAll('/$', '') + "/" + chosen)
        byte[] bytes = SvnRepo.getFile(fsPath, filePath, rev)
        outjson.put("found", true)
        outjson.put("name", chosen)
        outjson.put("isMarkdown", chosenMd)
        outjson.put("content", new String(bytes, StandardCharsets.UTF_8))
    }

    // ---------------------------------------------------------------- helpers

    private static Integer uid(ProcessServlet servlet) {
        return (Integer) servlet.getUserData().getUserId()
    }

    private static String basename(String path) {
        if (path == null)
            return ""
        String p = path.replaceAll('/$', '')
        int i = p.lastIndexOf('/')
        return i < 0 ? p : p.substring(i + 1)
    }

    /** Heuristic: a NUL byte in the first 8000 bytes means binary. */
    private static boolean isBinary(byte[] bytes) {
        int n = Math.min(bytes.length, 8000)
        for (int i = 0; i < n; i++)
            if (bytes[i] == 0)
                return true
        return false
    }
}
