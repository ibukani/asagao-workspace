import PQueue from "p-queue";
import { AdapterError, ADAPTER_ERROR_CODES } from "../errors.ts";
import { safeErrorMessage } from "../safe-metadata.ts";
import type { JobQueue, JobQueueRunOptions, JobQueueStats } from "./job-queue.ts";

export type PQueueJobQueueOptions = {
  concurrency?: number;
  perWorkspaceConcurrency?: number;
};

export class PQueueJobQueue implements JobQueue {
  readonly #globalQueue: PQueue;
  readonly #workspaceQueues = new Map<string, PQueue>();
  readonly #perWorkspaceConcurrency: number;

  constructor({ concurrency = 2, perWorkspaceConcurrency = 1 }: PQueueJobQueueOptions = {}) {
    this.#globalQueue = new PQueue({ concurrency });
    this.#perWorkspaceConcurrency = perWorkspaceConcurrency;
  }

  async add<Result>(job: () => Promise<Result>, options: JobQueueRunOptions = {}): Promise<Result> {
    const runInWorkspaceQueue = (): Promise<Result> => {
      if (options.workspaceId === undefined) {
        return job();
      }

      return this.#workspaceQueue(options.workspaceId).add(job, { signal: options.signal });
    };

    try {
      return await this.#globalQueue.add(runInWorkspaceQueue, { signal: options.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AdapterError({
          operation: "job_queue.add",
          code: ADAPTER_ERROR_CODES.processCancelled,
          message: "Queued job was cancelled.",
          details: { workspaceId: options.workspaceId },
          cause: error,
        });
      }

      throw new AdapterError({
        operation: "job_queue.add",
        code: ADAPTER_ERROR_CODES.processFailed,
        message: "Queued job failed.",
        details: {
          workspaceId: options.workspaceId,
          message: safeErrorMessage(error),
        },
        cause: error,
      });
    }
  }

  stats(): JobQueueStats {
    const workspaceStats = [...this.#workspaceQueues.values()].reduce(
      (accumulator, queue) => ({
        pending: accumulator.pending + queue.size,
        running: accumulator.running + queue.pending,
      }),
      { pending: 0, running: 0 },
    );
    const pending = this.#globalQueue.size + workspaceStats.pending;
    const running = this.#globalQueue.pending + workspaceStats.running;

    return {
      pending,
      running,
      size: pending + running,
    };
  }

  #workspaceQueue(workspaceId: string): PQueue {
    const existing = this.#workspaceQueues.get(workspaceId);
    if (existing !== undefined) {
      return existing;
    }

    const queue = new PQueue({ concurrency: this.#perWorkspaceConcurrency });
    this.#workspaceQueues.set(workspaceId, queue);
    return queue;
  }
}
