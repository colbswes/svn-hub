-- ============================================================================
-- SvnHub schema (PostgreSQL)
--
-- A GitHub-like service for Subversion. See Plan.md for the full design.
--
-- Conventions:
--   * timestamps are stored as bigint epoch-milliseconds (the Kiss frontend
--     DateTimeUtils.formatDate() auto-detects epoch ms).
--   * day buckets are integer YYYYMMDD (org.kissweb.DateUtils.toInt).
--   * boolean-ish flags are character(1) 'Y'/'N' with a CHECK, matching the
--     existing users table style.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users  (identity / login)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    user_id        serial                 NOT NULL PRIMARY KEY,
    user_name      character varying(255) NOT NULL UNIQUE,   -- for self-registered users this equals their email
    user_password  character varying(255) NOT NULL,           -- PBKDF2 login hash (org.kissweb.PasswordHash)
    svn_password   character varying(255),                    -- SvnHub-managed SVN password (written to svnserve passwd)
    full_name      character varying(200),
    email          character varying(255),
    is_admin       character(1)           NOT NULL DEFAULT 'N',
    user_active    character(1)           NOT NULL DEFAULT 'Y',
    created_ts     bigint,
    CONSTRAINT users_active_chk CHECK (user_active = 'Y' OR user_active = 'N'),
    CONSTRAINT users_admin_chk  CHECK (is_admin    = 'Y' OR is_admin    = 'N')
);

-- Password is the PBKDF2 hash of 'password' (see org.kissweb.PasswordHash). Login name: kiss
INSERT INTO users (user_name, user_password, full_name, is_admin, user_active)
VALUES ('kiss', 'pbkdf2$600000$XXxhRHyyeLvk3AfmOhTYhA$ZX/GcXFZJaj94VBbxu3zTVTwdVy7CxfxXfK/irpetUI', 'Kiss Admin', 'Y', 'Y');

-- ----------------------------------------------------------------------------
-- repository
-- ----------------------------------------------------------------------------
CREATE TABLE repository (
    repo_id          serial                 NOT NULL PRIMARY KEY,
    repo_key         character varying(100) NOT NULL UNIQUE,   -- first path segment, e.g. 'acme'
    name             character varying(200) NOT NULL,
    fs_path          character varying(500) NOT NULL,          -- absolute path of the FSFS repo on disk
    description      character varying(2000),
    owner_id         integer                REFERENCES users(user_id),  -- the user who created it
    visibility       character varying(10)  NOT NULL DEFAULT 'private', -- public => any user may checkout/clone
    default_branch   character varying(200) DEFAULT 'trunk',
    discovered       character(1)           NOT NULL DEFAULT 'N',  -- auto-provisioned by the log ingest?
    is_active        character(1)           NOT NULL DEFAULT 'Y',
    created_ts       bigint                 NOT NULL,
    head_revision    integer,                                  -- cached youngest revision
    head_revision_ts bigint,                                   -- commit ts of HEAD
    CONSTRAINT repository_disc_chk   CHECK (discovered = 'Y' OR discovered = 'N'),
    CONSTRAINT repository_active_chk CHECK (is_active  = 'Y' OR is_active  = 'N'),
    CONSTRAINT repository_vis_chk    CHECK (visibility IN ('public','private'))
);

-- ----------------------------------------------------------------------------
-- repository_access  (per-user authorization; serialized to svnserve authz)
-- ----------------------------------------------------------------------------
CREATE TABLE repository_access (
    access_id   serial       NOT NULL PRIMARY KEY,
    repo_id     integer      NOT NULL REFERENCES repository(repo_id),
    user_id     integer      NOT NULL REFERENCES users(user_id),
    can_read    character(1) NOT NULL DEFAULT 'Y',
    can_write   character(1) NOT NULL DEFAULT 'N',
    can_admin   character(1) NOT NULL DEFAULT 'N',
    granted_ts  bigint       NOT NULL,
    CONSTRAINT repaccess_uniq  UNIQUE (repo_id, user_id),
    CONSTRAINT repaccess_r_chk CHECK (can_read  = 'Y' OR can_read  = 'N'),
    CONSTRAINT repaccess_w_chk CHECK (can_write = 'Y' OR can_write = 'N'),
    CONSTRAINT repaccess_a_chk CHECK (can_admin = 'Y' OR can_admin = 'N')
);
CREATE INDEX repaccess_user_idx ON repository_access (user_id);

-- ----------------------------------------------------------------------------
-- svn_user_alias  (raw SVN realm name in the log -> SvnHub user account)
-- ----------------------------------------------------------------------------
CREATE TABLE svn_user_alias (
    alias_id       serial                 NOT NULL PRIMARY KEY,
    raw_user_name  character varying(255) NOT NULL UNIQUE,
    user_id        integer                REFERENCES users(user_id),  -- NULL until reconciled
    created_ts     bigint                 NOT NULL
);

-- ----------------------------------------------------------------------------
-- access_event  (the raw normalized read/write firehose)
-- ----------------------------------------------------------------------------
CREATE TABLE access_event (
    event_id     bigserial              NOT NULL PRIMARY KEY,
    repo_id      integer                REFERENCES repository(repo_id),  -- NULL if unmapped
    repo_key     character varying(100),                                -- raw, always retained
    user_id      integer                REFERENCES users(user_id),      -- NULL if anonymous/unmapped
    raw_user     character varying(100),                                -- NULL if anonymous
    client_host  character varying(255),
    action       character varying(40)  NOT NULL,                       -- verbatim svn verb, or 'UNPARSED'
    verb_class   character varying(10)  NOT NULL DEFAULT 'other',       -- read|write|lock|other
    path         character varying(1000),
    revision     integer,                                               -- r<rev>, NULL if absent
    event_ts     bigint                 NOT NULL,                       -- epoch ms
    event_day    integer                NOT NULL,                       -- YYYYMMDD bucket
    bytes        bigint,                                                -- if a source supplies size
    source       character varying(20)  NOT NULL DEFAULT 'svnserve',    -- pluggable origin
    extra        character varying(2000),                               -- flags, 2nd path, raw on UNPARSED
    event_hash   character(64)          NOT NULL                        -- SHA-256 dedup key
);
CREATE UNIQUE INDEX accessevent_hash_uidx     ON access_event (event_hash);
CREATE INDEX        accessevent_repo_day_idx  ON access_event (repo_id, event_day);
CREATE INDEX        accessevent_user_day_idx  ON access_event (user_id, event_day);
CREATE INDEX        accessevent_repo_user_idx ON access_event (repo_id, user_id, event_ts);
CREATE INDEX        accessevent_action_idx    ON access_event (action);

-- ----------------------------------------------------------------------------
-- log_ingest_state  (per physical log file incremental cursor)
-- ----------------------------------------------------------------------------
CREATE TABLE log_ingest_state (
    ingest_id      serial                 NOT NULL PRIMARY KEY,
    source         character varying(20)  NOT NULL DEFAULT 'svnserve',
    file_path      character varying(500) NOT NULL,            -- last-seen filename (informational)
    inode          character varying(120) NOT NULL,           -- Files.fileKey() string: rotation-safe identity
    byte_offset    bigint                 NOT NULL DEFAULT 0,
    file_size      bigint                 NOT NULL DEFAULT 0,  -- size at last read (truncation detect)
    lines_ingested bigint                 NOT NULL DEFAULT 0,
    status         character varying(15)  NOT NULL DEFAULT 'active',  -- active|rotated_out|complete
    last_event_ts  bigint,
    locked_until   bigint,                                     -- overlap guard
    updated_ts     bigint                 NOT NULL,
    CONSTRAINT ingeststate_inode_uniq UNIQUE (source, inode)
);
CREATE INDEX ingeststate_status_idx ON log_ingest_state (status);

-- ----------------------------------------------------------------------------
-- access_daily_rollup  (per user x repo x day aggregate)
-- ----------------------------------------------------------------------------
CREATE TABLE access_daily_rollup (
    rollup_id            serial   NOT NULL PRIMARY KEY,
    repo_id              integer  NOT NULL REFERENCES repository(repo_id),
    user_id              integer  REFERENCES users(user_id),   -- NULL bucket = anonymous/unmapped
    event_day            integer  NOT NULL,                    -- YYYYMMDD
    checkout_count       integer  NOT NULL DEFAULT 0,
    update_count         integer  NOT NULL DEFAULT 0,
    switch_count         integer  NOT NULL DEFAULT 0,
    browse_count         integer  NOT NULL DEFAULT 0,          -- get-dir/get-file/status/diff/log
    commit_count         integer  NOT NULL DEFAULT 0,
    other_count          integer  NOT NULL DEFAULT 0,
    total_bytes          bigint   NOT NULL DEFAULT 0,
    distinct_paths       integer  NOT NULL DEFAULT 0,
    max_revision_synced  integer,                              -- highest r<rev> read this day
    first_event_ts       bigint,
    last_event_ts        bigint,
    CONSTRAINT dailyrollup_uniq UNIQUE (repo_id, user_id, event_day)
);
CREATE INDEX dailyrollup_repo_day_idx ON access_daily_rollup (repo_id, event_day);
CREATE INDEX dailyrollup_user_idx     ON access_daily_rollup (user_id, event_day);

-- ----------------------------------------------------------------------------
-- working_copy_state  (current "last sync" position per user x repo)
-- ----------------------------------------------------------------------------
CREATE TABLE working_copy_state (
    wc_id                 serial   NOT NULL PRIMARY KEY,
    repo_id               integer  NOT NULL REFERENCES repository(repo_id),
    user_id               integer  REFERENCES users(user_id),
    raw_user              character varying(100),
    last_synced_revision  integer,                             -- max revision from checkout/update/switch
    last_sync_ts          bigint,
    last_checkout_ts      bigint,
    last_any_activity_ts  bigint,
    last_client_host      character varying(255),
    CONSTRAINT wcstate_uniq UNIQUE (repo_id, user_id)
);
CREATE INDEX wcstate_repo_idx ON working_copy_state (repo_id);

-- ----------------------------------------------------------------------------
-- commit_cache  (cached revision metadata for fast history browsing)
-- ----------------------------------------------------------------------------
CREATE TABLE commit_cache (
    commit_id     serial                  NOT NULL PRIMARY KEY,
    repo_id       integer                 NOT NULL REFERENCES repository(repo_id),
    revision      integer                 NOT NULL,
    author        character varying(100),
    commit_ts     bigint,                                      -- epoch ms (svn:date)
    message       character varying(4000),
    changed_count integer                 NOT NULL DEFAULT 0,
    CONSTRAINT commitcache_uniq UNIQUE (repo_id, revision)
);
CREATE INDEX commitcache_repo_rev_idx ON commit_cache (repo_id, revision);

-- ----------------------------------------------------------------------------
-- commit_cache_path  (changed paths per cached revision)
-- ----------------------------------------------------------------------------
CREATE TABLE commit_cache_path (
    cpath_id       serial                  NOT NULL PRIMARY KEY,
    commit_id      integer                 NOT NULL REFERENCES commit_cache(commit_id),
    change_type    character(1)            NOT NULL,           -- A/M/D/R
    path           character varying(1000) NOT NULL,
    copy_from_path character varying(1000),
    copy_from_rev  integer,
    CONSTRAINT cpath_chg_chk CHECK (change_type IN ('A','M','D','R'))
);
CREATE INDEX cpath_commit_idx ON commit_cache_path (commit_id);
CREATE INDEX cpath_path_idx   ON commit_cache_path (path);

-- ----------------------------------------------------------------------------
-- issue  (lightweight per-repo issue tracker)
-- ----------------------------------------------------------------------------
CREATE TABLE issue (
    issue_id    serial                  NOT NULL PRIMARY KEY,
    repo_id     integer                 NOT NULL REFERENCES repository(repo_id),
    number      integer                 NOT NULL,              -- per-repo sequence
    title       character varying(300)  NOT NULL,
    body        character varying(8000),
    status      character varying(10)   NOT NULL DEFAULT 'open',  -- open|closed
    created_by  integer                 NOT NULL REFERENCES users(user_id),
    created_ts  bigint                  NOT NULL,
    closed_ts   bigint,
    CONSTRAINT issue_num_uniq   UNIQUE (repo_id, number),
    CONSTRAINT issue_status_chk CHECK (status IN ('open','closed'))
);
CREATE INDEX issue_repo_status_idx ON issue (repo_id, status);

-- ----------------------------------------------------------------------------
-- issue_comment
-- ----------------------------------------------------------------------------
CREATE TABLE issue_comment (
    comment_id  serial                  NOT NULL PRIMARY KEY,
    issue_id    integer                 NOT NULL REFERENCES issue(issue_id),
    user_id     integer                 NOT NULL REFERENCES users(user_id),
    body        character varying(8000) NOT NULL,
    created_ts  bigint                  NOT NULL
);
CREATE INDEX issuecomment_issue_idx ON issue_comment (issue_id);

-- ----------------------------------------------------------------------------
-- merge_request  (code review / branch->target merge proposal)
-- ----------------------------------------------------------------------------
CREATE TABLE merge_request (
    mr_id        serial                  NOT NULL PRIMARY KEY,
    repo_id      integer                 NOT NULL REFERENCES repository(repo_id),
    number       integer                 NOT NULL,             -- per-repo sequence
    source_path  character varying(500)  NOT NULL,             -- e.g. /branches/feature-x
    target_path  character varying(500)  NOT NULL,             -- e.g. /trunk
    title        character varying(300)  NOT NULL,
    body         character varying(8000),
    status       character varying(10)   NOT NULL DEFAULT 'open',  -- open|merged|closed
    source_rev   integer,
    target_rev   integer,
    merged_rev   integer,
    created_by   integer                 NOT NULL REFERENCES users(user_id),
    created_ts   bigint                  NOT NULL,
    merged_ts    bigint,
    closed_ts    bigint,
    CONSTRAINT mr_num_uniq   UNIQUE (repo_id, number),
    CONSTRAINT mr_status_chk CHECK (status IN ('open','merged','closed'))
);
CREATE INDEX mr_repo_status_idx ON merge_request (repo_id, status);

-- ----------------------------------------------------------------------------
-- mr_comment  (general or inline diff comments on a merge request)
-- ----------------------------------------------------------------------------
CREATE TABLE mr_comment (
    mrc_id      serial                  NOT NULL PRIMARY KEY,
    mr_id       integer                 NOT NULL REFERENCES merge_request(mr_id),
    user_id     integer                 NOT NULL REFERENCES users(user_id),
    file_path   character varying(1000),                       -- NULL = general comment
    line_no     integer,                                       -- NULL = file-level / general
    body        character varying(8000) NOT NULL,
    created_ts  bigint                  NOT NULL
);
CREATE INDEX mrcomment_mr_idx ON mr_comment (mr_id);
