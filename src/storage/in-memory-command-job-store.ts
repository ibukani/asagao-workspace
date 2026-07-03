import {
  commandJobSchema,
  type CommandJob,
  type CommandJobStatus,
} from "../domain/index.ts";

export type CommandJobListFilters = {
  workspaceId?: string;
  status?: readonly CommandJobStatus[];
};

export type CommandJobStore = {
  save: (job: CommandJob) => CommandJob;
  get: (jobId: string) => CommandJob | null;
  list: (filters?: CommandJobListFilters) => CommandJob[];
};

export class InMemoryCommandJobStore implements CommandJobStore {
  readonly #jobs = new Map<string, CommandJob>();

  save(job: CommandJob): CommandJob {
    const parsed = commandJobSchema.parse(job);
    this.#jobs.set(parsed.jobId, cloneCommandJob(parsed));
    return cloneCommandJob(parsed);
  }

  get(jobId: string): CommandJob | null {
    const job = this.#jobs.get(jobId);
    return job === undefined ? null : cloneCommandJob(job);
  }

  list(filters: CommandJobListFilters = {}): CommandJob[] {
    return [...this.#jobs.values()]
      .filter((job) => filters.workspaceId === undefined || job.workspaceId === filters.workspaceId)
      .filter((job) => filters.status === undefined || filters.status.includes(job.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(cloneCommandJob);
  }

  clear(): void {
    this.#jobs.clear();
  }
}

function cloneCommandJob(job: CommandJob): CommandJob {
  return commandJobSchema.parse({ ...job, command: [...job.command] });
}
