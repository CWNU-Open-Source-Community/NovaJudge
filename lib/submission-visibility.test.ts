import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { zh as dict } from "./dictionaries";

type ReactElementLike = {
  type: unknown;
  props?: Record<string, unknown>;
};

function loadModule<T>(filename: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(path.resolve(filename), "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports = {};
  vm.runInNewContext(
    compiled.outputText,
    {
      exports,
      require: (name: string) => {
        if (name in dependencies) return dependencies[name];
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        return {};
      },
      process: { cwd: () => process.cwd(), env: { NODE_ENV: "test" } },
      console: { error() {}, log() {} },
      URLSearchParams,
    },
    { filename },
  );
  return exports as T;
}

function findElements(
  node: unknown,
  predicate: (el: ReactElementLike) => boolean,
  found: ReactElementLike[] = [],
): ReactElementLike[] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found);
    return found;
  }
  const el = node as ReactElementLike;
  if ("type" in el) {
    if (predicate(el)) found.push(el);
    if (el.props && "children" in el.props) {
      findElements(el.props.children, predicate, found);
    }
  }
  return found;
}

const CodeViewerStub = () => null;
const StatusControlsStub = () => null;
const VerdictCellStub = () => null;

const PrismaEnums = {
  ContestRole: { TEAM: "TEAM", JUDGE: "JUDGE", ADMIN: "ADMIN" },
  ContestStatus: { PENDING: "PENDING", RUNNING: "RUNNING", ENDED: "ENDED" },
  ContestType: { PUBLIC: "PUBLIC", PRIVATE: "PRIVATE" },
  Verdict: {
    PENDING: "PENDING",
    JUDGING: "JUDGING",
    ACCEPTED: "ACCEPTED",
    WRONG_ANSWER: "WRONG_ANSWER",
    TIME_LIMIT_EXCEEDED: "TIME_LIMIT_EXCEEDED",
    MEMORY_LIMIT_EXCEEDED: "MEMORY_LIMIT_EXCEEDED",
    RUNTIME_ERROR: "RUNTIME_ERROR",
    COMPILE_ERROR: "COMPILE_ERROR",
    PRESENTATION_ERROR: "PRESENTATION_ERROR",
    SYSTEM_ERROR: "SYSTEM_ERROR",
  },
};

function renderSubmissionDetail(options: {
  contestAccessError?: Error;
  contest: {
    status: string;
    config: { frozenDuration?: number } | null;
    startTime: Date;
    endTime: Date;
  };
  submission: {
    id: string;
    displayId: number;
    contestId: number;
    problemId: number;
    userId: string | null;
    globalUserId: string | null;
    virtualParticipationId: string | null;
    language: string;
    code: string;
    codeLength: number;
    verdict: string;
    timeUsed: number | null;
    memoryUsed: number | null;
    errorMessage: string | null;
    submittedAt: Date;
    user: { id: string; username: string; displayName: string | null; role: string; contestId: number } | null;
    globalUser: { id: string; username: string; displayName: string | null } | null;
    problem: { id: number; title: string };
  };
  globalUser?: { userId: string; isGlobalAdmin: boolean } | null;
  contestUser?: { userId: string; role: string; contestId: number } | null;
  runningVp?: { id: string; attemptNo: number } | null;
}) {
  const { default: SubmissionDetail } = loadModule<
    typeof import("../app/(main)/contest/[contestId]/(board)/status/[submissionId]/page")
  >("app/(main)/contest/[contestId]/(board)/status/[submissionId]/page.tsx", {
    "@/lib/contest-access": {
      requireContestAccess: async () => {
        if (options.contestAccessError) throw options.contestAccessError;
      },
    },
    "@/lib/contest-interface": { usesDomjudge: async () => false },
    "next/navigation": {
      notFound: () => {
        throw new Error("NOT_FOUND");
      },
    },
    "@/lib/prisma": {
      prisma: {
        contest: { findUnique: async () => options.contest },
        submission: { findFirst: async () => options.submission },
        user: {
          findUnique: async () =>
            options.contestUser
              ? {
                  id: options.contestUser.userId,
                  role: options.contestUser.role,
                  contestId: options.contestUser.contestId,
                }
              : null,
        },
        contestProblem: { findFirst: async () => ({ displayId: "A" }) },
      },
    },
    "@/lib/auth": {
      getCurrentSuper: async () => options.globalUser ?? null,
      getCurrentUser: async () => options.contestUser ?? null,
    },
    "@/lib/generated/prisma/client": PrismaEnums,
    "@/components/VerdictBadge": { __esModule: true, default: () => null },
    "next/link": { __esModule: true, default: () => null },
    "./CodeViewer": { __esModule: true, default: CodeViewerStub },
    "@/lib/get-dictionary": {
      getDictionary: async () => dict,
      getLanguage: async () => "zh",
    },
    "@/lib/dictionaries": {
      formatMessage: (template: string) => template,
      getLocale: () => "zh-CN",
    },
    "@/lib/virtual-participation": {
      getRunningVirtualParticipation: async () => options.runningVp ?? null,
    },
    "../RejudgeControls": { ContestRejudgeButton: () => null },
  });

  return SubmissionDetail({
    params: Promise.resolve({ contestId: "1001", submissionId: String(options.submission.displayId) }),
  });
}

function renderStatusList(options: {
  contestAccessError?: Error;
  contest: {
    status: string;
    config: { frozenDuration?: number } | null;
    startTime: Date;
    endTime: Date;
  };
  globalUser?: { userId: string; isGlobalAdmin: boolean } | null;
  contestUser?: { userId: string; role: string; contestId: number } | null;
  latestVp?: { id: string; attemptNo: number; status: string; startedAt: Date; endedAt: Date } | null;
  viewAll?: string;
}) {
  const capturedWhere: Record<string, unknown>[] = [];
  const sampleSubmission = {
    id: "sub-other",
    displayId: 42,
    contestId: 1001,
    problemId: 1,
    userId: "team-other",
    globalUserId: null,
    virtualParticipationId: null,
    language: "cpp",
    verdict: "COMPILE_ERROR",
    timeUsed: 10,
    memoryUsed: 1024,
    passedTests: 0,
    totalTests: 5,
    errorMessage: "compiler diagnostic",
    submittedAt: new Date(options.contest.startTime.getTime() + 60_000),
    user: { id: "team-other", username: "team1", displayName: "Team 1", school: null, seat: null },
    globalUser: null,
    virtualParticipation: null,
    problem: { id: 1, title: "A+B" },
  };

  const { default: Status } = loadModule<
    typeof import("../app/(main)/contest/[contestId]/(board)/status/page")
  >("app/(main)/contest/[contestId]/(board)/status/page.tsx", {
    "@/lib/contest-access": {
      requireContestAccess: async () => {
        if (options.contestAccessError) throw options.contestAccessError;
      },
    },
    "@/lib/contest-interface": { usesDomjudge: async () => false },
    "next/link": { __esModule: true, default: () => null },
    "next/navigation": {
      redirect: (url: string) => {
        throw new Error(`REDIRECT:${url}`);
      },
    },
    "@/components/Pagination": { __esModule: true, default: () => null },
    "@/lib/generated/prisma/client": PrismaEnums,
    "@/lib/prisma": {
      prisma: {
        contest: { findUnique: async () => options.contest },
        user: {
          findUnique: async () =>
            options.contestUser
              ? {
                  id: options.contestUser.userId,
                  role: options.contestUser.role,
                  contestId: options.contestUser.contestId,
                }
              : null,
          findMany: async () => [],
        },
        submission: {
          count: async ({ where }: { where: Record<string, unknown> }) => {
            capturedWhere.push(where);
            return 1;
          },
          findMany: async ({ select }: { select?: Record<string, boolean> }) => {
            if (select?.language) return [{ language: "cpp" }];
            if (select?.verdict) return [{ verdict: "COMPILE_ERROR" }];
            return [sampleSubmission];
          },
        },
        contestProblem: {
          findMany: async () => [{ displayId: "A", problemId: 1, problem: { title: "A+B" } }],
          findFirst: async () => null,
        },
      },
    },
    "@/components/VerdictCell": { __esModule: true, default: VerdictCellStub },
    "./StatusControls": { __esModule: true, default: StatusControlsStub },
    "./SearchAndFilter": { __esModule: true, default: () => null },
    "@/lib/auth": {
      getCurrentSuper: async () => options.globalUser ?? null,
      getCurrentUser: async () => options.contestUser ?? null,
    },
    "@/lib/get-dictionary": {
      getDictionary: async () => dict,
      getLanguage: async () => "zh",
    },
    "@/lib/dictionaries": {
      formatMessage: (template: string) => template,
      getLocale: () => "zh-CN",
      getVerdictLabel: (verdict: string) => verdict,
    },
    "@/lib/virtual-participation": {
      getLatestVirtualParticipation: async () => options.latestVp ?? null,
    },
    "@/lib/contest-submission-query": {
      buildContestSubmissionWhere: async () => ({ contestId: 1001 }),
    },
    "@/lib/problem-badge": {
      problemColorStyle: () => undefined,
    },
    "./ContestSubmissionFilters": { __esModule: true, default: () => null },
    "./ContestRejudgePanel": { __esModule: true, default: () => null },
  });

  return Status({
    params: Promise.resolve({ contestId: "1001" }),
    searchParams: Promise.resolve({ viewAll: options.viewAll }),
  }).then((tree) => ({ tree, where: { ...capturedWhere[0] } }));
}

const pastStart = new Date(Date.now() - 180 * 60_000);
const pastEnd = new Date(Date.now() - 60 * 60_000);
const futureEnd = new Date(Date.now() + 60 * 60_000);

const baseSubmission = {
  id: "sub-1",
  displayId: 7,
  contestId: 1001,
  problemId: 1,
  userId: "team-other",
  globalUserId: null,
  virtualParticipationId: null,
  language: "cpp",
  code: "int main() { return 0; }",
  codeLength: 24,
  verdict: "ACCEPTED",
  timeUsed: 12,
  memoryUsed: 1024,
  errorMessage: null,
  submittedAt: new Date(pastStart.getTime() + 10 * 60_000),
  user: { id: "team-other", username: "team1", displayName: "Team 1", role: "TEAM", contestId: 1001 },
  globalUser: null,
  problem: { id: 1, title: "A+B" },
};

test("ended unfrozen contests allow global users and unlocked guests to view everyone's code, including VP submissions", async () => {
  const endedUnfrozen = {
    status: "ENDED",
    config: { frozenDuration: 0 },
    startTime: pastStart,
    endTime: pastEnd,
  };

  const vpSubmission = {
    ...baseSubmission,
    id: "sub-vp",
    userId: null,
    user: null,
    globalUserId: "global-other",
    globalUser: { id: "global-other", username: "other_user", displayName: "Other User" },
    virtualParticipationId: "vp-other",
    code: "// vp solution",
  };

  for (const viewer of [
    { globalUser: { userId: "global-viewer", isGlobalAdmin: false } },
    { globalUser: null, contestUser: null },
    { contestUser: { userId: "team-viewer", role: "TEAM", contestId: 1001 } },
  ]) {
    for (const submission of [baseSubmission, vpSubmission]) {
      const tree = await renderSubmissionDetail({
        contest: endedUnfrozen,
        submission,
        ...viewer,
      });
      const viewers = findElements(tree, (el) => el.type === CodeViewerStub);
      assert.equal(viewers.length, 1);
      assert.equal(viewers[0].props?.code, submission.code);
    }
  }
});

test("submission detail still enforces contest access, live/frozen restrictions, and active VP isolation", async () => {
  const globalViewer = { userId: "global-viewer", isGlobalAdmin: false };

  // Private contest access gate still runs before loading anything.
  await assert.rejects(
    renderSubmissionDetail({
      contestAccessError: new Error("REDIRECT:/contest/1001/access"),
      contest: { status: "ENDED", config: { frozenDuration: 0 }, startTime: pastStart, endTime: pastEnd },
      submission: baseSubmission,
      globalUser: globalViewer,
    }),
    /REDIRECT:\/contest\/1001\/access/,
  );

  // Live contest denies other users' submissions.
  await assert.rejects(
    renderSubmissionDetail({
      contest: { status: "RUNNING", config: { frozenDuration: 0 }, startTime: pastStart, endTime: futureEnd },
      submission: baseSubmission,
      globalUser: globalViewer,
    }),
    /NOT_FOUND/,
  );

  // Ended but still frozen contest denies other users' submissions.
  await assert.rejects(
    renderSubmissionDetail({
      contest: { status: "ENDED", config: { frozenDuration: 60 }, startTime: pastStart, endTime: pastEnd },
      submission: baseSubmission,
      globalUser: globalViewer,
    }),
    /NOT_FOUND/,
  );

  // Active running VP denies other users' submissions, but allows own current-VP submission.
  await assert.rejects(
    renderSubmissionDetail({
      contest: { status: "ENDED", config: { frozenDuration: 0 }, startTime: pastStart, endTime: pastEnd },
      submission: baseSubmission,
      globalUser: globalViewer,
      runningVp: { id: "vp-running", attemptNo: 1 },
    }),
    /NOT_FOUND/,
  );

  const ownVpTree = await renderSubmissionDetail({
    contest: { status: "ENDED", config: { frozenDuration: 0 }, startTime: pastStart, endTime: pastEnd },
    submission: {
      ...baseSubmission,
      userId: null,
      user: null,
      globalUserId: "global-viewer",
      globalUser: { id: "global-viewer", username: "viewer", displayName: "Viewer" },
      virtualParticipationId: "vp-running",
    },
    globalUser: globalViewer,
    runningVp: { id: "vp-running", attemptNo: 1 },
  });
  assert.equal(findElements(ownVpTree, (el) => el.type === CodeViewerStub).length, 1);
});

test("status list enables View All for global users after an ended unfrozen contest and respects freeze/VP gates", async () => {
  const globalViewer = { userId: "global-viewer", isGlobalAdmin: false };
  const endedUnfrozen = {
    status: "ENDED",
    config: { frozenDuration: 0 },
    startTime: pastStart,
    endTime: pastEnd,
  };

  // Ended & unfrozen: global user can view all submissions and compile diagnostics.
  const openResult = await renderStatusList({
    contest: endedUnfrozen,
    globalUser: globalViewer,
    viewAll: "true",
  });
  assert.deepEqual(openResult.where, { contestId: 1001 });
  const openControls = findElements(openResult.tree, (el) => el.type === StatusControlsStub);
  assert.equal(openControls.length, 1);
  assert.equal(openControls[0].props?.canViewAll, true);
  const openVerdicts = findElements(openResult.tree, (el) => el.type === VerdictCellStub);
  assert.equal((openVerdicts[0].props?.submission as { errorMessage: string | null }).errorMessage, "compiler diagnostic");

  // Ended but still frozen (even with a finished VP): global user cannot view all submissions.
  const frozenResult = await renderStatusList({
    contest: { status: "ENDED", config: { frozenDuration: 60 }, startTime: pastStart, endTime: pastEnd },
    globalUser: globalViewer,
    latestVp: {
      id: "vp-finished",
      attemptNo: 1,
      status: "FINISHED",
      startedAt: new Date(Date.now() - 40 * 60_000),
      endedAt: new Date(Date.now() - 10 * 60_000),
    },
    viewAll: "true",
  });
  assert.deepEqual(frozenResult.where, { contestId: 1001, globalUserId: "global-viewer" });
  const frozenControls = findElements(frozenResult.tree, (el) => el.type === StatusControlsStub);
  assert.equal(frozenControls[0].props?.canViewAll, false);
  const frozenVerdicts = findElements(frozenResult.tree, (el) => el.type === VerdictCellStub);
  assert.equal((frozenVerdicts[0].props?.submission as { errorMessage: string | null }).errorMessage, null);

  // Active running VP: restricted to current VP only.
  const vpResult = await renderStatusList({
    contest: endedUnfrozen,
    globalUser: globalViewer,
    latestVp: {
      id: "vp-active",
      attemptNo: 2,
      status: "RUNNING",
      startedAt: new Date(Date.now() - 10 * 60_000),
      endedAt: new Date(Date.now() + 50 * 60_000),
    },
    viewAll: "true",
  });
  assert.deepEqual(vpResult.where, {
    contestId: 1001,
    globalUserId: "global-viewer",
    virtualParticipationId: "vp-active",
  });
  const vpControls = findElements(vpResult.tree, (el) => el.type === StatusControlsStub);
  assert.equal(vpControls[0].props?.canViewAll, false);
});
