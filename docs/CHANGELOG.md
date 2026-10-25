# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Contest Rejudge (比赛内重判)**: Contest administrators and judges can use the contest submission page to search team names, accounts, schools, seats, Run IDs, problems, verdicts, languages and time ranges; rejudge individual, selected or all matching submissions; and follow batch progress. Leaderboard team names and problem cells link to the corresponding filtered submissions. Batch previews bind a fixed submission list to the current account and contest for 10 minutes, require explicit AC inclusion, and skip pending/running jobs. Queue failures restore untouched results and are reported separately from skipped submissions.
- **Batch Rejudge (条件重测)**: Admins can rejudge submissions in bulk by contest, problem, verdict, username, or submitted time range from the admin submissions page, with a live count preview, confirmation dialog, and a safety limit of 5000 submissions per batch.
- **Monitoring Dashboard (监控仪表盘)**: New `/admin/monitor` page with per-minute submission chart (last 60 min), judge queue depth, judge worker status, verdict distribution, active team count, and running contest count, auto-refreshed via polling.
- **Awards Setup (快速设置奖项)**: New `/admin/contests/[id]/awards` page to configure gold/silver/bronze medal counts (fixed or ratio) and custom awards with a live standings preview. When enabled, the CCS event-feed export now includes `awards` events (gold/silver/bronze + custom), ready for ICPC Tools resolver reveal ceremonies.
  - Built-in **First to Solve (快速解题奖)** awards use one record per solved problem, with ID `first-to-solve-${problem.id}` and the winning team in `team_ids`; Resolver combines multiple awards for the same team when displaying them. Star teams are eligible.
  - Built-in **Champion/Runner-up/Third (冠军/亚军/季军)** awards with per-school deduplication (each school takes at most one seat, awarded to its best team).
  - Built-in **Excellence (优秀奖)** award: all teams with at least one solve that did not win a medal.
  - Award events now match the ICPC Tools award tool format: no `op` field, `parameters` on every award, and medals carry an extra `display_mode: "list"` clone for the resolver list presentation.
  - Custom award team picker now has a **search box** with multi-select checkboxes.

### Changed
- Contestant TLE verdicts now require measured CPU time to exceed the CPU limit. Ordinary, SPJ, interactive, communication and sample runs use a separate wall-time watchdog (`max(JUDGE_WALL_WATCHDOG_MS, 20 × CPU limit)`, default minimum 60 seconds); watchdog expiration without CPU overrun is a system error with timing diagnostics. Checker/interactor resource failures are also system errors.
- Leaderboard cells now display solve time in minutes instead of `hh:mm:ss` (calculation unchanged).

## [1.0.0] - 2026-03-06

### Added
- **Core Contest System**: Support for creating and managing programming contests with real-time scoreboards.
- **Judge Engine Integration**: Integrated with Go-Judge for secure and efficient code execution (C, C++, Java, Python).
- **Admin Dashboard**: Comprehensive admin interface for managing contests, problems, users, and submissions.
- **CCS API**: Implemented ICPC Contest Control System (CCS) compliant API endpoints for external tools (e.g., scoreboard resolvers).
- **Real-time Updates**: Live updates for contest events, submissions, and scoreboard changes using Redis.
- **Problem Management**: Support for special judge (SPJ), interactive problems, and test case management.
- **User Roles**: Distinct roles for Teams, Admins, Judges, and Observers.
- **Export/Import**: Functionality to export and import contest data and problem sets.
- **Balloon Tracking**: System for tracking and managing balloon delivery for solved problems.
- **Clarification System**: Q&A system for contestants to ask clarifications during contests.
- **Contest Visibility**: Added ability for admins to toggle contest visibility on the homepage.

### Changed
- **Judge Logic**: Java submissions now have 2x time and memory limits automatically applied.
- **UI/UX**: Improved pagination logic in admin panels to support deep linking and browser history.
- **Database Schema**: Optimized Prisma schema for better performance and data integrity.

### Fixed
- Fixed pagination issues in the admin problem list where data wouldn't refresh on page change.
- Fixed incremental progress bar updates for live contest feeds.
- Resolved various UI glitches and data fetching inconsistencies.
