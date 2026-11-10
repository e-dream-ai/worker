import { createRunpodClient, type components, type RunpodClient } from '@runpod/typescript-api-sdk';
import type { AccountLimits, Endpoint, EndpointHealth, GpuType, WorkerCounts } from './types.js';

const JOBS_URL = 'https://api.runpod.ai/v2';
const GRAPHQL_URL = 'https://api.runpod.io/graphql';
const ACCOUNT_LIMITS_QUERY = 'query { myself { maxServerlessConcurrency spendLimit currentSpendPerHr } }';
const TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT_LENGTH = 300;

type ErrorResponse = components['schemas']['ErrorResponse'];

interface ApiResult<T> {
  readonly data?: T;
  readonly error?: unknown;
  readonly response: Response;
}

interface HealthResponse {
  readonly jobs: { readonly inQueue: number };
  readonly workers: Omit<WorkerCounts, 'unhealthy'> & { readonly unhealthy?: number };
}

interface AccountLimitsResponse {
  readonly data?: {
    readonly myself?: {
      readonly maxServerlessConcurrency?: number | null;
      readonly spendLimit?: number | null;
      readonly currentSpendPerHr?: number | null;
    };
  };
  readonly errors?: readonly { readonly message: string }[];
}

const authHint = (status: number): string =>
  status === 401 || status === 403 ? '; check that RUNPOD_API_KEY is valid and allowed to use the RunPod API' : '';

const positiveOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && value > 0 ? value : null;

function describeError(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, MAX_ERROR_TEXT_LENGTH) || 'no details';
  if (typeof error !== 'object' || error === null) return 'no details';
  const { title, detail, errors = [] } = error as Partial<ErrorResponse>;
  return [title, detail, ...errors].filter(Boolean).join(': ') || 'no details';
}

function unwrap<T>({ data, error, response }: ApiResult<T>, action: string): T {
  if (data !== undefined) return data;
  throw new Error(`${action} returned ${response.status}: ${describeError(error)}${authHint(response.status)}`);
}

export class RunpodAdminClient {
  readonly #apiKey: string;
  readonly #rest: RunpodClient;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('RUNPOD_API_KEY is not set, add it to worker/.env');
    this.#apiKey = apiKey;
    this.#rest = createRunpodClient({ apiKey });
  }

  async listEndpoints(): Promise<Endpoint[]> {
    const endpoints: Endpoint[] = [];
    let cursor: string | null = null;
    do {
      const query: { cursor?: string } = cursor === null ? {} : { cursor };
      const page = unwrap(await this.#rest.GET('/v2/serverless', { params: { query } }), 'Listing endpoints');
      endpoints.push(...page.endpoints);
      cursor = page.pagination.hasNextPage ? page.pagination.nextCursor : null;
    } while (cursor !== null);
    return endpoints;
  }

  async listServerlessGpuStock(): Promise<GpuType[]> {
    const result = await this.#rest.GET('/v2/catalog/gpus', {
      params: { query: { include: ['AVAILABILITY'], product: ['SERVERLESS'] } },
    });
    return unwrap(result, 'Loading GPU stock').gpus;
  }

  async getHealth(id: string): Promise<EndpointHealth> {
    const { jobs, workers } = (await this.#fetchJson(`${JOBS_URL}/${encodeURIComponent(id)}/health`)) as HealthResponse;
    const { running, idle, initializing, throttled, unhealthy = 0 } = workers;
    return { queued: jobs.inQueue, workers: { running, idle, initializing, throttled, unhealthy } };
  }

  async getAccountLimits(): Promise<AccountLimits> {
    const { data, errors = [] } = (await this.#fetchJson(GRAPHQL_URL, {
      method: 'POST',
      body: JSON.stringify({ query: ACCOUNT_LIMITS_QUERY }),
    })) as AccountLimitsResponse;
    if (errors.length > 0) throw new Error(`RunPod GraphQL error: ${errors.map(({ message }) => message).join('; ')}`);
    const myself = data?.myself;
    return {
      workerCap: positiveOrNull(myself?.maxServerlessConcurrency),
      spendLimitPerHour: positiveOrNull(myself?.spendLimit),
      currentSpendPerHour: myself?.currentSpendPerHr ?? null,
    };
  }

  async setMaxWorkers(id: string, max: number): Promise<Endpoint> {
    const result = await this.#rest.PATCH('/v2/serverless/{id}', {
      params: { path: { id } },
      body: { workers: { max } },
    });
    return unwrap(result, `Updating endpoint ${id}`);
  }

  async #fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}${authHint(response.status)}`);
    }
    return response.json();
  }
}
