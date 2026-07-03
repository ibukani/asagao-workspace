export type JobQueueStats = {
  pending: number;
  running: number;
  size: number;
};

export type JobQueueRunOptions = {
  workspaceId?: string;
  signal?: AbortSignal;
};

export type JobQueue = {
  add: <Result>(job: () => Promise<Result>, options?: JobQueueRunOptions) => Promise<Result>;
  stats: () => JobQueueStats;
};
