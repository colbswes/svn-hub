package com.svnhub;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.OutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.tmatesoft.svn.core.SVNDepth;
import org.tmatesoft.svn.core.SVNDirEntry;
import org.tmatesoft.svn.core.SVNException;
import org.tmatesoft.svn.core.SVNLogEntry;
import org.tmatesoft.svn.core.SVNLogEntryPath;
import org.tmatesoft.svn.core.SVNNodeKind;
import org.tmatesoft.svn.core.SVNProperties;
import org.tmatesoft.svn.core.SVNPropertyValue;
import org.tmatesoft.svn.core.SVNURL;
import org.tmatesoft.svn.core.internal.io.fs.FSRepositoryFactory;
import org.tmatesoft.svn.core.io.ISVNEditor;
import org.tmatesoft.svn.core.io.SVNRepository;
import org.tmatesoft.svn.core.io.SVNRepositoryFactory;
import org.tmatesoft.svn.core.SVNCommitInfo;
import org.tmatesoft.svn.core.wc.SVNClientManager;
import org.tmatesoft.svn.core.wc.SVNCommitClient;
import org.tmatesoft.svn.core.wc.SVNDiffClient;
import org.tmatesoft.svn.core.wc.SVNRevision;
import org.tmatesoft.svn.core.wc.SVNRevisionRange;
import org.tmatesoft.svn.core.wc.SVNUpdateClient;
import org.tmatesoft.svn.core.wc.SVNWCUtil;
import java.nio.file.Files;
import java.util.Collections;

/**
 * Thin, app-neutral wrapper around SVNKit for SvnHub.
 *
 * All access is read-only against local FSFS repositories via {@code file://}
 * URLs, except {@link #createLocalRepository} which provisions a new repo.
 * Methods return plain Java collections/primitives so Groovy services can turn
 * them directly into JSON.
 *
 * SVNKit {@link SVNRepository} objects are not thread-safe, so a fresh one is
 * opened per call; for local FSFS access this is cheap.
 */
public final class SvnRepo {

    static {
        // Register the file:// (FSFS) protocol handler with SVNKit. Idempotent.
        FSRepositoryFactory.setup();
    }

    private SvnRepo() {
    }

    // ------------------------------------------------------------------ admin

    /**
     * Create a new local FSFS repository at {@code fsPath}.
     *
     * @param fsPath         absolute path where the repository will be created
     * @param standardLayout if true, commit r1 containing trunk/ branches/ tags/
     * @return the {@code file://} URL of the new repository
     */
    public static String createLocalRepository(String fsPath, boolean standardLayout) throws SVNException {
        SVNURL url = SVNRepositoryFactory.createLocalRepository(new File(fsPath), true, false);
        if (standardLayout) {
            SVNRepository repo = SVNRepositoryFactory.create(url);
            ISVNEditor editor = repo.getCommitEditor("Initialize standard SVN layout (trunk, branches, tags)", null);
            try {
                editor.openRoot(-1);
                for (String dir : new String[] {"trunk", "branches", "tags"}) {
                    editor.addDir(dir, null, -1);
                    editor.closeDir();
                }
                editor.closeDir();
                editor.closeEdit();
            } catch (SVNException e) {
                editor.abortEdit();
                throw e;
            }
        }
        return url.toString();
    }

    /** Youngest (HEAD) revision number, or 0 for an empty repository. */
    public static long getLatestRevision(String fsPath) throws SVNException {
        return open(fsPath).getLatestRevision();
    }

    /** Repository UUID. */
    public static String getUUID(String fsPath) throws SVNException {
        return open(fsPath).getRepositoryUUID(true);
    }

    // ----------------------------------------------------------------- browse

    /**
     * List a directory at a revision.
     *
     * @param revision desired revision, or -1 for HEAD
     * @return one map per entry: name, kind ("dir"/"file"), size, revision,
     *         author, date (epoch ms), message
     */
    public static List<Map<String, Object>> listDir(String fsPath, String path, long revision) throws SVNException {
        SVNRepository repo = open(fsPath);
        long rev = resolve(repo, revision);
        List<SVNDirEntry> entries = new ArrayList<>();
        repo.getDir(norm(path), rev, (SVNProperties) null, (java.util.Collection) entries);
        List<Map<String, Object>> out = new ArrayList<>();
        for (SVNDirEntry e : entries) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", e.getName());
            m.put("kind", e.getKind() == SVNNodeKind.DIR ? "dir" : "file");
            m.put("size", e.getSize());
            m.put("revision", e.getRevision());
            m.put("author", e.getAuthor());
            m.put("date", e.getDate() == null ? null : e.getDate().getTime());
            m.put("message", e.getCommitMessage());
            out.add(m);
        }
        return out;
    }

    /** Node kind at a path/revision: "dir", "file", or "none". */
    public static String nodeKind(String fsPath, String path, long revision) throws SVNException {
        SVNRepository repo = open(fsPath);
        long rev = resolve(repo, revision);
        SVNNodeKind k = repo.checkPath(norm(path), rev);
        if (k == SVNNodeKind.DIR)
            return "dir";
        if (k == SVNNodeKind.FILE)
            return "file";
        return "none";
    }

    /** Raw file contents at a revision. */
    public static byte[] getFile(String fsPath, String path, long revision) throws SVNException {
        SVNRepository repo = open(fsPath);
        long rev = resolve(repo, revision);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        repo.getFile(norm(path), rev, null, out);
        return out.toByteArray();
    }

    /** Epoch-ms of a revision's {@code svn:date} (revision 0 = repo creation), or -1 if unavailable. */
    public static long getRevisionDate(String fsPath, long revision) throws SVNException {
        SVNRepository repo = open(fsPath);
        long rev = resolve(repo, revision);
        SVNPropertyValue v = repo.getRevisionPropertyValue(rev, "svn:date");
        String d = v == null ? null : SVNPropertyValue.getPropertyAsString(v);
        if (d == null)
            return -1;
        try {
            return Instant.parse(d).toEpochMilli();
        } catch (Exception e) {
            return -1;
        }
    }

    /** Count file nodes (not directories) in the entire tree at a revision (-1 = HEAD). */
    public static long countFiles(String fsPath, long revision) throws SVNException {
        SVNRepository repo = open(fsPath);
        long rev = resolve(repo, revision);
        return countFilesRec(repo, "", rev);
    }

    private static long countFilesRec(SVNRepository repo, String path, long rev) throws SVNException {
        long count = 0;
        List<SVNDirEntry> entries = new ArrayList<>();
        repo.getDir(path, rev, (SVNProperties) null, (Collection) entries);
        for (SVNDirEntry e : entries) {
            if (e.getKind() == SVNNodeKind.DIR) {
                String child = path.isEmpty() ? e.getName() : path + "/" + e.getName();
                count += countFilesRec(repo, child, rev);
            } else if (e.getKind() == SVNNodeKind.FILE) {
                count++;
            }
        }
        return count;
    }

    // ---------------------------------------------------------------- history

    /**
     * Commit log for a path.
     *
     * @param path      path within the repo ("" or "/" for the whole tree)
     * @param startRev  start revision, or -1 for HEAD
     * @param endRev    end revision, or 0 for the first revision
     * @param limit     max entries (0 = no limit)
     * @param changedPaths include the changed-paths list per revision
     * @return one map per revision: revision, author, date (epoch ms), message,
     *         changedCount, and (if requested) paths [{type,path,copyFromPath,copyFromRev}]
     */
    public static List<Map<String, Object>> log(String fsPath, String path, long startRev, long endRev,
                                                 int limit, boolean changedPaths) throws SVNException {
        SVNRepository repo = open(fsPath);
        long start = startRev < 0 ? repo.getLatestRevision() : startRev;
        final List<Map<String, Object>> out = new ArrayList<>();
        repo.log(new String[] {norm(path)}, start, endRev, changedPaths, true, limit,
                (SVNLogEntry e) -> out.add(logEntryToMap(e, changedPaths)));
        return out;
    }

    private static Map<String, Object> logEntryToMap(SVNLogEntry e, boolean changedPaths) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("revision", e.getRevision());
        m.put("author", e.getAuthor());
        m.put("date", e.getDate() == null ? null : e.getDate().getTime());
        m.put("message", e.getMessage());
        Map<String, SVNLogEntryPath> cp = e.getChangedPaths();
        m.put("changedCount", cp == null ? 0 : cp.size());
        if (changedPaths && cp != null) {
            List<Map<String, Object>> paths = new ArrayList<>();
            for (SVNLogEntryPath p : cp.values()) {
                Map<String, Object> pm = new LinkedHashMap<>();
                pm.put("type", String.valueOf(p.getType()));
                pm.put("path", p.getPath());
                pm.put("copyFromPath", p.getCopyPath());
                pm.put("copyFromRev", p.getCopyRevision());
                paths.add(pm);
            }
            m.put("paths", paths);
        }
        return m;
    }

    /**
     * Unified diff of a path between two revisions.
     *
     * @param path path within the repo ("" or "/" for the whole tree)
     */
    public static String unifiedDiff(String fsPath, String path, long rev1, long rev2) throws SVNException {
        SVNClientManager cm = SVNClientManager.newInstance();
        try {
            SVNDiffClient dc = cm.getDiffClient();
            SVNURL target = fileUrl(fsPath);
            String p = norm(path);
            if (!p.isEmpty() && !p.equals("/"))
                target = target.appendPath(p.startsWith("/") ? p.substring(1) : p, false);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            dc.doDiff(target, SVNRevision.create(rev2),
                    SVNRevision.create(rev1), SVNRevision.create(rev2),
                    SVNDepth.INFINITY, false, out);
            return out.toString("UTF-8");
        } catch (SVNException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            cm.dispose();
        }
    }

    // -------------------------------------------------------- merge requests

    /**
     * Unified diff between two paths/revisions in the same repository — the
     * preview of what merging {@code path2} into {@code path1} would bring.
     *
     * @param rev1/rev2 revisions, or -1 for HEAD
     */
    public static String diffPaths(String fsPath, String path1, long rev1, String path2, long rev2) throws SVNException {
        SVNClientManager cm = SVNClientManager.newInstance();
        try {
            SVNDiffClient dc = cm.getDiffClient();
            SVNURL u1 = childUrl(fsPath, path1);
            SVNURL u2 = childUrl(fsPath, path2);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            dc.doDiff(u1, rev1 < 0 ? SVNRevision.HEAD : SVNRevision.create(rev1),
                    u2, rev2 < 0 ? SVNRevision.HEAD : SVNRevision.create(rev2),
                    SVNDepth.INFINITY, true, out);
            return out.toString("UTF-8");
        } catch (SVNException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            cm.dispose();
        }
    }

    /**
     * Merge all eligible revisions from {@code sourcePath} into {@code targetPath}
     * and commit the result.  Performed in a throwaway working copy checked out
     * over {@code file://} (no svnserve auth involved).
     *
     * @return the new revision number, or -1 if the merge produced no change
     */
    public static long merge(String fsPath, String sourcePath, String targetPath,
                             String message, String author) throws SVNException {
        SVNClientManager cm = SVNClientManager.newInstance(SVNWCUtil.createDefaultOptions(true), author, null);
        File wc = null;
        try {
            wc = Files.createTempDirectory("svnhub-merge-").toFile();
            SVNURL targetUrl = childUrl(fsPath, targetPath);
            SVNURL sourceUrl = childUrl(fsPath, sourcePath);

            SVNUpdateClient uc = cm.getUpdateClient();
            uc.doCheckout(targetUrl, wc, SVNRevision.HEAD, SVNRevision.HEAD, SVNDepth.INFINITY, false);

            SVNDiffClient dc = cm.getDiffClient();
            SVNRevisionRange all = new SVNRevisionRange(SVNRevision.create(0), SVNRevision.HEAD);
            dc.doMerge(sourceUrl, SVNRevision.HEAD, Collections.singletonList(all),
                    wc, SVNDepth.INFINITY, true, false, false, false);

            SVNCommitClient cc = cm.getCommitClient();
            SVNCommitInfo info = cc.doCommit(new File[] {wc}, false, message, null, null,
                    false, false, SVNDepth.INFINITY);
            return info == null ? -1 : info.getNewRevision();
        } catch (SVNException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            cm.dispose();
            if (wc != null)
                deleteTree(wc);
        }
    }

    // ----------------------------------------------------------------- helpers

    private static SVNURL childUrl(String fsPath, String path) throws SVNException {
        SVNURL url = fileUrl(fsPath);
        String p = norm(path);
        if (p.isEmpty())
            return url;
        return url.appendPath(p, false);
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null)
            for (File k : kids)
                deleteTree(k);
        f.delete();
    }

    private static SVNURL fileUrl(String fsPath) throws SVNException {
        return SVNURL.fromFile(new File(fsPath));
    }

    private static SVNRepository open(String fsPath) throws SVNException {
        return SVNRepositoryFactory.create(fileUrl(fsPath));
    }

    private static long resolve(SVNRepository repo, long revision) throws SVNException {
        return revision < 0 ? repo.getLatestRevision() : revision;
    }

    /** Normalize a caller path to the leading-slash-free form SVNRepository expects. */
    private static String norm(String path) {
        if (path == null)
            return "";
        String p = path.trim();
        while (p.startsWith("/"))
            p = p.substring(1);
        return p;
    }
}
