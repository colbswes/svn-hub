# SvnHub — Application Details

A self-hosted, GitHub-like web service built on the Kiss framework, but backed by
**Subversion instead of Git**. Two things distinguish it from existing SVN front-ends
(ViewVC, WebSVN, Trac):

1. **Rich per-user checkout/update statistics** — the flagship differentiator. It
   tracks *who* checked out or updated *which* repo to *which revision*, how far behind
   HEAD each developer's working copy is, read hotspots, stale/abandoned working copies,
   and more — derived from the svnserve operational log.
2. It **deliberately omits** GitHub's Agents, Actions (CI/CD), Projects (kanban), and
   Security & Quality features.

See `Plan.md` (repo root) for the original design. `AI/KnowledgeBase.md` is the Kiss
framework reference — read it before changing framework code.

## Relationship to the Kiss framework (upstream sync)
- The canonical upstream is Blake's local Kiss checkout. SvnHub's shared framework
  tree — `src/main/frontend/kiss/`, `src/main/core/org/kissweb/`, `bld`, and
  `AI/KnowledgeBase.md` — is kept **byte-identical** to that upstream. The sole
  intentional code exception is `Tasks.java`, whose `libs()` adds the SVNKit
  dependency block. `AI/KnowledgeBase.md` must be identical in both repos and hold
  only generic Kiss-framework material; anything SvnHub-specific goes in this file.
- Generic improvements that arrive through SvnHub (including contributor PRs) are
  **upstreamed** to canonical Kiss, not kept only here. Application-specific values
  must be parameterized out of the framework and supplied from the app layer.
- **Re-audit every contributor PR for framework drift** before it lands: `diff -rq`
  the two `kiss/` trees, confirm no app name or brand value leaked into `kiss/`, and
  upstream any legitimately-generic additions. (Commit `26751a6` slipped 9 generic
  framework edits plus one hardcoded brand color into `kiss/`; both were reconciled
  afterward.)
- **Brand values ride framework variables:** the framework exposes neutral-defaulted
  hooks and SvnHub supplies its specifics from `svnhub-theme.css`. Example: the Kiss
  search-input clear-glow reads a `--glow-color` CSS variable (neutral default in
  `kiss/Utils.css`); SvnHub sets `--glow-color: 68, 90, 168` (its `--copper` accent)
  in `svnhub-theme.css`.

## Locked-in architecture decisions
- **Full management**: SvnHub creates repositories and manages SVN auth (writes svnserve
  `passwd`/`authz`/`svnserve.conf`) through the web UI.
- **SVNKit** (`libs/svnkit-1.10.11.jar` + sqljet, sequence-library, antlr-runtime,
  lz4-java) for all repository browse/history/diff/admin/merge. Registered in
  `Tasks.java` local deps; deployed via `copyTree(libs)`.
- **PostgreSQL** (database `svnhub`, role `svnhub`). The dev DB password lives only in
  `src/main/backend/application.ini`, which is **gitignored** (do not commit it).
- First-version collaboration: README rendering, Issues, Merge requests. (Full-text
  search, stars/watch, releases, wiki are deferred.)

## User model & repository visibility
- **Two classes of user:** `regular` (default) and `admin` (`users.is_admin`). Anyone can
  **self-register** (GitHub-style, no email verification) via the public `Register` service
  (allow-listed in `KissInit.groovy`); self-registered users are regular. Only an **admin**
  can promote a user or manage accounts — the `Users` service is admin-gated and its nav
  item is hidden for regular users. For a self-registered user the **email address is the
  username** (login identifier); registration captures a single password used for both web
  login (PBKDF2 hash) and `svn` checkouts (clear text in svnserve's passwd). (The admin
  Users screen can still set the login id and email independently, e.g. for the bootstrap admin.)
- **Handle (username) & per-user namespace:** every user also has a URL-safe **`handle`**
  (`users.handle`, unique) chosen at registration — the public "username". Repositories are
  **namespaced under the owner's handle**: `repository.repo_key` is `"<handle>/<name>"`, on
  disk `<SvnReposRoot>/<handle>/<name>`, served at `svn://host/<handle>/<name>` (svnserve
  resolves nested repos by walking up the path). So two different users can each create a
  repo named `utils`. Because `repo_key` stays globally unique, `fs_path = root + "/" +
  repo_key`, the checkout URL, and the svnserve-log → repo mapping all work unchanged; only
  `createRepository`/`scanRepositories` (build/scan the two-segment key) and display differ.
  svnserve auth usernames remain the login id (email) — the auth subsystem is unchanged.
- **Ownership & visibility:** each `repository` has an `owner_id` (creator) and a
  `visibility` of `public` or `private`. "My Repositories" (`getRepositories`) shows repos
  the user owns or is granted; **Explore** (`searchRepositories`) finds *other* repos they
  may checkout/clone — all `public` repos plus any private ones they're granted. A public
  repo's authz gets a `* = r` catch-all so any authenticated user can checkout, and
  `RepoAccess.canRead` honors `public` so web browsing matches. Each repo row carries a
  `checkoutUrl` built from `SvnBaseUrl`. Changing visibility re-emits the repo's authz.

## Two independent SVN touch-points
- **SVNKit** is how SvnHub *itself* reads/administers/merges repos (over `file://`).
- **svnserve `--log-file`** is how SvnHub learns what *other developers* did
  (checkout/update/etc). SVNKit cannot see other clients' reads — only the server log
  can. Both are required. (Note: merges committed by SvnHub go over `file://` and so do
  *not* appear in the svnserve log.)

## Data model (`schema.sql`, PostgreSQL)
Timestamps are `bigint` epoch-ms; day buckets are `integer` YYYYMMDD; flags are
`char(1)` 'Y'/'N'.
- Identity/repos: `users` (extended: full_name, email, is_admin, svn_password),
  `repository`, `repository_access`, `svn_user_alias`.
- Statistics: `access_event` (firehose, SHA-256 `event_hash` unique for idempotency),
  `log_ingest_state` (per-inode cursor), `access_daily_rollup`, `working_copy_state`.
- Browse cache: `commit_cache`, `commit_cache_path`.
- Collaboration: `issue`, `issue_comment`, `merge_request`, `mr_comment`.

## Backend (`src/main/backend/`)
Precompiled helpers (`src/main/precompiled/com/svnhub/`, rebuild + restart on change):
`SvnRepo` (SVNKit wrapper), `SvnAuth` (svnserve file builders), `SvnAuthManager`
(regenerate auth from DB), `RepoAccess` (shared access checks — used by all services
instead of cross-Groovy-service calls), `Json` (Java collections → Kiss JSON),
`SvnLogParser` (svnserve log line parser, unit-tested in
`src/test/core/com/svnhub/SvnLogParserTest.java`).

Groovy services (`src/main/backend/services/`, hot-reload): `RepositoryService`,
`RepositoryAccessService`, `BrowseService`, `HistoryService`, `StatsService`,
`IssueService`, `MergeRequestService`, plus the extended `Users`.

Cron (`src/main/backend/CronTasks/`, see `crontab`): `IngestSvnLogs` (every minute —
incremental, idempotent log ingest), `RefreshRepoHead` (every 5 min — refresh HEAD +
warm commit cache).

## Frontend (`src/main/frontend/screens/`, never `kiss/`)
`Framework` (rebranded nav), `Repositories`, `Repository` (browse/README/commits),
`Insights` (stats), `Issues`, `MergeRequests`, `Users`. Rich content (markdown, code,
diffs) is rendered by libs in `frontend/lib/` (marked, highlight.js, diff2html; Chart.js
is loaded but charts are currently drawn as HTML/CSS) and injected via the component
API `text-label.setHTMLValue(...)` — **app screens never touch the DOM directly**.

## Navigation (hash routing, since 2026-07-03)
SvnHub uses Kiss's hash router and bootstrap architecture: `index.html` (byte-stable
kernel; CSP hash pinned in SecurityHeadersFilter) → `kiss/bootstrap.js` →
`SystemInfo.js` → framework libs → `routes.js` → `index.js`. Routes are declared in
`frontend/routes.js`; `index.js` loads SvnHub's extra libs/stylesheets (marked,
highlight.js, diff2html, Chart.js) with the bootstrap's global loaders, then calls
`Router.start()`.
- Screens navigate **only** with `Router.go('/path')` (Router calls `Utils.loadPage`
  internally, which also does the cleanup) — never `Utils.loadPage` for navigation.
- Shell is `/` (`screens/Framework/Framework`); it lands on the repository list when
  the shell route itself is the destination. Sub-screens render into `app-screen-area`.
- Public routes (`auth:false`): `/login` (device-aware page), `/why`, `/register`,
  `/forgot`. Authenticated full-body gates: `/verify`, `/setpw`.
- Repo-scoped screens (`/repository`, `/issues`, `/merge-requests`) read
  `repoId`/`repoKey`/`repoName` via `Utils.getData` (AppState-backed, survives reload)
  and `Router.replace('/repositories')` when absent (bad deep link).
- Back/Forward are in-app navigation. The old `DOMUtils.preventNavigation`
  logout-confirm was **removed** — it fights hash routing. Logout and session expiry
  route to `/login` via `Server.logout()` / `Router.gotoLogin()`.
- Sessions persist per tab (`SystemInfo.stateStore = 'session'`);
  `Server.verifyServerInstance()` in `index.js` forces re-login after a backend
  restart (`_BootId` mismatch).

## Configuration (`application.ini [main]`)
`DatabaseType=PostgreSQL`, `DatabaseName/User/Password=svnhub`, plus SvnHub keys:
`SvnReposRoot`, `SvnConfDir`, `SvnLogFile`, `SvnLogRotateGlob`, `SvnLogPathPrefix`,
`SvnLogMaxLinesPerRun`, `SvnServiceUser`, `SvnServicePassword`. Read via
`MainServlet.getEnvironment(key)`.

> **Ini gotcha:** `MainServlet.environment` is a `Hashtable`, which rejects null values.
> A bare empty value (`Key =`) parses to null (IniFile.unquote returns null for "") and
> throws an NPE in `readIniFile`, aborting `KissInit` and leaving the app with **no DB**.
> Always quote empty values: `Key = ""`.

## Operational prerequisites (production)
- Run svnserve with logging: `svnserve -d -r /home/repos --log-file /var/log/svnserve/svnserve.log`.
- The app process needs filesystem write access to `SvnReposRoot` and `SvnConfDir`
  (run as the `svn` user, or equivalent) so it can create repos and write auth files.
- SVN passwords are stored in svnserve's `passwd` in the clear (an SVN limitation),
  intentionally separate from the PBKDF2 login hash. Hashed SVN auth (SASL / Apache
  htpasswd) is a future enhancement.

## Build / run / verify
- `./bld build` — compile (precompiled + core). `./bld start-backend` / `stop-backend`
  — run tomcat backend (port 8080) non-interactively. `./bld develop` — interactive
  frontend (8000) + backend.
- `./bld unit-tests` then `java -jar work/KissUnitTest.jar --select-class=com.svnhub.SvnLogParserTest`.
- Dev data lives under `dev-repos/` (gitignored). A demo repo `acme` and a test
  svnserve on port 3691 were used during development.
