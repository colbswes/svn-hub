# Svn-Hub

**Svn-Hub** is a modern, self-hosted, web-based 
source code repository management system
 — a GitHub-style experience —
built around [Apache Subversion](https://subversion.apache.org/) instead of Git.

It gives teams a single, authoritative source of truth with repository browsing,
history, diffs, issues, merge requests, project visibility controls, and — its
distinguishing feature — **real checkout/update statistics** that a centralized
model makes possible but a distributed one cannot.

The full rationale is in **[Rationale.md](Rationale.md)** — the *Why This Service
Exists* page from the application itself. In short: one canonical repository, a
clear linear revision history, practical auditability, genuine usage insight, and
independence from large corporate platforms.

## What it does

- **Repository hosting** — each user gets a URL-safe handle, and their repositories
  live under it (`svn://host/<handle>/<repo>`), so different users can host repos
  of the same name. Repositories are created and served through `svnserve`.
- **Web browsing** — directory listings, file and README viewing, commit history,
  and revision diffs (via [SVNKit](https://svnkit.com/)).
- **Usage statistics & Insights** — Svn-Hub ingests the `svnserve` operation log to
  attribute checkouts, updates, and commits to users and revisions: who has what,
  how far behind HEAD they are, activity over a date range, and more. A single
  authoritative server can see this; a distributed system cannot.
- **Collaboration** — per-repository issues and merge requests (real SVNKit
  merge + commit).
- **Discover** — a people directory and project search, with per-user public
  profiles.
- **Access control** — public and private repositories with per-user read/write
  grants, serialized automatically into `svnserve`'s `authz`/`passwd` (Svn-Hub is
  the system of record).
- **Accounts** — self-registration with email verification (via
  [Postmark](https://postmarkapp.com/)), self-service password change, and a
  forgotten-password flow that emails a temporary sign-in code without ever
  disturbing the existing password. Regular vs. administrator roles.
- **Zero-touch upgrades** — the database schema brings itself current with the
  deployed code at startup; a deploy is a build + restart.

## Built on Kiss

Svn-Hub is built on the **[Kiss Web Application Framework](https://github.com/blakemcbride/Kiss)**
— a Java/Groovy full-stack framework. Kiss provides the JSON-RPC server, the
hot-reloadable service layer, the database abstraction, the custom front-end
component library, the `bld` build system, and integrations (REST, email, OAuth 2.1,
MCP) that Svn-Hub builds upon.

## Technology

- **Backend:** Java 17+ and Groovy on the Kiss framework, served by Tomcat 11
  (Jakarta EE 11)
- **Database:** PostgreSQL
- **Version control:** Subversion (`svnserve`), accessed programmatically via SVNKit
- **Frontend:** JavaScript/HTML/CSS with Kiss's custom components and AG-Grid
- **Email:** Postmark (transactional send)
- **Build:** the Kiss `bld` tool (no Maven/Gradle)

## Getting started

- **Deployment:** step-by-step instructions for a cloud Ubuntu server are in
  [SetUp.md](SetUp.md).
- **Architecture:** the full system design is in [Architecture.md](Architecture.md).

Source: [github.com/blakemcbride/svn-hub](https://github.com/blakemcbride/svn-hub)

## Authors

Svn-Hub was written by **Blake McBride** and **Claude Code**.
