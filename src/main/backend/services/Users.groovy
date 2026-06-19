package services

import org.kissweb.json.JSONArray
import org.kissweb.json.JSONObject
import org.kissweb.database.Connection
import org.kissweb.database.Record
import org.kissweb.restServer.ProcessServlet
import org.kissweb.restServer.MainServlet
import org.kissweb.PasswordHash
import com.svnhub.SvnAuthManager

/**
 * User administration for SvnHub.  Manages the login credential (PBKDF2 hash),
 * profile fields, the admin flag, and the SVN password (written to svnserve's
 * passwd file).  Setting/clearing an SVN password regenerates that file.
 */
class Users {

    void getRecords(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        if (db == null) {
            outjson.put("nodb", true)
            return
        }
        List<Record> recs = db.fetchAll("""select user_id, user_name, full_name, email, is_admin,
                user_active, svn_password from users order by user_name""")
        JSONArray rows = new JSONArray()
        for (Record rec : recs) {
            JSONObject row = new JSONObject()
            row.put("id", rec.getInt("user_id"))
            row.put("userName", rec.getString("user_name"))
            row.put("fullName", rec.getString("full_name"))
            row.put("email", rec.getString("email"))
            row.put("isAdmin", rec.getString("is_admin"))
            row.put("userActive", rec.getString("user_active"))
            row.put("hasSvnPassword", rec.getString("svn_password") ? "Y" : "N")
            rows.put(row)
        }
        outjson.put("rows", rows)
    }

    void addRecord(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Record rec = db.newRecord("users")
        rec.set("user_name", injson.getString("userName"))
        rec.set("user_password", PasswordHash.hash(injson.getString("userPassword")))
        rec.set("full_name", injson.getString("fullName", ""))
        rec.set("email", injson.getString("email", ""))
        rec.set("is_admin", "Y".equals(injson.getString("isAdmin", "N")) ? "Y" : "N")
        rec.set("user_active", injson.getString("userActive", "Y"))
        rec.set("created_ts", System.currentTimeMillis())
        String svnPw = injson.getString("svnPassword", "")
        boolean svnSet = svnPw != null && !svnPw.isEmpty()
        if (svnSet)
            rec.set("svn_password", svnPw)
        rec.addRecord()
        if (svnSet)
            regeneratePasswd(db)
    }

    void updateRecord(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        Record rec = db.fetchOne("select * from users where user_id = ?", injson.getInt("id"))
        rec.set("user_name", injson.getString("userName"))
        rec.set("full_name", injson.getString("fullName", ""))
        rec.set("email", injson.getString("email", ""))
        rec.set("is_admin", "Y".equals(injson.getString("isAdmin", "N")) ? "Y" : "N")
        rec.set("user_active", injson.getString("userActive", "Y"))
        // Only change a password when a new (non-empty) one is supplied.
        String userPassword = injson.getString("userPassword", "")
        if (userPassword != null && !userPassword.isEmpty())
            rec.set("user_password", PasswordHash.hash(userPassword))
        String svnPw = injson.getString("svnPassword", "")
        boolean svnSet = svnPw != null && !svnPw.isEmpty()
        if (svnSet)
            rec.set("svn_password", svnPw)
        rec.update()
        if (svnSet)
            regeneratePasswd(db)
    }

    void deleteRecord(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet) {
        db.execute("delete from users where user_id = ?", injson.getInt("id"))
        regeneratePasswd(db)
    }

    private static void regeneratePasswd(Connection db) {
        String confDir = MainServlet.getEnvironment("SvnConfDir")
        if (confDir)
            SvnAuthManager.regeneratePasswd(db, confDir + "/passwd")
    }
}
