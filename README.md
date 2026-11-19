# NovaJudge

[![CI](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml/badge.svg)](https://github.com/CWNU-Open-Source-Community/NovaJudge/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

English · [简体中文](./README.zh-CN.md)

NovaJudge is a self-hosted, open-source online judge for ICPC- and CCPC-style programming contests and everyday practice. Schools, clubs, and contest organizers can run it on their own servers.

[Contestant guide](#contestant-guide) · [Administrator guide](#administrator-guide) · [Local quick start](#quick-start) · [Documentation](#documentation)

## Features

- **Contests and practice** cover public and password-protected contests, ACM-style standings with scoreboard freezes, team clarifications and announcements, training lists, post-contest practice, and virtual participation.
- **Problem authoring and judging** include manual authoring and Polygon or NovaJudge ZIP imports. Supported formats include standard input/output, custom checkers, interactive tasks, and two-run communication problems. The go-judge sandbox runs C, C++, Java, and PyPy3 submissions. Multiple workers can share the judging queue.
- **Contest operations and integrations** include team and staff imports, judge monitoring and rejudging, awards, balloon delivery, and a print queue. NovaJudge exports Event Feeds for ICPC Tools Resolver and supports ICPC CCS, external authentication, and proctoring clients.

## Contestant guide

### Enter a contest and submit

1. **Open the contest.** Choose it on your site's home page or follow the organizer's link. A private contest asks for its **contest password** before you can view problems or standings.
2. **Sign in as your team.** Use **Sign In** on the contest home page with the team username and password from the organizer. The contest password unlocks the pages, and the team password signs you in. Follow the organizer's instructions if the contest uses a proctoring client. If you already have a site-wide session, sign out before signing in as your team.
3. **Read the problem and submit.** Once the contest starts, open **Problems**, pick a task, and read its input, output, examples, and limits. Use **Submit** on the problem page, choose a language, paste your source code, and submit it.
4. **Check the result.** Open **Status** for verdicts. `AC` means accepted, `WA` means wrong answer, `CE` means compilation error, and `TLE` means time limit exceeded. Use **Rank** for standings and **Clarifications** for announcements or questions to the judges.

### Practice, virtual participation, and the intranet CLI

- If your site has external authentication set up, use **外部登录** (external sign-in) in the site navigation, then open the training center (`/train`). After a contest ends, you can return to it and submit practice solutions with an external account. If the contest home shows **Virtual Participation**, you can start a timed attempt on your own schedule. Open **Editorial** in the contest navigation when the organizer publishes a write-up.
- At an onsite contest, teams can choose **Print** in the contest navigation to upload source code and track their print requests.
- If your organizer enables the intranet CLI, open `/cli` to install the Windows or macOS client. Run `submit A.cpp` and follow the prompts to pair it with your team. `printfile` requires a device grant issued by the proctoring client. [Contestant CLI guide](./docs/CONTESTANT_CLI.md)

## Administrator guide

### Sign in to the admin panel

The site-wide panel requires a **super administrator** account. While signed out, quickly click an empty area of the top navigation bar three times to open **Super Admin Access**. Enter your credentials, then choose **Panel** or visit `/admin`. Use **English** in the admin header to switch from the default Chinese interface. For a fresh installation, the initial credentials come from `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` in `.env`.

Contest staff use **Sign In** on their contest home page and work from that contest's pages. The roles `ADMIN`, `JUDGE`, `BALLOON`, `PRINT`, and `OBSERVER` cover contest administration, judging, balloon delivery, printing, and observation.

### Prepare problems

- **Create a problem.** In **Problem Bank → Create Problem**, enter a title, time limit in milliseconds, memory limit, judge type, statement, and samples. Save it and open **Manage Data & Config** from the problem list. Upload the complete set of judge data together, for example `1.in` and `1.out`. NovaJudge can match the filenames and generate `problem.yml`, which you can edit on the same page. A new upload replaces the current test data files.
- **Import a package.** In **Problem Bank → Import**, choose NovaJudge ZIP or Polygon ZIP. Polygon packages need generated inputs, reference answers, and the checker source. Problems with interactive runs also need the interactor source. A Polygon contest package adds its problems to the bank. Create the contest in NovaJudge and attach those problems to it. Use **Update Problem** in the problem list to replace an existing problem from a single-problem ZIP while preserving its ID, contest links, and submission history. [Polygon import guide](./docs/POLYGON_IMPORT.md)
- **Validate judging.** Open **Test Problem** from the problem list and run **Debug All Samples** with the reference solution. Before publishing, submit that solution with a team account to check the full judge data.

### Create a contest and import accounts

1. Open **Contest Management → Create Contest**. Set a title, schedule, description, and contest type. Private contests require a contest password. The visibility option controls whether the contest appears on the home page.
2. Open **Problems** for the contest. Enter the **Original Problem ID** from the problem bank, then assign a **Display ID** such as `A`. For onsite contests, you can also set the balloon color.
3. Under **Users**, choose **Teams** or **Staff & Judges**. Paste tab-separated spreadsheet rows in the order shown below. Check the preview and select **Import Users**.

   | Account type | Column order |
   | --- | --- |
   | Teams | Username → Password → TeamName → School → Members → Seat → Coach → Type → AutoLoginIP |
   | Staff & Judges | Username → Password → RealName → Role |

   Leave Password blank to generate one. The team Type is `0` for official, `1` for unofficial (starred), or `2` for a girls' team. Use **Export CSV** to retrieve the credentials and distribute them to the corresponding teams and staff. For a private contest, share the contest link and contest password as well.

### Run a practice contest

Create a standard input/output problem named `A+B`. Ask for two integers on one line and the sum as output. Add the sample input `2 3` and output `5`. Put the same values in `1.in` and `1.out` and upload them together as judge data.

Create a practice contest, attach the problem as `A`, and import a test team. Once the contest starts, sign in as that team in a private browser window. Choose **PyPy3**, submit the code below, and look for `AC` in **Status**. Check **Rank** for the team's solved problem.

```python
print(sum(map(int, input().split())))
```

### During and after a contest

| Task | Where to do it |
| --- | --- |
| Answer questions and post announcements | Open **Clarifications** in the contest. Signed-in contest `ADMIN` and `JUDGE` users receive pending-question alerts. |
| Check judging and workers | Open **Judge Monitor** in the admin panel. If submissions keep waiting, check worker status first, then Redis and go-judge. |
| Rejudge submissions | In contest **Status**, filter by problem, team, or verdict and preview the rejudge batch. Use **Submissions** in the admin panel for site-wide batch rejudging. |
| Unfreeze and export results | Use contest **Rank** to unfreeze, export results, or open printable standings. Open the contest's **Awards** page in the admin panel to configure awards and export a Resolver Event Feed. |
| Publish an editorial | Edit the contest and upload the write-up under **Editorial PDF**. |
| Handle onsite tasks | Use **Balloon** to assign and complete deliveries and **Print Queue** to process team print requests. |

Use **Training** in the admin panel to organize training lists. To enable external authentication, configure the provider and enable **Allow External Login** under **Settings**. For an isolated intranet, set `NOVAJUDGE_CLI_MODE=intranet` in the Web environment, restart Web, and select the CLI contest under **Settings**. [Deployment configuration](./docs/DEPLOYMENT.md)

## Quick start

If your organizer already provides a site, start with the [contestant guide](#contestant-guide). For a local instance, the recommended version is **Node.js 22.12+ on the 22.x release line**. You also need npm and Docker Compose v2 with Linux container support. The commands below use Bash. [Other supported Node.js versions](./package.json)

```bash
git clone https://github.com/CWNU-Open-Source-Community/NovaJudge.git
cd NovaJudge
cp .env.example .env
```

Edit `.env`. Set `POSTGRES_PASSWORD` and the matching `DATABASE_URL`. With the bundled Compose configuration, the URL looks like `postgresql://postgres:YOUR_PASSWORD@localhost:5432/xcpc_oj?schema=public`. Replace the placeholder with the URL-encoded password. Set a separate `JWT_SECRET`, the initial `SUPER_ADMIN_USERNAME`, and `SUPER_ADMIN_PASSWORD`. [Environment template](./.env.example)

```bash
npm ci --include=dev
docker compose up -d --build --wait
npm run db:deploy
npm run dev
```

In a second terminal, start the judge worker from the project directory.

```bash
npm run worker
```

Open [http://localhost:3001](http://localhost:3001), then follow the [administrator guide](#administrator-guide) to sign in and run a practice contest. Compose provides PostgreSQL, Redis, and go-judge. The npm commands start Web and the worker.

For production, build with `npm run build` and run `npm run start` and the workers under your service manager. When upgrading an existing deployment, back up PostgreSQL, `uploads/`, and `.env` before applying migrations. Use `npm run worker:multi -- 4` to start four workers on one host, or share the problem data across worker hosts. [Production deployment and upgrades](./docs/DEPLOYMENT.md)

## Documentation

| Guide | What it covers |
| --- | --- |
| [Deployment and maintenance](./docs/DEPLOYMENT.md) | Environment variables, external authentication, branding, migrations, backups, and rollback |
| [Polygon imports](./docs/POLYGON_IMPORT.md) · [Communication problems](./docs/COMMUNICATION_PROBLEMS.md) | Package formats, supported problem types, and judge configuration |
| [Contestant CLI](./docs/CONTESTANT_CLI.md) · [Proctoring client](./docs/PROCTORING_LOGIN.md) | Intranet installation, device pairing, submission, and printing |
| [APIs and ICPC CCS](./docs/API_DOCS.md) | API keys, contest data, and external integrations |
| [C++23 toolchain](./docs/CPP23_COMPILER_FIX.md) · [Windows integration testing](./docs/WINDOWS_FULL_E2E.md) | Sandbox toolchain and onsite testing |
| [Changelog](./docs/CHANGELOG.md) | Release history |

## Contributing

NovaJudge uses Next.js, React, and TypeScript. Web pages and APIs are in `app/`, judge code is in `lib/judge.ts` and `lib/judge/`, the worker starts from `worker.ts`, and the database models and migrations are in `prisma/`.

Report bugs in [Issues](https://github.com/CWNU-Open-Source-Community/NovaJudge/issues) with the version, reproduction steps, and logs with sensitive values removed. Run the following checks before opening a pull request.

```bash
npm test
npm run lint
npm run build
```

## License

NovaJudge is available under the [MIT License](./LICENSE).
