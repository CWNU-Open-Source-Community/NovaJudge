# NovaJudge

Communication problems (run twice) are supported as a separate problem type.
See the [configuration guide](./docs/COMMUNICATION_PROBLEMS.md) and
[encoding/decoding example](./examples/communication/encode-decode/README.md).

[English](./README.md) · [简体中文](./README.zh-CN.md)

NovaJudge is a lightweight Online Judge platform designed for XCPC-style
training and onsite contests. It focuses on contest operations rather than only
standalone submissions: problem management, team accounts, realtime judging,
scoreboards, clarifications, balloon delivery, print queues, API keys, and ICPC
CCS-compatible data feeds are built into one Next.js application.

## Features

- Contest lifecycle management for public and private contests.
- Team account import, login, roles, seats, members, schools, coaches, and
  categories.
- Problem bank with Markdown/LaTeX statements, samples, assets, test data, and
  YAML judge configuration.
- Realtime submissions powered by Redis, BullMQ, worker processes, and
  [go-judge](https://github.com/criyle/go-judge).
- Cached checker, interactor and communicator compilation, automatically rebuilt
  when the source, `testlib.h` or compilation options change.
- Multiple judge workers with unique IDs, live status on the admin dashboard,
  and conflict-free task claiming from the shared queue.
- ACM/ICPC-style scoreboard with freeze and unfreeze support.
- Clarification and notice system for contestants and judges.
- Balloon delivery and print queue workflows for onsite contests.
- API key authentication and ICPC CCS-compatible endpoints for external tools.
- Training center and virtual participation support for logged-in global users.

## Tech Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS, Heroicons, Sonner, Monaco Editor
- PostgreSQL, Prisma 7
- Redis, BullMQ
- go-judge
- Docker Compose for local infrastructure

## Quick Start

Clone the repository and install dependencies:

```bash
git clone https://github.com/pppolf/NovaJudge.git
cd NovaJudge
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Common environment variables:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/xcpc_oj?schema=public"
REDIS_URL="redis://localhost:6379"
GO_JUDGE_API="http://localhost:5050"
JWT_SECRET="please-change-this-secret"
SUPER_ADMIN_USERNAME="admin"
SUPER_ADMIN_PASSWORD="123456"
JUDGE_CONCURRENCY=4
NOVAJUDGE_URL="http://localhost:3001"
```

Start PostgreSQL, Redis, and go-judge:

```bash
docker-compose up -d
```

Initialize Prisma and start the web app:

```bash
npx prisma db push
npm run prisma
npm run dev
```

Start the judge worker in another terminal:

```bash
npm run worker
```

The default development server runs at `http://localhost:3001`.

## Running Multiple Judge Workers

All judge workers share the same Redis-backed BullMQ queue (`judge-queue`).
BullMQ claims each job atomically, so no matter how many workers are running,
a submission is only ever picked up and judged by exactly one worker — they
never conflict with each other.

```bash
# Start a single worker (ID is auto-assigned, e.g. MacBook-1)
npm run worker

# Start a worker with an explicit ID
npm run worker -- --id 1
npm run worker -- --id 2

# Start several workers at once: 4 workers with IDs 1-4
npm run worker:multi -- 4

# Or control it through environment variables
JUDGE_WORKER_COUNT=4 npm run worker:multi
JUDGE_WORKER_IDS=1,2,3 npm run worker:multi
```

Related environment variables:

```env
JUDGE_CONCURRENCY=4   # How many submissions each worker judges in parallel
                      # (total capacity = workers x this value)
JUDGE_ID=1            # Worker ID (optional; auto-assigned when not set)
JUDGE_WORKER_COUNT=4  # Worker count for "npm run worker:multi"
JUDGE_WORKER_IDS=1,2  # Explicit ID list for "npm run worker:multi"
```

### How workers avoid conflicts

- **Atomic claiming** — BullMQ locks each job in Redis when it is claimed, so
  two workers can never pick up the same job at the same time.
- **Idempotent enqueueing** — every code path enqueues submissions through
  `enqueueJudge()` in `lib/queue.ts`, which uses a fixed job ID per submission.
  Repeated clicks or concurrent rejudges produce only one queue job, and a
  submission that is already being judged is never enqueued a second time.
- **Single scheduler** — the contest status scheduler
  (`PENDING → RUNNING → ENDED`) elects one leader among the workers through a
  Redis lease, so it never runs twice.

### Judge program compilation cache

Compiled checkers, interactors and communicators are saved in
`uploads/problems/<problem ID>/.judge-cache/`. Processes sharing this directory
and the same go-judge URL reuse the compiled bytes. Source paths, source contents,
`testlib.h` and compilation options are checked on each request; changes or a
missing/corrupt cache trigger compilation. Redis leases coordinate concurrent
cache misses across worker processes.

Each submission uploads its own temporary executable from the cached bytes and
cleans it up after judging. Updating a source does not affect submissions already
using an older executable, and cached bytes survive Web, Worker and go-judge
restarts. The cache lives outside the test data directory, so data uploads do not
replace it and problem exports do not include it. Remove the corresponding cache
directory after upgrading the compiler or sandbox environment to force a rebuild.

Run `npm run test:judge-cache` for cache tests. With Redis and go-judge available,
run `npm run test:judge-cache:integration` for real compilation and multi-process
checks without database access.

### Stress testing

`stress-test.ts` pushes submissions into the judge queue in batches and
measures judging throughput across all your workers:

```bash
npm run stress -- --total=100 --batch=20 --lang=cpp
```

Options: `--total` (submission count), `--batch` (batch size), `--lang`
(`c` | `cpp` | `java` | `pypy3`), `--problem` (problem ID),
`--no-wait` (enqueue only, don't wait for results), `--timeout` (seconds
to wait for judging to finish), and `--mark` (a marker comment written into
every submission for later identification). It reports enqueue throughput,
verdict distribution, total judging time, and how many submissions each worker
processed.

### Monitoring workers on the admin dashboard

Every worker registers itself in Redis with a heartbeat (ID, hostname, PID,
concurrency, processed count, currently judging submissions). The admin
dashboard (**Admin → Dashboard → Judge Workers**) lists all online workers
with their IDs plus queue statistics (waiting / active / done / failed) and
refreshes automatically every 5 seconds. A worker that stops is removed from
the list within 15 seconds.

## Scripts

```bash
npm run dev          # Start the development server
npm run build        # Build for production
npm run start        # Start the production server
npm run lint         # Run ESLint
npm run prisma       # Generate Prisma Client
npm run worker       # Start a judge worker (auto-assigned ID)
npm run worker:multi # Start multiple judge workers, e.g. "npm run worker:multi -- 4"
npm run worker:dev   # Start a judge worker in watch mode
npm run stress       # Stress-test the judge queue with bulk submissions
```

## Project Layout

```text
NovaJudge/
├─ app/              # Next.js App Router pages and API routes
├─ components/       # Shared UI components
├─ context/          # Frontend providers
├─ docs/             # API documentation and notes
├─ lib/              # Auth, judge, queue, Redis, Prisma, CCS helpers
├─ prisma/           # Database schema and migrations
├─ public/           # Static assets
├─ scripts/          # CLI and maintenance scripts
├─ uploads/          # Problem data and assets
├─ worker.ts         # Judge worker (multi-instance with heartbeat)
└─ docker-compose.yml
```

## API And CCS

NovaJudge exposes platform APIs for contest/problem/submission workflows and
ICPC CCS-compatible endpoints for contest tooling, resolver workflows, and
onsite displays. API key authentication is available for trusted integrations.

See [docs/API_DOCS.md](docs/API_DOCS.md) for more details.

## License

NovaJudge is released under the [MIT License](LICENSE).
