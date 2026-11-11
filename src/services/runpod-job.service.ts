import type { Job } from 'bullmq';
import pRetry, { AbortError } from 'p-retry';

export interface RunpodEndpoint<Payload> {
  run(payload: Payload, timeoutMs?: number): Promise<{ readonly id: string }>;
  status(runpodId: string): Promise<{ readonly status?: string }>;
}

const ENDED_WITHOUT_RESULT: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED', 'TIMED_OUT']);
const UNKNOWN_JOB_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404]);
const RETRYABLE_CLIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429]);
const STATUS_LOOKUP_RETRIES = 4;

const isTransient = (status: number | undefined): boolean =>
  status === undefined || status >= 500 || RETRYABLE_CLIENT_HTTP_STATUSES.has(status);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('response' in error && typeof error.response === 'object' && error.response !== null) {
    const { response } = error;
    return 'status' in response && typeof response.status === 'number' ? response.status : undefined;
  }
  return undefined;
}

function lookUpStatus<Payload>(endpoint: RunpodEndpoint<Payload>, runpodId: string): Promise<string | null> {
  return pRetry(
    async () => {
      try {
        const { status } = await endpoint.status(runpodId);
        return status ?? 'UNKNOWN';
      } catch (error) {
        const httpStatus = httpStatusOf(error);
        if (httpStatus !== undefined && UNKNOWN_JOB_HTTP_STATUSES.has(httpStatus)) return null;
        const failure = new Error(`Could not check RunPod job ${runpodId}: ${messageOf(error)}`);
        throw isTransient(httpStatus) ? failure : new AbortError(failure);
      }
    },
    { retries: STATUS_LOOKUP_RETRIES }
  );
}

const logToJob = (job: Job, message: string): Promise<number> => job.log(`${new Date().toISOString()}: ${message}`);

export async function submitOrResumeRunpodJob<Payload>(
  job: Job,
  endpoint: RunpodEndpoint<Payload>,
  payload: NoInfer<Payload>,
  timeoutMs?: number
): Promise<string> {
  const previousId: unknown = job.data?.runpod_id;

  if (typeof previousId === 'string' && previousId.length > 0) {
    const status = await lookUpStatus(endpoint, previousId);
    if (status !== null && !ENDED_WITHOUT_RESULT.has(status)) {
      await logToJob(job, `Resuming RunPod job ${previousId} (${status}) instead of submitting it again`);
      return previousId;
    }
    const reason = status === null ? 'no longer exists' : `ended as ${status}`;
    await logToJob(job, `RunPod job ${previousId} ${reason}, submitting a new one`);
  }

  const { id } = await endpoint.run(payload, timeoutMs);
  await job.updateData({ ...job.data, runpod_id: id });
  return id;
}
