# NovaJudge

**A modern, lightweight XCPC Online Judge & Contest Operations Platform**

[![CI](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml/badge.svg)](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2d3748)](https://www.prisma.io/)
[![go-judge](https://img.shields.io/badge/Sandbox-go--judge-00add8)](https://github.com/criyle/go-judge)

[English](./README.md) · [简体中文](./README.zh-CN.md)

NovaJudge is an all-in-one Online Judge platform built for **ICPC / CCPC (XCPC) onsite contests, online competitions, and daily team training**. Beyond standalone code judging, it integrates the full contest operations lifecycle into a single Next.js application: problem authoring & Polygon imports, team/staff role management, multi-worker realtime judging, ACM/ICPC scoreboards with freeze & Resolver award ceremonies, clarifications with live staff alerts, balloon delivery, print queues, intranet contestant CLI, proctoring client integration, optional external SSO/password authentication, and ICPC CCS-compatible feeds.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Multi-Worker Judging & Operations](#multi-worker-judging--operations)
- [Key Workflows & Security Modes](#key-workflows--security-modes)
- [Scripts & Testing](#scripts--testing)
- [Documentation](#documentation)
- [Project Layout](#project-layout)
- [License](#license)

---

## Architecture

```mermaid
flowchart LR
    subgraph Clients["Clients & Integrations"]
        Web["Contestants / Staff Browser"]
        CLI["Intranet CLI (submit / printfile)"]
        Proctor["Proctoring Desktop Client"]
        CCS["ICPC Tools / Resolver / External API"]
    end

    subgraph App["NovaJudge Web (Next.js 16)"]
        Pages["App Router UI & Server Actions"]
        API["REST / SSE / CCS Endpoints"]
    end

    subgraph Infra["State & Queue"]
        PG[("PostgreSQL 16\n(Prisma 7)")]
        Redis[("Redis 7\n(BullMQ + Heartbeats + Leases)")]
        FS[("uploads/\n(Test Data + .judge-cache)")]
    end

    subgraph Judging["Judge Cluster"]
        Workers["Judge Workers (1..N)"]
        Sandbox["go-judge Sandbox\n(GCC 15.2 / OpenJDK 21 / PyPy3)"]
    end

    Clients --> App
    Pages --> PG
    API --> PG
    Pages --> Redis
    API --> Redis
    App --> FS
    Redis <--> Workers
    Workers --> PG
    Workers <--> FS
    Workers --> Sandbox
```

---

## Features

### Contest Operations & Onsite Workflows
- **Full Contest Lifecycle**: Public and password-protected private contests with automatic `PENDING → RUNNING → ENDED` state scheduling.
- **Team, Staff & Global Accounts**: Batch TSV team import, role-based access (`TEAM`, `ADMIN`, `JUDGE`, `BALLOON`, `PRINT`, `OBSERVER`), schools, coaches, seats, star/unofficial categories, **seat IP auto-login**, and optional **external account authentication** with admin ban controls (`/admin/accounts`).
- **ACM/ICPC Scoreboard & Awards**: Live standings with scoreboard **freeze / unfreeze**, virtual participation toggle, PDF/CSV exports, and an **Awards Configuration Studio** (Gold/Silver/Bronze by count or ratio, First-to-Solve, school-deduplicated Champion/Runner-up/Third, Excellence, custom awards) with **ICPC Tools Resolver** event-feed export.
- **Clarifications & Live Staff Alerts**: Private team Q&A and public announcements; contest `ADMIN` and `JUDGE` accounts receive real-time in-app popup alerts and navbar badge counts for unanswered questions and follow-ups.
- **Onsite Balloon & Print Queues**: Automatic deduplicated balloon task creation on first team AC with runner assignment, plus contestant code print queue management.
- **Training Center, Upsolving & Virtual Participation (VP)**: Folder-tree training directory, post-contest upsolving, and full virtual contest participation for global accounts.
- **Unified Single-Branch Deployment**: Public, university intranet, and multi-organization sites run the exact same codebase with per-deployment site branding (`NOVAJUDGE_SITE_NAME`, `NOVAJUDGE_FOOTER_TEXT`) and external organization mappings (`NOVAJUDGE_ORG_MAP_PATH`).

### Problem Bank & Judging Engine
- **Rich Problem Types**: Supports **Standard**, **Special Judge (`spj`)**, **Interactive (`interactive`)**, and **Run-Twice Communication (`communication`)** problems with Markdown + KaTeX statements, paired communication samples, and online sample debugging.
- **Modern Compiler Toolchain**: Preconfigured sandbox image (`Dockerfile`) featuring **C11** & **C++23** (pinned **GCC 15.2**, `-O2 -static`), **Java 21** (OpenJDK 21, amd64/arm64 compatible), and **Python 3** (PyPy3).
- **Polygon & Native Archive Import**: Import single problems, multi-problem archives, or full contest packages directly from **Codeforces Polygon** (Linux/Windows ZIPs, auto-converting HTML statements, assets, samples, `testlib.h` checkers/interactors, and 1- or 2-run communication protocols) alongside native NovaJudge ZIPs, plus **in-place single-problem ZIP updates**.
- **Judge Program Compilation Cache**: Compiled checkers, interactors, and communicators are cached on disk (`uploads/problems/<id>/.judge-cache/`) with Redis lease coordination and automatic invalidation when sources, `testlib.h`, or compiler flags change.
- **Accurate CPU Timing & Watchdog**: Contestant `TLE` is determined strictly by measured sandbox CPU time (immune to host I/O or scheduling jitter), backed by a separate wall-clock watchdog that reports `SYSTEM_ERROR` rather than penalizing teams on stuck runs.
- **Safe Rejudging**: Multi-filter in-contest rejudging (by team, school, seat, Run ID, problem, verdict, language, or time window) and global admin batch rejudging (up to 5,000 submissions per batch) with live progress tracking.

### Proctoring, Intranet CLI & APIs
- **Proctoring-Bound Login**: Optional integration with desktop proctoring clients (`loginSource: "PROCTORING"`); once bound, the contest account is locked exclusively to the authenticated proctoring client session.
- **Zero-Dependency Intranet CLI**: Native **Windows** (PowerShell 5.1) and **macOS** (Bash/curl) `submit` and `printfile` commands for intranet contests—no Node.js, Python, or admin privileges required on contestant machines.
- **ICPC CCS & Platform APIs**: API Key authentication (`x-api-key`) and CCS-compatible endpoints (`/api/ccs/contests/:id/...`) for external scoreboards, resolvers, and broadcast overlays.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend & Web** | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, Headless UI, Framer Motion, Monaco Editor, KaTeX |
| **Database & ORM** | PostgreSQL 16, Prisma 7 (`@prisma/adapter-pg`) |
| **Queue & Coordination** | Redis 7, BullMQ 5 (job locking, worker heartbeats, scheduler & cache leases) |
| **Judge Sandbox** | [go-judge](https://github.com/criyle/go-judge) (`v1.11.2`), Ubuntu 24.04, GCC/G++ 15.2, OpenJDK 21, PyPy3, `testlib.h` |
| **Infrastructure & CI** | Docker & Docker Compose, GitHub Actions |

---

## Quick Start

### Prerequisites
- **Node.js** `22 LTS` (supports `^20.19.0 || ^22.12.0 || >=24.0.0`) and **npm**
- **Docker** and **Docker Compose** (for PostgreSQL 16, Redis 7, and the privileged `go-judge` container)

### Fresh Installation

Dependency installation (`npm ci` / `npm install`) only generates the Prisma Client and copies Monaco Editor assets—it **never** connects to or mutates your database. Database initialization and upgrades are performed explicitly via `npm run db:deploy`.

```bash
git clone https://github.com/CWNU-Open-Source-Community/NovaJudge.git
cd NovaJudge
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, matching DATABASE_URL, JWT_SECRET,
# SUPER_ADMIN_USERNAME, and SUPER_ADMIN_PASSWORD.

npm ci
docker compose up -d --build --wait
npm run db:deploy
npm run dev
```

In a second terminal, start at least one judge worker:

```bash
npm run worker
```

Visit `http://localhost:3001` (Admin panel: `http://localhost:3001/admin`).

### Production & Upgrading Existing Deployments

For production, build and run with a process manager (`npm run build && npm run start` plus `npm run worker:multi -- 2`).

> **Upgrading from an older public or private deployment?** Read the [Deployment & Handover Guide](./docs/DEPLOYMENT.md) first—it covers database & `uploads/` backups, automatic legacy schema adoption (`npm run db:deploy`), rollback procedures, optional external login setup, and site branding configuration.

---

## Environment Variables

| Variable | Default / Example | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / *(required)* / `xcpc_oj` | Credentials used by the local PostgreSQL container in `docker-compose.yml` |
| `DATABASE_URL` | `postgresql://postgres:...@localhost:5432/xcpc_oj?schema=public` | PostgreSQL connection string (must match `POSTGRES_*` when using Compose) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string for BullMQ, heartbeats, and distributed leases |
| `GO_JUDGE_API` | `http://localhost:5050` | HTTP endpoint of the `go-judge` sandbox |
| `GO_JUDGE_REQUEST_TIMEOUT_MS` | *(auto)* | Optional HTTP timeout (ms) for `go-judge` calls (covers run watchdog + buffer) |
| `PROBLEM_DATA_ROOT` | `uploads/problems` | Optional shared problem data directory for multi-host judge workers |
| `JWT_SECRET` | *(required)* | Secret key used to sign session and contest access tokens |
| `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` | *(required)* | Bootstrap super administrator credentials |
| `NOVAJUDGE_URL` | `http://localhost:3001` | Base URL reachable by contestants (used by CLI pairing and links) |
| `NOVAJUDGE_CLI_MODE` | `public` | Keep `public` on public networks (disables CLI); set `intranet` only on isolated intranet deployments |
| `EXTERNAL_AUTH_URL` / `APP_KEY` | *(empty)* | Optional external authentication endpoint and server-side app key (disabled by default on new installs) |
| `NOVAJUDGE_SITE_NAME` / `NOVAJUDGE_SITE_DESCRIPTION` | `NovaJudge` / `XCPC Online Judge` | Customizable navbar/page title and meta description |
| `NOVAJUDGE_FOOTER_TEXT` | *(empty)* | Optional school or organization footer line |
| `NOVAJUDGE_ORG_MAP_PATH` | `config/org-map.json` | Optional path to external school-to-organization ID JSON mapping |
| `JUDGE_CONCURRENCY` | `4` | Parallel submissions judged per worker process |
| `JUDGE_ID` | *(auto-assigned)* | Optional explicit worker ID |
| `JUDGE_WORKER_COUNT` / `JUDGE_WORKER_IDS` | `2` / *(unset)* | Worker count or explicit comma-separated IDs for `npm run worker:multi` |
| `JUDGE_WALL_WATCHDOG_MS` | `60000` | Minimum wall-clock watchdog (ms) per run (`max(this, 20 × CPU limit)`) |

---

## Multi-Worker Judging & Operations

### Scaling Judge Workers

All workers consume from a shared Redis BullMQ queue (`judge-queue`). Total judging concurrency equals `active workers × JUDGE_CONCURRENCY`.

```bash
# Single worker with auto-assigned ID
npm run worker

# Single worker with explicit ID
npm run worker -- --id 1

# Spawn 4 workers with globally allocated IDs
npm run worker:multi -- 4

# Or configure via environment variables
JUDGE_WORKER_COUNT=4 npm run worker:multi
JUDGE_WORKER_IDS=1,2,3 npm run worker:multi
```

### Conflict-Free Coordination
- **Atomic Job Claiming**: BullMQ locks each job in Redis atomically—two workers never judge the same submission concurrently.
- **Idempotent Enqueueing**: All submission and rejudge paths go through `enqueueJudge()` (`lib/queue.ts`) with a deterministic job ID per submission, preventing duplicate queue entries on repeated clicks or concurrent batch rejudges.
- **Single Lifecycle Scheduler**: Contest status transitions (`PENDING → RUNNING → ENDED`) elect a single leader among online workers via a Redis lease.

### Judge Program Compilation Cache
Checkers, interactors, and communicators are compiled on first use and cached under `uploads/problems/<problemId>/.judge-cache/` (or `<PROBLEM_DATA_ROOT>/<problemId>/.judge-cache/`). Workers sharing this directory and `GO_JUDGE_API` reuse compiled binaries across Web, Worker, and `go-judge` restarts. Content hashes of the source file, `testlib.h`, and compiler flags are verified on every run; Redis leases prevent stampedes on cache misses, and each submission receives an isolated copy in the sandbox. *(Delete `.judge-cache` after upgrading the sandbox compiler image to force a rebuild.)*

### CPU Time Limits vs. Wall-Clock Watchdog
Contestant `TIME_LIMIT_EXCEEDED` verdicts depend strictly on measured CPU usage, so OS scheduling or I/O wait does not cause false TLEs. Each run is guarded by a separate wall-clock watchdog of `max(JUDGE_WALL_WATCHDOG_MS, 20 × CPU limit)`. If the watchdog triggers without a CPU overrun, the submission is marked `SYSTEM_ERROR` with timing diagnostics (no contestant penalty).

### Monitoring & Stress Testing
- **Live Dashboards**: View online worker heartbeats and queue counters on **Admin → Dashboard → Judge Workers** (refreshes every 5s; offline workers expire within 15s) and per-minute throughput/verdict charts at **`/admin/judge-monitor`** (`/admin/monitor` redirects automatically).
- **Queue Stress Tool**: Benchmark multi-worker throughput with `stress-test.ts`:
  ```bash
  npm run stress -- --total=100 --batch=20 --lang=cpp
  ```
  Supported flags: `--total`, `--batch`, `--lang` (`c` | `cpp` | `java` | `pypy3`), `--problem`, `--no-wait`, `--timeout`, `--mark`.

---

## Key Workflows & Security Modes

### Polygon Import & Single-Problem ZIP Update
- **Polygon Packages**: In **Admin → Import Problems / Import Contests**, select the **Polygon** format to import single problems, multi-problem bundles, or `contest.xml` packages (including standard, interactive, and 1- or 2-run interactive communication problems). Contest package imports add problems to the problem bank without altering existing contests; administrators link them to contests afterward. See [docs/POLYGON_IMPORT.md](./docs/POLYGON_IMPORT.md).
- **Single-Problem Hot Update**: Click **Update Problem** (upload icon) on a problem row in the admin problem bank to replace its statement, samples, limits, YAML config, test cases, and assets from a single-problem ZIP while preserving its problem ID, contest links, and submission history.

### Private Contest Access Control
Private contests require a contest password for **every** visitor (including logged-in team and global users, both during and after the contest; super administrators retain access). Unlocking grants a 24-hour browser cookie (`contest_access_<id>`) for viewing contest pages and assets without elevating submission or staff privileges. Changing the contest password immediately invalidates prior grants. CLI clients pass `contestPassword` and send `x-contest-access-token` on subsequent requests. CCS HTTP Basic Auth is restricted to super administrators.

### Intranet Contestant CLI & Proctoring Integration
- **Deployment Gate**: Contestant CLI endpoints (`/cli` and `/api/cli/device/*`) are **disabled by default** (`NOVAJUDGE_CLI_MODE=public`). Enable `NOVAJUDGE_CLI_MODE=intranet` **only** on isolated intranet deployments, restart Web, and select the active CLI contest in **Admin → System Settings**.
- **Browser Pairing (`submit`)**: Contestants visit `/cli` to install the zero-dependency global `submit` command and run `submit A.cpp` (or `submit -y --problem A main.cpp`). First run opens a browser pairing page to bind the device to their team account.
- **Proctoring Mode (`submit` & `printfile`)**: When logged in through an integrated proctoring desktop client, the account is bound exclusively to that client (`x-novajudge-proctor-key`) and receives a managed device token supporting both `submit` and `printfile [-y] A.cpp` (accepts `.c`, `.cpp`, `.cc`, `.cxx`, `.java`, `.py`). See [docs/CONTESTANT_CLI.md](./docs/CONTESTANT_CLI.md) and [docs/PROCTORING_LOGIN.md](./docs/PROCTORING_LOGIN.md).

### Contest Clarification Alerts
Contest `ADMIN` and `JUDGE` staff accounts poll pending questions every 10 seconds, displaying toast popups (deduplicated per account in browser storage) and a navbar counter until any staff member replies; contestant follow-ups re-trigger the alert. Database indexes for notification polling are deployed automatically by `npm run db:deploy`.

---

## Scripts & Testing

### Application, Database & Worker Commands

```bash
npm run dev            # Start development server on port 3001
npm run build          # Build Next.js application for production
npm run start          # Start production Web server on port 3001
npm run lint           # Run ESLint
npm run prisma         # Regenerate Prisma Client
npm run db:deploy      # Deploy Prisma migrations (supports fresh & legacy DB adoption)
npm run db:status      # Check Prisma migration status
npm run upgrade        # Run Linux production upgrade helper (env check + migrate + build)
npm run worker         # Start a judge worker (auto-assigned ID)
npm run worker:multi   # Start multiple workers, e.g. "npm run worker:multi -- 4"
npm run worker:dev     # Start a judge worker in watch mode
npm run stress         # Bulk-enqueue submissions to benchmark worker throughput
```

### Unit & Integration Test Suites

```bash
# Run full unit & CLI regression suite
npm test

# Targeted unit & policy regression suites (no external services required)
npm run test:polygon-import
npm run test:problem-update
npm run test:communication
npm run test:judge-runtime
npm run test:judge-cache
npm run test:contest-access
npm run test:rejudge
npm run test:clarification-notifications
npm run test:proctoring
npm run test:cli-device
npm run test:submit-macos
npm run test:submit-windows
npm run test:submit-legacy

# Integration suites (require running local PostgreSQL / Redis / go-judge / Web)
npm run test:database-upgrade
npm run test:judge-runtime:integration
npm run test:judge-cache:integration
npm run test:polygon:integration
npm run test:communication:integration
npm run test:problem-update:integration
npm run test:clarification-notifications:integration
npm run test:proctoring:integration
npm run test:submit-macos:integration
npm run test:submit-windows:integration
```

---

## Documentation

| Guide | Description |
| :--- | :--- |
| [Deployment & Handover Guide](./docs/DEPLOYMENT.md) | Fresh installs, safe upgrades from legacy public/private databases, external login, branding, backups, and rollback |
| [API & CCS Reference](./docs/API_DOCS.md) | Platform REST endpoints, `x-api-key` authentication, and ICPC CCS-compatible feeds |
| [Polygon Import Guide](./docs/POLYGON_IMPORT.md) | Importing Polygon problem & contest packages, statement conversion, and supported protocols |
| [Communication Problems](./docs/COMMUNICATION_PROBLEMS.md) | Run-twice communication problem configuration, `communicator.cpp` protocol, and [example package](./examples/communication/encode-decode/README.md) |
| [Contestant CLI Guide](./docs/CONTESTANT_CLI.md) | Installing and using `submit` and `printfile` on Windows (PowerShell 5.1 / Win7+) and macOS |
| [Proctoring Login Protocol](./docs/PROCTORING_LOGIN.md) | Exclusive proctoring session binding and offline intranet CLI provisioning |
| [C++23 Compiler Toolchain](./docs/CPP23_COMPILER_FIX.md) | GCC 15.2 sandbox image design, `constexpr` memory regression benchmarks, and safe rollout |
| [Windows Full E2E Guide](./docs/WINDOWS_FULL_E2E.md) | End-to-end local verification with NovaJudge, proctoring desktop client, and WebRTC media |
| [Changelog](./docs/CHANGELOG.md) | Release history and notable changes |

---

## Project Layout

```text
NovaJudge/
├─ .github/workflows/    # GitHub Actions CI (schema upgrade, lint, unit/integration tests, build)
├─ app/                  # Next.js App Router pages, Server Actions, and REST/CCS API routes
├─ components/           # Contest UI, Monaco editor, Markdown/KaTeX viewer, and Admin components
├─ config/               # Default organization ID mappings for CCS / Resolver exports
├─ context/              # React client context providers
├─ docs/                 # Deployment handover, feature guides, API reference, and E2E manuals
├─ examples/             # Sample problem packages (e.g. run-twice communication example)
├─ lib/                  # Auth, judge engine, Polygon importer, BullMQ, Redis, Prisma, CCS helpers
├─ prisma/               # Prisma schema, baseline/unified migrations, and legacy schema snapshots
├─ public/               # Static assets (Monaco workers copied on postinstall)
├─ scripts/              # DB deploy/upgrade tools, multi-worker launcher, CLI & test harnesses
├─ tests/                # Compiler and Polygon test fixtures
├─ tools/contestant-cli/ # Native Windows PowerShell and macOS contestant CLI installers & scripts
├─ uploads/              # Problem test data, statement assets, and .judge-cache binaries
├─ worker.ts             # BullMQ judge worker with Redis heartbeat and contest status scheduler
├─ stress-test.ts        # Multi-worker queue throughput benchmark tool
├─ Dockerfile            # Custom go-judge image (Ubuntu 24.04 + GCC 15.2 + OpenJDK 21 + PyPy3)
└─ docker-compose.yml    # Local PostgreSQL 16, Redis 7, and go-judge stack
```

---

## License

NovaJudge is released under the [MIT License](./LICENSE).
