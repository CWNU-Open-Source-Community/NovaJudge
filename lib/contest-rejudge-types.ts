export interface ContestSubmissionFilters {
  userId?: string;
  userSearch?: string;
  problem?: string;
  language?: string;
  verdict?: string;
  runId?: string;
  from?: string;
  to?: string;
}

export interface ContestRejudgeRequest {
  filters: ContestSubmissionFilters;
  submissionIds?: string[];
  includeAccepted?: boolean;
}

export interface ContestRejudgePreview {
  error?: string;
  token?: string;
  count?: number;
  sample?: {
    id: string;
    displayId: number;
    teamName: string;
    problemLabel: string;
    verdict: string;
  }[];
}

export interface ContestRejudgeResult {
  error?: string;
  queued?: number;
  skipped?: number;
  failed?: number;
  submissionIds?: string[];
}

export interface ContestRejudgeProgress {
  error?: string;
  pending?: number;
  judging?: number;
  completed?: number;
  failed?: number;
}

export const MAX_CONTEST_REJUDGE_BATCH = 5000;
