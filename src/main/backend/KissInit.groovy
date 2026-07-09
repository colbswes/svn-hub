import org.kissweb.database.Connection
import org.kissweb.restServer.MainServlet
import org.kissweb.restServer.UserCache
import org.kissweb.restServer.UserData
import java.util.function.Consumer
import com.svnhub.migrate.SchemaMigrator
import com.svnhub.migrate.RecordMigrator
import com.svnhub.migrate.SchemaStatus
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger

class KissInit {

    private static final Logger logger = LogManager.getLogger(KissInit.class)

    /**
     * Configure the system.
     */
    static void init() {

        MainServlet.readIniFile "application.ini", "main"

        requireDatabaseConfigured()

        // Authentication bootstrap.
        MainServlet.allowWithoutAuthentication("services.Register", "register")
        MainServlet.allowWithoutAuthentication("services.PasswordResetService", "requestReset")

        // Public read-only browsing.  The service methods still enforce repository
        // visibility through RepoAccess, so private repositories remain closed.
        MainServlet.allowWithoutAuthentication("services.DiscoverService", "searchUsers")
        MainServlet.allowWithoutAuthentication("services.DiscoverService", "searchRepos")
        MainServlet.allowWithoutAuthentication("services.DiscoverService", "getProfile")
        MainServlet.allowWithoutAuthentication("services.RepositoryService", "getRepository")
        MainServlet.allowWithoutAuthentication("services.BrowseService", "listDir")
        MainServlet.allowWithoutAuthentication("services.BrowseService", "cat")
        MainServlet.allowWithoutAuthentication("services.BrowseService", "readme")
        MainServlet.allowWithoutAuthentication("services.HistoryService", "log")
        MainServlet.allowWithoutAuthentication("services.HistoryService", "revisionDetail")
        MainServlet.allowWithoutAuthentication("services.HistoryService", "diff")
        MainServlet.allowWithoutAuthentication("services.StatsService", "repoFacts")
        MainServlet.allowWithoutAuthentication("services.IssueService", "list")
        MainServlet.allowWithoutAuthentication("services.IssueService", "get")
        MainServlet.allowWithoutAuthentication("services.MergeRequestService", "list")
        MainServlet.allowWithoutAuthentication("services.MergeRequestService", "get")
        MainServlet.allowWithoutAuthentication("services.MergeRequestService", "diffPreview")

        // Set up a global logout handler that runs whenever any user logs out
        // This can be used for cleanup tasks like logging, closing resources, etc.
        UserCache.setLogoutHandler({ UserData ud ->
            // Example: Log the logout event
            println "User ${ud.getUsername()} (ID: ${ud.getUserId()}) is logging out"

            // Add any custom cleanup code here
            // Examples:
            // - Close user-specific resources
            // - Update database logout timestamp
            // - Send notifications
            // - Clean up temporary files
        } as Consumer<UserData>)

    }

    /**
     * SvnHub cannot run without a database: every REST service and cron task
     * needs the connection.  Kiss core, being application-neutral, tolerates a
     * missing database by starting in a "bypass logins" mode -- but for SvnHub
     * that produces a server that appears up while every service fails, which
     * looks broken rather than misconfigured.  Detect the missing/blank database
     * configuration here, log a clear explanation, and terminate the JVM (and
     * therefore Tomcat) so the operator fixes the configuration instead of
     * chasing downstream null-connection errors.
     */
    private static void requireDatabaseConfigured() {
        String dbType = (String) MainServlet.getEnvironment("DatabaseType")
        String dbName = (String) MainServlet.getEnvironment("DatabaseName")
        boolean configured = dbType != null && !dbType.trim().isEmpty() &&
                             dbName != null && !dbName.trim().isEmpty()
        if (configured)
            return
        logger.fatal("* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *")
        logger.fatal("* * * SvnHub CANNOT START: no database configured.")
        logger.fatal("* * * DatabaseType and DatabaseName must be set in")
        logger.fatal("* * *     src/main/backend/application.ini")
        logger.fatal("* * * If that file is missing, copy application.template.ini to")
        logger.fatal("* * * application.ini and fill in the Database* keys.")
        logger.fatal("* * * Shutting down Tomcat.")
        logger.fatal("* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *")
        System.exit(1)
    }

    /**
     * Code to run once the database is open but before the app is running.
     *
     * Auto-update (see AutoUpdate.md): bring the database current with the
     * deployed code.  Stage 1 (schema) runs first because it may create the
     * columns Stage 2 (per-row) reads.  A schema-migration failure marks the
     * schema not-ready, which blocks logins (fail-closed); the per-row stage
     * runs only when the schema is ready and never blocks startup itself.
     */
    static void init2(Connection db) {
        SchemaStatus.reset()
        try {
            SchemaMigrator.runOnStartup()
            SchemaStatus.markReady()
        } catch (Throwable t) {
            SchemaStatus.fail(t.getMessage())
            println "* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *"
            println "* * * SCHEMA MIGRATION FAILED — logins are blocked until fixed"
            println "* * * " + t.getMessage()
            println "* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *"
            t.printStackTrace()
        }
        if (SchemaStatus.isReady())
            RecordMigrator.runOnStartup()
    }
}
