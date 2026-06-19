# SvnHub — a GitHub-like service for Subversion

## Context

Blake wants a self-hosted, GitHub-style web service built on **Subversion instead of Git**. Two things make it different from existing SVN web front-ends (ViewVC, WebSVN, Trac):

1. **Rich per-user checkout/update statistics** — the flagship differentiator. GitHub's "traffic" only shows anonymous 14-day clone/visitor counts. SvnHub will track *who* checked out or updated *which* repo to *which revision*, how stale each developer's working copy is, hot paths, revision-adoption curves, abandoned working copies, etc.
2. **Deliberately omits** the GitHub areas Blake doesn't want: **Agents, Actions (CI/CD), Projects (kanban), and Security & Quality (Dependabot/code-scanning/secret-scanning).**

The project (`/home/blake/GitHub.blakemcbride/SvnHub`) is currently the unmodified Kiss framework template. Blake already runs `svnserve -d -r /home/repos` under systemd as `svn:svn`, with trunk/branches/tags repos. This plan builds the application on top of Kiss (Java 17 + Groovy + JSON-RPC + AG-Grid frontend).

### Locked-in decisions (from planning Q&A)
- **Server role:** Full management — SvnHub creates repos and manages SVN users/permissions through the web UI.
- **SVN access:** **SVNKit** (pure-Java library) for browsing/history/diff/repo-admin/merge.
- **First-version collaboration:** Markdown README rendering, Issue tracker, Code review / Merge requests. (Full-text search, stars/watch, releases, wiki deferred.)
- **Database:** PostgreSQL.

### Hard constraints (from KnowledgeBase.md)
- Do **not** modify `src/main/core/` or `src/main/frontend/kiss/`. All app code lives in `src/main/backend/`, `src/main/frontend/` (non-kiss), `src/main/precompiled/`.
- Backend↔frontend communicate **only via JSON-RPC** (`Server.call`); backend never emits HTML/JS.
- Secrets/paths/credentials go in `application.ini`, read via `MainServlet.getEnvironment(...)`.
- Passwords stored via `org.kissweb.PasswordHash` only.
- Groovy/Java style: never put an `if` body on the condition line.

---

## Architecture overview

```
Browser (SvnHub UI)  ──JSON-RPC──►  Kiss backend services (Groovy)
                                       │
        ┌──────────────────────────────┼───────────────────────────────┐
        │                              │                                │
   SVNKit (read/admin/merge)    PostgreSQL (app + stats)        svnserve config files
   browse/log/diff/create        repos, access, issues,         passwd / authz / svnserve.conf
   merge branch→trunk            access_event firehose,         (SvnHub writes these = "full mgmt")
                                 rollups, commit_cache
        ▲                                                              ▲
        │                                                              │
   /home/repos (FSFS repos)  ◄── developers run `svn co/up` ──►  svnserve  ──► --log-file
                                                                                  │
                                                            IngestSvnLogs cron parses it ─► access_event
```

Two independent SVN touch-points:
- **SVNKit** is how *SvnHub itself* reads/administers/merges repos.
- **svnserve `--log-file`** is how SvnHub learns what *other developers* checked out/updated (the statistics firehose). SVNKit cannot see other clients' reads; only the server log can. Both are needed.

---

## Data model (PostgreSQL)

All timestamps stored as `bigint` epoch-ms (frontend `DateTimeUtils.formatDate()` auto-detects epoch ms); day buckets as `integer` `YYYYMMDD` (`DateUtils.toInt`). Mirrors the existing `users` table style in `schema.sql` (`serial` PK, `character varying`, `character(1)`+`CHECK`).

**Identity & repos**
- `users` — *extend existing* with `email`, `full_name`, `is_admin char(1)`.
- `repository` — `repo_id`, `repo_key UNIQUE` (first path segment, e.g. `acme`), `name`, `fs_path`, `description`, `default_branch`, `discovered`, `is_active`, `created_ts`, `head_revision`, `head_revision_ts`.
- `repository_access` — `(repo_id, user_id)` UNIQUE, `can_read/can_write/can_admin char(1)`, `granted_ts`. Source of truth that gets serialized to svnserve `authz`.
- `svn_user_alias` — `raw_user_name UNIQUE → user_id` (maps the SVN realm name in the log to a SvnHub account; nullable until reconciled).

**Statistics (the differentiator)**
- `access_event` — raw firehose. `event_id bigserial`, `repo_id`/`repo_key`, `user_id`/`raw_user`, `client_host`, `action` (verbatim svn verb), `verb_class` (read|write|lock|other), `path`, `revision`, `event_ts`, `event_day`, `bytes`, `source`, `extra`, `event_hash char(64)` (SHA-256 dedup, UNIQUE). Indexed on `(repo_id,event_day)`, `(user_id,event_day)`, `(repo_id,user_id,event_ts)`.
- `log_ingest_state` — per physical log file cursor: `inode` (`Files.fileKey()`, rotation-safe), `byte_offset`, `file_size`, `status`, `lines_ingested`, `locked_until`. UNIQUE `(source, inode)`.
- `access_daily_rollup` — `(repo_id, user_id, event_day)` UNIQUE; `checkout_count/update_count/switch_count/browse_count/commit_count/other_count`, `total_bytes`, `distinct_paths`, `max_revision_synced`, `first/last_event_ts`. Fast charts without scanning the firehose.
- `working_copy_state` — one row per `(repo_id, user_id)`: `last_synced_revision`, `last_sync_ts`, `last_checkout_ts`, `last_any_activity_ts`, `last_client_host`. The freshness signal.

**Browsing cache**
- `commit_cache` — `(repo_id, revision)` UNIQUE: `author`, `commit_ts`, `message`, `changed_count`.
- `commit_cache_path` — per-revision changed paths: `change_type char(1) A/M/D/R`, `path`, `copy_from_path/rev`.

**Collaboration**
- `issue` — `repo_id`, `number` (per-repo sequence), `title`, `body`, `status` (open|closed), `created_by`, `created_ts`, `closed_ts`.
- `issue_comment` — `issue_id`, `user_id`, `body`, `created_ts`.
- `merge_request` — `repo_id`, `number`, `source_path` (e.g. `/branches/x`), `target_path` (e.g. `/trunk`), `title`, `body`, `status` (open|merged|closed), `source_rev`, `target_rev`, `merged_rev`, `created_by`, `created_ts`.
- `mr_comment` — `mr_id`, `user_id`, `file_path`, `line_no` (nullable = general comment), `body`, `created_ts`.

Full `CREATE TABLE` DDL goes into `schema.sql` following the existing column style.

---

## Statistics SvnHub derives that GitHub cannot

Exposed as `StatsService` JSON-RPC methods; rendered on the **Insights** screen with Chart.js.

1. **Working-copy freshness** (revisions behind HEAD), per user per repo: `repository.head_revision − working_copy_state.last_synced_revision`. ★ flagship.
2. **Sync latency in time** — days between the user's last-synced revision's commit date and HEAD's.
3. **Checkout-vs-update ratio** per user (high checkout ratio = re-cloning instead of updating).
4. **Stale / abandoned working copies** — `now − last_any_activity_ts > threshold`.
5. **Per-repo pull heatmap** (day × hour) of read operations — GitHub-style punch-card, but for checkouts/updates.
6. **Read hotspots** — most-fetched paths (`get-file`/`get-dir`/`update`).
7. **Revision-adoption curve** — distinct users who have pulled ≥ revision r over time.
8. **Per-user engagement breadth** — distinct repos touched, active days.
9. **Bus-factor / coverage** — how many devs are currently caught up to HEAD.
10. **Read load by client host** — separate CI machines from humans, spot runaway pollers.

---

## Statistics ingestion pipeline (svnserve `--log-file`)

Operational prerequisite: enable `--log-file` in the systemd `ExecStart` (e.g. `svnserve -d -r /home/repos --log-file /var/log/svnserve/svnserve.log`). One-line change Blake makes once.

- **Parser** (`LogParser`, Groovy under backend) — anchored regex on the stable prefix, positional parse of the action-specific tail:
  `^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+(\S+)\s*(.*)$` → `ip`, `user`(`-`=anonymous→NULL), `date`(`dd/Mon/yyyy:HH:MM:SS +zzzz`), `action`, `rest`. From `rest`: first `/`-token = `path` (NULL for `commit`), second `/`-token (for `switch`) → `extra`, `r<digits>` → `revision`, remaining flags → `extra`. `repo_key` = first path segment after the configured `SvnLogPathPrefix`. Unknown verbs are stored verbatim; unparseable lines stored as `action='UNPARSED'` with the raw line in `extra` (never dropped — surfaces format drift).
- **Incremental tail** (`IngestSvnLogs` cron, `* * * * *`) — identify each log file by `Files.fileKey()` inode (survives `logrotate` rename); `RandomAccessFile.seek(byte_offset)`; read to EOF; **process only complete `\n`-terminated lines** (partial trailing line left for next tick — the core anti-dup guarantee); detect truncation (`size < offset` ⇒ copytruncate, reset to 0); drain `.gz` rotated files once via `GZIPInputStream`. (Models the seek/truncation logic in `org.kissweb.BuildUtils.tail`.)
- **Transaction & idempotency** — the Kiss cron contract commits on normal return / rolls back on exception, so the advanced `byte_offset` is committed in the *same* transaction as its `access_event` rows. Defense in depth: `event_hash` UNIQUE + insert-if-not-exists, so manual backfill/re-ingest never double-counts. Batch cap `SvnLogMaxLinesPerRun` (default 50 000) per file per tick.
- **Mapping** — `raw_user → user_id` via `svn_user_alias` (auto-create on case-insensitive match to `users.user_name`, else leave NULL but keep raw text); `repo_key → repository` (auto-provision a `discovered='Y'` repo row so stats accrue immediately).
- **Derived tables** — after each batch, incrementally upsert `access_daily_rollup` (per touched `(repo,user,day)`) and `working_copy_state` (`MAX(revision)`/`MAX(ts)` from checkout/update/switch).

---

## SVN integration via SVNKit

Add `svnkit.jar` (+ its deps) to `libs/`; verify the build descriptors (`pom.xml`, `build.gradle`, and the `bld` classpath glob) include it. Note SVNKit's **TMate Open Source License** (BSD-style, attribution required) — acceptable for a self-hosted tool.

A shared Groovy helper (`backend/services` or a backend util package) wraps SVNKit so services stay thin:
- **Browse/history/diff** — `SVNRepository` (`getDir`/`getFile`/`getLatestRevision`), `SVNLogClient.doLog`, `SVNDiffClient.doDiff`. Read-only; uses `file://` against `repository.fs_path` (fast, no network).
- **Repo creation** — `SVNRepositoryFactory.createLocalRepository(fsPath, true, false)` (no svnadmin shell-out needed).
- **Merge requests** — `SVNDiffClient.doMerge(...)` dry-run for preview; on approval, real merge of `source_path`→`target_path` + `SVNCommitClient` commit, authenticated via an `ISVNAuthenticationManager` built from a configured service account in `application.ini`.

Groovy services can use SVNKit directly (it's on the classpath) and keep **hot reload**. No precompiled classes required.

---

## Full SVN-server management (auth)

SvnHub is the system of record for access; it serializes `repository_access` + `users` to svnserve's config files (the Tomcat process must run as / be able to write as `svn`, or via a small setgid helper — an operational note for Blake):
- Per-repo `conf/svnserve.conf` → point at shared `password-db`/`authz-db`, `anon-access = none`, `auth-access = write`.
- Shared `passwd` — written from `users` (SVN's passwd is plaintext; for hashed auth, configure svnserve **SASL** or migrate to Apache+htpasswd later — flagged as a follow-up; v1 manages the passwd file with a SvnHub-set SVN password distinct from the PBKDF2 login hash).
- Shared `authz` — written from `repository_access` (`[repo:/] user = rw|r`). Regenerated transactionally whenever access changes.

`org.kissweb.IniFile` can read/write the ini-style `svnserve.conf`; `authz`/`passwd` are written by a dedicated serializer (small, well-tested).

---

## Backend services (all `src/main/backend/services/`, Groovy, hot-reload)

Signature pattern from `services/Crud.groovy` / `services/Users.groovy`: `void method(JSONObject injson, JSONObject outjson, Connection db, ProcessServlet servlet)`. Current user via `servlet.getUserData().getUserId()/.getUsername()` (as in `Login.groovy`). Record API for all DB writes.

- `RepositoryService` — `getRepositories/getRepository/createRepository/updateRepository/scanRepositories` (creates FSFS repo via SVNKit; rewrites svnserve config).
- `RepositoryAccessService` — `getAccess/grant/revoke/reconcileAlias` (rewrites `authz`/`passwd`).
- `BrowseService` — `tree/listDir/cat` (SVNKit, read-only) + README markdown payload.
- `HistoryService` — `log/diff/revisionDetail` (serves `commit_cache`, fetches+caches misses).
- `StatsService` — the 10 metrics above (rollup/firehose queries).
- `IssueService` — `list/get/create/comment/setStatus`.
- `MergeRequestService` — `list/get/create/diffPreview/comment/approveAndMerge/close`.
- Cron: `IngestSvnLogs` (firehose, every minute) and `RefreshRepoHead` (SVNKit youngest + `commit_cache` warming, every few minutes), under `src/main/backend/CronTasks/` + `crontab` (model on `CronTasks/EveryMinute.groovy`).

---

## Frontend (all under `src/main/frontend/`, never `kiss/`)

Reuse the existing screen pattern (`screens/CRUD/`, `screens/Users/`): `.html` + IIFE `.js`, `Server.call(WS, method, data)`, `res._Success`, AG-Grid, popups (`<popup-title>`+`<popup-body>`), `Utils.yesNo`. Nav driven by `screens/Framework/Framework.html`+`.js` — rebrand from "Kiss Sample" to SvnHub.

Add to `src/main/frontend/lib/`: **marked.js** (README markdown), **highlight.js** (file/diff syntax color), **diff2html** (diffs), **Chart.js** (Insights charts).

Screens: Dashboard/repo list · Repository home (browser + README + recent commits) · File view (highlight.js) · Commit/diff view (diff2html) · Insights (freshness leaderboard, checkout/update charts, heatmap, hot paths, stale copies, revision adoption) · Admin (create repo, manage access) · Issues · Merge requests.

---

## Configuration additions (`application.ini [main]`)

```ini
DatabaseType          = PostgreSQL
DatabaseName          = svnhub
DatabaseUser          = svnhub
DatabasePassword      = ...
SvnReposRoot          = /home/repos
SvnLogFile            = /var/log/svnserve/svnserve.log
SvnLogRotateGlob      = svnserve.log.*
SvnLogPathPrefix      = /
SvnLogMaxLinesPerRun  = 50000
SvnServiceUser        = svnhub          ; SVN identity SvnHub commits merges as
SvnServicePassword    = ...
```

---

## Implementation sequencing

- **Phase 0 — Foundations:** switch `application.ini` to PostgreSQL + create DB; add SVNKit to `libs/` and frontend libs to `lib/`; rebrand nav shell; extend `users` (email/full_name/is_admin). Enable `svnserve --log-file` (Blake, ops).
- **Phase 1 — Repository core + full management:** `repository`/`repository_access`/`svn_user_alias` tables; `RepositoryService` (SVNKit create) + `RepositoryAccessService` (authz/passwd writer); admin screens; user→SVN identity sync.
- **Phase 2 — Browse / history / diff:** SVNKit helper; `commit_cache`(+path) + `RefreshRepoHead`; `BrowseService`/`HistoryService`; repo-home, file, diff, README screens.
- **Phase 3 — Statistics (differentiator):** `access_event`/`log_ingest_state`/`access_daily_rollup`/`working_copy_state`; `LogParser` (+ unit tests) and `IngestSvnLogs` cron; `StatsService`; Insights screen.
- **Phase 4 — Collaboration:** Issues (tables + service + screens); Merge requests (tables + SVNKit dry-run/merge + inline-comment diff UI).
- **Phase 5 — Polish:** fill in `AI/ApplicationDetails.md`; tests; end-to-end verification.

---

## Verification

- **Build & run:** `./bld -v build` then `./bld develop`; open `http://localhost:8000`, log in (`admin`/`Password#123`), confirm the SvnHub nav loads.
- **Repo lifecycle:** create a repo in the UI → confirm FSFS dir appears under `/home/repos`, `repository` row exists, and svnserve `authz`/`passwd` updated. From a shell, `svn checkout svn://localhost/<repo>` succeeds with the granted user and is denied for a non-granted user.
- **Browsing:** import sample content; verify tree/file/README render and `svn log`/diff match the UI; commit a revision and confirm `commit_cache` warms.
- **Statistics (core differentiator):** with `--log-file` enabled, run `svn co` then `svn up` as two different users; within ~1 min confirm `IngestSvnLogs` created `access_event` rows, `working_copy_state.last_synced_revision` advanced, and the Insights freshness leaderboard shows each user's revisions-behind. Re-run ingest manually and confirm **no duplicate** events (idempotency). Truncate/rotate the log and confirm the cursor recovers.
- **Unit tests:** `./bld -v test` — `LogParser` cases (anonymous `-`, `commit` with no path, `switch` two-paths, unparseable line, partial trailing line), and authz/passwd serializer output.
- **Collaboration:** open/close an issue with comments; create a branch, open a merge request, view the inline diff, approve → confirm SVNKit performs the `svn merge`+commit and `merged_rev` is recorded.

## Out of scope (intentionally excluded)
GitHub **Agents, Actions/CI, Projects, Security & Quality**. Deferred for later versions: full-text code search, stars/watch + notifications, releases/tag downloads, wiki, SASL/hashed SVN auth (v1 manages the passwd file directly).
