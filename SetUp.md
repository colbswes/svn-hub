# SvnHub — Cloud Ubuntu Server Setup

Step-by-step instructions to deploy SvnHub on a fresh **Ubuntu 24.04 LTS** (also
works on 22.04) cloud server. Commands assume a `sudo`-capable login.

> **What you are installing.** SvnHub is a Kiss-framework Java/Groovy web app
> (front + back served by **Tomcat 11**), backed by **PostgreSQL**, fronting a
> **Subversion** `svnserve` daemon. Statistics come from svnserve's `--log-file`.
> Email (verification + password-reset codes) is sent through **Postmark**.
> See `Architecture.md` for the full design.

In this guide:

| Thing | Value used below (change to taste) |
|---|---|
| App / code directory | `/opt/svnhub` |
| Service user | `svnhub` (home `/home/svnhub`) |
| SVN repositories root | `/srv/svn/repos` |
| SVN auth config dir | `/srv/svn/repos/.svnhub-conf` |
| svnserve log | `/srv/svn/svnserve.log` |
| PostgreSQL db / user | `svnhub` / `svnhub` |
| Public web hostname | `svnhub.example.com` |
| svn:// hostname | `svnhub.example.com` (port 3690) |
| Mail "From" | `do_not_reply@svn-hub.com` |

---

## 0. Prerequisites (before you touch the server)

- A server with **2 GB RAM minimum** (4 GB comfortable), 2 vCPUs, and disk sized
  for your repositories.
- A **domain name** pointing at the server's public IP:
  - an `A` record for `svnhub.example.com` (the web UI), and
  - the same host is fine for `svn://` (port 3690).
- **Cloud firewall / security group** allowing inbound **22** (SSH), **80**,
  **443** (web), and **3690** (svn). Leave 8080 closed (Tomcat stays internal).
- A **Postmark** account with a *server* created, its **Server API Token**, and
  the ability to add DNS records for the `MailFrom` domain (Step 11).

---

## 1. Base system

```bash
sudo apt update && sudo apt -y upgrade

# Create the unprivileged service user that owns the code and runs both daemons.
# Its home (/home/svnhub) is kept separate from the app directory (/opt/svnhub,
# created in Step 4) so the clone there lands in an empty directory.
sudo useradd --system --create-home --home-dir /home/svnhub --shell /bin/bash svnhub

# Host firewall (in addition to your cloud security group)
sudo apt -y install ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3690/tcp        # svnserve
sudo ufw --force enable
```

> 8080 (Tomcat) is intentionally **not** opened — it is reached only through the
> nginx reverse proxy on localhost (Step 10–11).

---

## 2. Install packages

Use the **headless** JDK (so AWT's X11 client libraries are not pulled onto this
server), and install `groff` **without its Recommends** (which would drag in
ghostscript and more X11 libraries):

```bash
sudo apt -y install openjdk-21-jdk-headless subversion postgresql git nginx \
                    certbot python3-certbot-nginx ghostscript

# groff (text/table PDF reports) — --no-install-recommends keeps it from pulling
# extra tools we don't need (ghostscript is installed explicitly above).
sudo apt -y install --no-install-recommends groff

java -version      # expect OpenJDK 21
svnserve --version # confirms Subversion is present
```

- **openjdk-21-jdk-headless** — JDK for the `bld` build and Tomcat. The *headless*
  variant omits AWT/Swing's X11 dependencies (see note) and is sufficient to build
  and run SvnHub.
- **subversion** — provides `svnserve`, `svn`, `svnadmin`.
- **postgresql**, **nginx**, **certbot** — database, reverse proxy, TLS.
- **groff** — text/table PDF reports (uses the `-Tpdf` driver).
- **ghostscript** — for PDF reports that embed images (Groff's `ps2pdf` path). It
  pulls two X11 *client* libraries (`libx11-6`, `libxt6t64`) via `libgs10` — that is
  unavoidable for any PostScript→PDF tool, but it is not an X server or desktop.

> **Why the headless JDK?** The full `openjdk-21-jdk` depends on the non-headless
> JRE, whose `java.desktop` (AWT/Java2D) links against a broad set of X11 **client
> libraries** (`libX11`, `libXext`, `libXi`, `libXrender`, `libXtst`, …) — pulled in
> even though the server has no display. The headless JDK omits all of that. (The
> `ghostscript` installed above still brings the two small client libs `libx11-6` /
> `libxt6t64` via `libgs10` — unavoidable for any PostScript→PDF tool, and client
> libraries only, not an X server or desktop. `--no-install-recommends groff` keeps
> groff from pulling further extras.)

---

## 3. PostgreSQL database

```bash
# Pick a strong password and use it again in application.ini (Step 6).
DB_PASS='CHANGE-ME-strong-db-password'

sudo -u postgres psql <<SQL
CREATE USER svnhub WITH PASSWORD '${DB_PASS}';
CREATE DATABASE svnhub OWNER svnhub;
SQL
```

Verify a password (TCP) login works — this is how the app connects:

```bash
PGPASSWORD="$DB_PASS" psql -h localhost -U svnhub -d svnhub -c '\conninfo'
```

If that fails with an auth error, ensure `host all all 127.0.0.1/32 scram-sha-256`
is present in `/etc/postgresql/*/main/pg_hba.conf`, then
`sudo systemctl restart postgresql`.

---

## 4. Get the code

```bash
# /opt is root-owned, so create the app directory and hand it to svnhub first,
# then clone into the now-empty directory.
sudo mkdir -p /opt/svnhub
sudo chown svnhub:svnhub /opt/svnhub
sudo -u svnhub git clone https://github.com/blakemcbride/svn-hub /opt/svnhub
```

(If you copy the tree up manually instead of cloning, make sure
`/opt/svnhub` is owned by `svnhub:svnhub`.)

---

## 5. SVN storage directories

```bash
sudo mkdir -p /srv/svn/repos
sudo chown -R svnhub:svnhub /srv/svn
sudo chmod 700 /srv/svn          # repos + the cleartext svnserve passwd live here
```

SvnHub creates each repository under `/srv/svn/repos/<handle>/<name>` and writes
the svnserve auth files itself (a shared `passwd`, per-repo `authz` and
`svnserve.conf`) — you do **not** create repos by hand.

---

## 6. Configure `application.ini`

`application.ini` holds all secrets and is **gitignored** — create it from the
committed template:

```bash
sudo -u svnhub cp /opt/svnhub/src/main/backend/application.template.ini \
                  /opt/svnhub/src/main/backend/application.ini
sudo -u svnhub nano /opt/svnhub/src/main/backend/application.ini
```

Set at least these keys in the `[main]` section:

```ini
# --- Database (match Step 3) ---
DatabaseType     = PostgreSQL
DatabaseHost     = localhost
DatabasePort     = 5432
DatabaseName     = svnhub
DatabaseUser     = svnhub
DatabasePassword = CHANGE-ME-strong-db-password

# --- SvnHub / svnserve (match Step 5) ---
SvnReposRoot         = /srv/svn/repos
SvnConfDir           = /srv/svn/repos/.svnhub-conf
SvnLogFile           = /srv/svn/svnserve.log
SvnLogRotateGlob     = svnserve.log.*
SvnLogPathPrefix     = /
SvnLogMaxLinesPerRun = 50000
SvnServiceUser       = svnhub
SvnServicePassword   = ""
SvnBaseUrl           = svn://svnhub.example.com

# --- Email (Postmark) ---
PostmarkApiToken  = your-postmark-server-token
MailFrom          = do_not_reply@svn-hub.com
MailFromName      = Svn-Hub
MailMessageStream = outbound
MailEnabled       = true
```

> **Critical gotcha:** every key must have a value, and **empty values must be
> quoted** as `Key = ""`. A bare `Key =` parses to `null` and crashes startup
> (the database is then never configured). `SvnServicePassword = ""` above is
> correct.

Lock the file down (it contains secrets):

```bash
sudo chmod 600 /opt/svnhub/src/main/backend/application.ini
```

---

## 7. Load the database schema

Load the baseline schema once. (On every start the app's auto-update facility
brings the schema up to the latest version automatically — see `AutoUpdate.md`.)

```bash
cd /opt/svnhub
sudo -u svnhub env PGPASSWORD='CHANGE-ME-strong-db-password' \
     psql -h localhost -U svnhub -d svnhub -f schema.sql
```

This also seeds a default administrator — **login `admin`, password
`Password#123`** — which you will change on first login (Step 12).

---

## 8. Build

The build uses the project's `bld` tool (no Maven/Gradle). It compiles
everything, downloads its own Tomcat into `/opt/svnhub/tomcat`, and deploys the
app there.

```bash
cd /opt/svnhub
sudo -u svnhub ./bld -v build
```

A successful build leaves the deployable app under `/opt/svnhub/tomcat/webapps/ROOT`.

---

## 9. svnserve service (systemd)

Serve the repositories with logging enabled (the log is SvnHub's statistics
firehose). Create `/etc/systemd/system/svnserve.service`:

```bash
sudo tee /etc/systemd/system/svnserve.service >/dev/null <<'UNIT'
[Unit]
Description=svnserve (Subversion) for SvnHub
After=network.target

[Service]
Type=simple
User=svnhub
Group=svnhub
ExecStart=/usr/bin/svnserve --foreground -d -r /srv/svn/repos --log-file /srv/svn/svnserve.log
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now svnserve
sudo systemctl status svnserve --no-pager
```

Access control is enforced per-repository by the `authz`/`svnserve.conf` files
SvnHub generates (anonymous access is denied; private repos deny all but granted
users). Authentication uses the cleartext svnserve `passwd` — keep `/srv/svn`
mode `700` and owned by `svnhub`.

---

## 10. Tomcat (backend) service (systemd)

Run the Tomcat that `bld` set up, as the `svnhub` user. `KISS_ROOT` tells the app
where the backend lives (so it reads `/opt/svnhub/src/main/backend/application.ini`).

Create `/etc/systemd/system/svnhub.service`:

```bash
sudo tee /etc/systemd/system/svnhub.service >/dev/null <<'UNIT'
[Unit]
Description=SvnHub (Tomcat backend)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=svnhub
Group=svnhub
Environment=JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
Environment=CATALINA_HOME=/opt/svnhub/tomcat
Environment=CATALINA_BASE=/opt/svnhub/tomcat
Environment=KISS_ROOT=/opt/svnhub
WorkingDirectory=/opt/svnhub
ExecStart=/opt/svnhub/tomcat/bin/catalina.sh run
ExecStop=/opt/svnhub/tomcat/bin/catalina.sh stop
SuccessExitStatus=143
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now svnhub
```

Confirm it started and migrated the database to the latest version:

```bash
sleep 8
# Backend should answer on localhost:8080
curl -s -X POST http://localhost:8080/rest -H 'Content-Type: application/json' \
  -d '{"_class":"","_method":"Login","username":"admin","password":"Password#123"}'
# -> {"_Success":true, ... "isAdmin":true ...}

# Schema is current (db_version should be the latest, e.g. 4)
sudo -u svnhub env PGPASSWORD='CHANGE-ME-strong-db-password' \
     psql -h localhost -U svnhub -d svnhub -tAc 'SELECT max(version) FROM db_version'
```

Server log: `/opt/svnhub/tomcat/logs/catalina.out`.

---

## 11. Reverse proxy + HTTPS

Tomcat serves both the static frontend and the `/rest` API at the same origin, so
you only need to proxy one upstream. Create `/etc/nginx/sites-available/svnhub`:

```bash
sudo tee /etc/nginx/sites-available/svnhub >/dev/null <<'NGINX'
server {
    listen 80;
    server_name svnhub.example.com;

    client_max_body_size 200M;     # allow large file uploads via the web UI

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/svnhub /etc/nginx/sites-enabled/svnhub
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Obtain and install a Let's Encrypt certificate (also configures the 80->443 redirect)
sudo certbot --nginx -d svnhub.example.com
```

Browse to **https://svnhub.example.com** — the SvnHub login page should load.

---

## 12. Postmark sender verification (email)

Email codes will only *deliver* once Postmark trusts the `MailFrom` domain.

1. In Postmark, add a **Sender Signature** for `do_not_reply@svn-hub.com` **or**
   verify the whole `svn-hub.com` domain.
2. Add the **DKIM** and **Return-Path** DNS records Postmark shows you to the
   `svn-hub.com` DNS zone; wait for Postmark to mark them **verified**.
3. Confirm a live send (replace the recipient with your own address):

```bash
curl -s -X POST https://api.postmarkapp.com/email \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -H 'X-Postmark-Server-Token: your-postmark-server-token' \
  -d '{"From":"do_not_reply@svn-hub.com","To":"you@example.com",
       "Subject":"SvnHub test","HtmlBody":"<p>ok</p>","MessageStream":"outbound"}'
# Success looks like: {"ErrorCode":0,"Message":"OK",...}
```

> Until the sender is verified, registration/reset still work but the code email
> won't arrive (the send error is caught and logged in `catalina.out`).

---

## 13. First login & smoke test

1. Open **https://svnhub.example.com**, sign in as **`admin` / `Password#123`**.
2. Immediately use the top-bar **Change password** to set a strong admin password
   (this also sets the admin's `svn` password).
3. (Optional) Open **Users** and give the admin account an **email** so admin can
   use email verification / password reset too.
4. Register a normal account with a real email, confirm the **6-digit code
   arrives**, and verify it.
5. Create a repository, then test SVN from a workstation:

```bash
svn checkout svn://svnhub.example.com/<handle>/<repo> --username <email>
```

---

## 14. Maintenance

**Upgrade to a new version** (the DB auto-migrates on start):

```bash
sudo systemctl stop svnhub
cd /opt/svnhub
sudo -u svnhub git pull
sudo -u svnhub ./bld clean      # REQUIRED when the schema version changes (see note)
sudo -u svnhub ./bld -v build
sudo systemctl start svnhub
```

> **Why `clean` on upgrades:** the schema version is a compile-time constant that
> `bld`'s incremental compile can leave stale, so the migrator may skip a new
> migration. A clean build avoids this. Always take a database backup before an
> upgrade that bumps the schema version. (Details in `AutoUpdate.md`.)

**Backups:**

```bash
# Database
sudo -u svnhub env PGPASSWORD='...' pg_dump -h localhost -U svnhub svnhub \
     | gzip > /var/backups/svnhub-db-$(date +%F).sql.gz
# Repositories (and the generated auth files)
sudo tar czf /var/backups/svnhub-repos-$(date +%F).tar.gz -C /srv svn
```

**Logs:** backend `/opt/svnhub/tomcat/logs/catalina.out`; svnserve
`/srv/svn/svnserve.log`; nginx `/var/log/nginx/`.

**Service control:** `sudo systemctl {status,restart,stop} svnhub svnserve`.

---

## 15. Security checklist

- [ ] `application.ini` is mode `600`, owned by `svnhub`, and **never committed**.
- [ ] Default `admin` password changed; consider disabling/renaming it.
- [ ] `/srv/svn` is mode `700`, owned by `svnhub` (it holds cleartext SVN passwords).
- [ ] Only 22/80/443/3690 are reachable; 8080 is internal only.
- [ ] HTTPS enforced (certbot installed the 80→443 redirect); cert auto-renews
      (`systemctl status certbot.timer`).
- [ ] Postmark sender verified so reset/verification email actually delivers.
- [ ] Regular database + repository backups scheduled.

---

## 16. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Startup fails; services get a null DB connection | A bare `Key =` in `application.ini`. Quote empties: `Key = ""`. |
| A new schema migration didn't apply after an upgrade | Stale compile-time version constant — `./bld clean` then `./bld -v build`, restart. Verify `SELECT max(version) FROM db_version`. |
| Login says "Invalid login." for everyone after a deploy | Schema migration failed (fail-closed). Check `catalina.out` for the `SCHEMA MIGRATION FAILED` banner; fix and restart. |
| Web UI loads but `svn checkout` fails | `svnserve` not running, port 3690 blocked (cloud SG/ufw), or `SvnBaseUrl` wrong. |
| Verification/reset email never arrives | Postmark sender not verified, or wrong `PostmarkApiToken`. Check `catalina.out` for the Postmark error. |
| Can't create repos / auth files | Tomcat user lacks write to `/srv/svn`. Ensure `svnhub:svnhub` owns it and both services run as `svnhub`. |
```
