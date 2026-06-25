# SvnHub — Development Machine Setup

Step-by-step instructions to set up SvnHub for **local development** on your own
workstation (Linux, macOS, or WSL). The result is the full app running locally:
the front-end on **http://localhost:8000**, the Tomcat back-end on **8080**, a
PostgreSQL database, and a local `svnserve` you can `svn checkout` from.

> Deploying to a **production cloud server** instead? See **[Setup-Cloud.md](Setup-Cloud.md)** —
> it covers systemd services, nginx + HTTPS, a dedicated service user, and Postmark.
> This guide is the lightweight, run-it-as-yourself counterpart for hacking on the code.

> **What you are running.** SvnHub is a Kiss-framework Java/Groovy web app
> (front + back served by **Tomcat 11**), backed by **PostgreSQL**, fronting a
> **Subversion** `svnserve` daemon. Statistics come from svnserve's `--log-file`.
> See `Architecture.md` for the full design.

Unlike the cloud setup, development needs **no** dedicated service user, no nginx,
no certbot, and no systemd — everything runs as you, in the project tree, started
by the `bld` tool.

In this guide we assume you clone into `~/svn-hub` and refer to that path as
`$PROJ`. Adjust to taste.

| Thing | Development value |
|---|---|
| Project / code directory | `~/svn-hub` (referred to as `$PROJ`) |
| Runs as | **your own** login (no service user) |
| SVN repositories root | `$PROJ/dev-repos` (in-tree, gitignored) |
| svnserve log | `$PROJ/dev-repos/svnserve.log` |
| PostgreSQL db / user | `svnhub` / `svnhub` |
| Front-end (dev server) | `http://localhost:8000` |
| Back-end (Tomcat) | `http://localhost:8080` (don't browse this directly) |
| Debug port (JPDA) | `9000` |
| svn:// (dev svnserve) | `svn://localhost:3691` |

---

## 1. Prerequisites — install the tools

You need a **JDK 17+** (21 recommended, to match production), **Subversion**
(`svn`, `svnserve`, `svnadmin`), **PostgreSQL**, and **git**. `groff` is optional
(only needed to exercise PDF report generation).

Pick the line for your platform:

**Fedora / RHEL:**

```bash
sudo dnf install java-21-openjdk-devel subversion postgresql-server postgresql git groff
```

**Debian / Ubuntu / WSL:**

```bash
sudo apt update
sudo apt -y install openjdk-21-jdk subversion postgresql git groff
```

**macOS (Homebrew):**

```bash
brew install openjdk@21 subversion postgresql@16 git groff
```

Confirm the toolchain:

```bash
java -version        # expect 17+ (21 recommended)
javac -version       # the JDK must include javac (bld compiles the app)
svnserve --version   # confirms Subversion is present
```

> A **full** (non-headless) JDK is fine for development — you may want AWT for the
> optional Electron desktop wrapper or IDE tooling. (Production uses the *headless*
> JDK; here convenience wins.)

---

## 2. Start PostgreSQL and create the database

Make sure the PostgreSQL server is running and initialized:

- **Fedora / RHEL** (first time only): `sudo postgresql-setup --initdb`, then
  `sudo systemctl enable --now postgresql`.
- **Debian / Ubuntu / WSL**: the package starts it automatically
  (`sudo systemctl enable --now postgresql` if not).
- **macOS**: `brew services start postgresql@16`.

Create the `svnhub` role and database (pick a password and reuse it in Step 4):

```bash
DB_PASS='dev-db-password'

sudo -u postgres psql <<SQL
CREATE USER svnhub WITH PASSWORD '${DB_PASS}';
CREATE DATABASE svnhub OWNER svnhub;
SQL
```

> On macOS (Homebrew) there is no `postgres` OS user — drop the `sudo -u postgres`
> and just run `psql postgres <<SQL ... SQL` as yourself.

Verify a password (TCP) login works — this is how the app connects:

```bash
PGPASSWORD="$DB_PASS" psql -h localhost -U svnhub -d svnhub -c '\conninfo'
```

If it fails with an auth error, ensure `pg_hba.conf` has
`host all all 127.0.0.1/32 scram-sha-256` (or `md5`) and restart PostgreSQL.

---

## 3. Get the code

```bash
git clone https://github.com/blakemcbride/svn-hub ~/svn-hub
cd ~/svn-hub
PROJ=$(pwd)          # used by later commands in this guide
```

Create the in-tree SVN repositories root (gitignored, so a fresh clone has none):

```bash
mkdir -p "$PROJ/dev-repos"
```

SvnHub creates each repository under `dev-repos/<handle>/<name>` and writes the
svnserve auth files itself (a shared `passwd`, per-repo `authz`/`svnserve.conf`)
the first time you create a repo in the UI — you do **not** create repos by hand.

---

## 4. Configure `application.ini`

`application.ini` holds your DB password and SVN service credentials and is
**gitignored** — create it from the committed template:

```bash
cp "$PROJ/src/main/backend/application.template.ini" \
   "$PROJ/src/main/backend/application.ini"
$EDITOR "$PROJ/src/main/backend/application.ini"
```

Set these keys in the `[main]` section for a local dev box (use the **absolute**
paths to your clone's `dev-repos`):

```ini
# --- Database (match Step 2) ---
DatabaseType     = PostgreSQL
DatabaseHost     = localhost
DatabasePort     = 5432
DatabaseName     = svnhub
DatabaseUser     = svnhub
DatabasePassword = dev-db-password

# --- SvnHub / svnserve (in-tree dev repos; use YOUR absolute path) ---
SvnReposRoot         = /home/you/svn-hub/dev-repos
SvnConfDir           = /home/you/svn-hub/dev-repos/.svnhub-conf
SvnLogFile           = /home/you/svn-hub/dev-repos/svnserve.log
SvnLogRotateGlob     = svnserve.log.*
SvnLogPathPrefix     = /
SvnLogMaxLinesPerRun = 50000
SvnServiceUser       = svnhub
SvnServicePassword   = ""
SvnBaseUrl           = svn://localhost:3691

# --- Email: log codes to catalina.out instead of sending (no Postmark needed) ---
PostmarkApiToken  = ""
MailFrom          = do_not_reply@svn-hub.com
MailFromName      = Svn-Hub
MailMessageStream = outbound
MailEnabled       = false
```

> **Critical gotcha:** every key must have a value, and **empty values must be
> quoted** as `Key = ""`. A bare `Key =` parses to `null` and crashes startup (the
> database is then never configured). `SvnServicePassword = ""` and
> `PostmarkApiToken = ""` above are correct.

> **Email in dev:** `MailEnabled = false` makes SvnHub **log** verification /
> password-reset emails to `catalina.out` instead of sending them — so you can grab
> the 6-digit codes during registration without a Postmark account. Leave Postmark
> blank.

> **CORS in dev:** you do **not** need to touch `AllowedOrigins`. The dev build
> (`./bld develop` / `./bld build`) deploys the permissive `web-unsafe.xml`
> (`cors.allowed.origins = *`), so the `:8000` front-end can call the `:8080`
> back-end freely. (`AllowedOrigins` is only stamped into the locked-down web.xml by
> `./bld war` for production.) Just leave the template's value in place — but keep it
> non-empty or quoted, per the gotcha above.

---

## 5. Load the database schema

Load the baseline schema once. (On every start the app's auto-update facility
brings the schema up to the latest version automatically — see `AutoUpdate.md`.)

```bash
cd "$PROJ"
PGPASSWORD='dev-db-password' psql -h localhost -U svnhub -d svnhub -f schema.sql
```

This also seeds a default administrator — **login `admin`, password
`Password#123`** — which you can change after first login.

---

## 6. Start the dev `svnserve`

Run a local `svnserve` against the in-tree repos, with logging enabled (the log is
SvnHub's statistics firehose). Use a **separate terminal** and leave it running:

```bash
cd "$PROJ"
svnserve --foreground -d -r "$PROJ/dev-repos" \
         --listen-port 3691 \
         --log-file "$PROJ/dev-repos/svnserve.log"
```

> **Port 3691, not 3690.** The dev config (`SvnBaseUrl = svn://localhost:3691`)
> uses 3691 so it won't clash with any system-wide `svnserve` on Subversion's
> default port 3690. If you prefer 3690, just keep `--listen-port` and `SvnBaseUrl`
> in agreement. No root/firewall changes are needed for a local port.

Access control is enforced per-repository by the `authz`/`svnserve.conf` files
SvnHub generates; SvnHub is the system of record for the cleartext svnserve
`passwd`.

---

## 7. Build and run

The project uses its own `bld` tool (no Maven/Gradle). The `develop` task builds
everything, downloads/sets up a local Tomcat under `$PROJ/tomcat`, deploys the app,
and starts both the back-end (8080) and the SimpleWebServer front-end (8000):

```bash
cd "$PROJ"
./bld develop
```

When it prints `***** SERVER IS RUNNING *****`, browse to
**http://localhost:8000** (do **not** use port 8080 directly). `./bld develop`
stays in the foreground — press a key in that terminal to stop Tomcat.

**Watching the log** (handy in a third terminal — this is where the emailed codes
land when `MailEnabled = false`):

```bash
./view-log          # tail -F tomcat/logs/catalina.out
```

**Alternative — run the two servers independently** (each backgrounds itself, so
you get your prompt back):

```bash
./bld start-backend     # build + start Tomcat (8080), debuggable on 9000
./bld start-frontend    # start the SimpleWebServer front-end (8000)
# ... later ...
./bld stop-frontend
./bld stop-backend
```

Run `./bld` with no arguments to list every available task.

---

## 8. First login & smoke test

1. Open **http://localhost:8000** and sign in as **`admin` / `Password#123`**.
2. (Optional) Use the top-bar **Change password** to set your own admin password
   (this also sets the admin's `svn` password).
3. Register a normal account. With `MailEnabled = false`, the 6-digit verification
   code is **printed to `catalina.out`** — copy it from `./view-log` and verify.
4. Create a repository in the UI, then test SVN from a workstation directory:

```bash
svn checkout svn://localhost:3691/<handle>/<repo> --username <email>
```

A successful checkout (plus a later `svn update`) shows up in the svnserve log and
feeds the Insights/statistics screens.

---

## 9. The development loop

- **Back-end services** (Groovy/Java/Lisp under `src/main/backend/`) **auto-compile
  and reload** while Tomcat runs — just save and re-issue the request. No restart.
- **Front-end** files under `src/main/frontend/` are served as static assets —
  **just reload the browser** (do a hard refresh to bypass cache).
- **Framework / precompiled code** under `src/main/core/` and
  `src/main/precompiled/` is compiled by `bld` and needs a **rebuild + restart**
  (`./bld stop-backend && ./bld start-backend`, or restart `./bld develop`).
- Useful helper scripts in the project root: `./view-log` (tail the server log),
  `./is-tomcat-running`, `./kill-tomcat` (force-kill a stuck Tomcat),
  `./serve` (front-end only on 8000).

| Port | Used by |
|---|---|
| 8000 | Front-end dev server (browse here) |
| 8080 | Tomcat back-end (`/rest` JSON-RPC; do not browse directly) |
| 9000 | JVM debug (JPDA) — attach your IDE here |
| 3691 | dev `svnserve` (`svn://localhost:3691`) |

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Startup fails; services get a null DB connection | A bare `Key =` in `application.ini`. Quote empties: `Key = ""`. |
| "Error communicating with the server" in the browser | Back-end not up on 8080, or you browsed `:8080` instead of `:8000`. Check `./view-log`. |
| Login works for everyone with any password | The DB never configured (see the null-connection row) — fix `application.ini` and restart. |
| `svn checkout` fails / connection refused | The dev `svnserve` (Step 6) isn't running, or `--listen-port` ≠ `SvnBaseUrl` port. |
| Verification code never shows | With `MailEnabled = false` it's in `catalina.out`, not your inbox — watch `./view-log`. |
| Tomcat won't restart / port 8080 busy | A stray Tomcat — run `./kill-tomcat`, then `./bld start-backend`. |
| A new schema migration didn't apply | Stale build — `./bld clean` then rebuild/restart; verify `SELECT max(version) FROM db_version`. |
