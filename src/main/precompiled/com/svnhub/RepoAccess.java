package com.svnhub;

import org.kissweb.UserException;
import org.kissweb.database.Connection;
import org.kissweb.database.Record;

/**
 * Centralized repository access checks, shared by every SvnHub service.
 *
 * Lives in precompiled (always loaded) so services do not depend on
 * cross-Groovy-service static calls. A global admin implicitly has full
 * access to every repository.
 */
public final class RepoAccess {

    private RepoAccess() {
    }

    public static boolean isAdmin(Connection db, Integer userId) throws Exception {
        if (userId == null)
            return false;
        Record u = db.fetchOne("select is_admin from users where user_id = ?", userId);
        return u != null && "Y".equals(u.getString("is_admin"));
    }

    public static boolean canRead(Connection db, Integer userId, int repoId) throws Exception {
        if (isAdmin(db, userId))
            return true;
        // Public repositories are readable by any user (mirrors svnserve's "* = r").
        Record repo = db.fetchOne("select visibility, is_active from repository where repo_id = ?", repoId);
        if (repo != null && "Y".equals(repo.getString("is_active")) && "public".equals(repo.getString("visibility")))
            return true;
        if (userId == null)
            return false;
        Record ra = db.fetchOne("select can_read from repository_access where repo_id = ? and user_id = ?", repoId, userId);
        return ra != null && "Y".equals(ra.getString("can_read"));
    }

    public static boolean canWrite(Connection db, Integer userId, int repoId) throws Exception {
        if (userId == null)
            return false;
        if (isAdmin(db, userId))
            return true;
        Record ra = db.fetchOne("select can_write from repository_access where repo_id = ? and user_id = ?", repoId, userId);
        return ra != null && "Y".equals(ra.getString("can_write"));
    }

    public static boolean canAdmin(Connection db, Integer userId, int repoId) throws Exception {
        if (userId == null)
            return false;
        if (isAdmin(db, userId))
            return true;
        Record ra = db.fetchOne("select can_admin from repository_access where repo_id = ? and user_id = ?", repoId, userId);
        return ra != null && "Y".equals(ra.getString("can_admin"));
    }

    public static void requireRead(Connection db, Integer userId, int repoId) throws Exception {
        if (!canRead(db, userId, repoId))
            throw new UserException("You do not have access to this repository.");
    }

    public static void requireWrite(Connection db, Integer userId, int repoId) throws Exception {
        if (!canWrite(db, userId, repoId))
            throw new UserException("You do not have write access to this repository.");
    }

    public static void requireAdmin(Connection db, Integer userId, int repoId) throws Exception {
        if (!canAdmin(db, userId, repoId))
            throw new UserException("You do not have administrative access to this repository.");
    }

    /** Absolute FSFS path for a repository, or throw if it does not exist. */
    public static String fsPath(Connection db, int repoId) throws Exception {
        Record r = db.fetchOne("select fs_path from repository where repo_id = ?", repoId);
        if (r == null)
            throw new UserException("Repository not found.");
        return r.getString("fs_path");
    }
}
