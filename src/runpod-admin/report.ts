import { isFailure } from './result.js';
import type { AvailabilityLevel, Endpoint, EndpointStatus, GpuType, Snapshot } from './types.js';

const SPEND_WARNING_RATIO = 0.8;

const AVAILABILITY_BEST_FIRST = ['HIGH', 'MEDIUM', 'LOW', 'NONE'] as const satisfies readonly AvailabilityLevel[];

export type Problem =
  | { readonly kind: 'fetch-failed'; readonly endpoint: string; readonly error: string }
  | { readonly kind: 'no-max'; readonly endpoint: string; readonly queued: number }
  | { readonly kind: 'at-max'; readonly endpoint: string; readonly queued: number; readonly max: number }
  | {
      readonly kind: 'throttled';
      readonly endpoint: string;
      readonly queued: number;
      readonly throttled: number;
      readonly availability: AvailabilityLevel | null;
    }
  | { readonly kind: 'unhealthy'; readonly endpoint: string; readonly unhealthy: number }
  | { readonly kind: 'over-cap'; readonly totalMax: number; readonly cap: number }
  | { readonly kind: 'spend-near-limit'; readonly current: number; readonly limit: number };

export type ProblemKind = Problem['kind'];

export interface Capacity {
  readonly totalMax: number;
  readonly cap: number | null;
  readonly free: number | null;
}

export interface MaxChangePlan {
  readonly endpoint: Endpoint;
  readonly from: number;
  readonly to: number;
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly cap: number | null;
  readonly overCapBy: number;
}

const bestAvailability = (levels: readonly AvailabilityLevel[]): AvailabilityLevel | null =>
  AVAILABILITY_BEST_FIRST.find((level) => levels.includes(level)) ?? null;

function gpuAvailability(gpu: GpuType, dataCenterIds: readonly string[]): AvailabilityLevel | null {
  const dataCenters = gpu.dataCenters ?? [];
  if (dataCenterIds.length === 0 || dataCenters.length === 0) return gpu.availability ?? null;
  const allowed = dataCenters.filter((dataCenter) => dataCenterIds.includes(dataCenter.id));
  return bestAvailability(allowed.map((dataCenter) => dataCenter.availability)) ?? 'NONE';
}

export function endpointAvailability(endpoint: Endpoint, stock: readonly GpuType[]): AvailabilityLevel | null {
  const pools = endpoint.gpu?.pools ?? [];
  const excluded = endpoint.gpu?.excludedTypes ?? [];
  const levels = stock
    .filter((gpu) => gpu.pool !== null && pools.includes(gpu.pool) && !excluded.includes(gpu.id))
    .map((gpu) => gpuAvailability(gpu, endpoint.dataCenterIds))
    .filter((level): level is AvailabilityLevel => level !== null);
  return bestAvailability(levels);
}

export function capacity(snapshot: Snapshot): Capacity {
  const totalMax = snapshot.endpoints.reduce((sum, { endpoint }) => sum + endpoint.workers.max, 0);
  const cap = snapshot.account.ok ? snapshot.account.value.workerCap : null;
  return { totalMax, cap, free: cap === null ? null : cap - totalMax };
}

function diagnoseEndpoint({ endpoint, health, availability }: EndpointStatus): Problem[] {
  const { name } = endpoint;
  const { max } = endpoint.workers;
  if (isFailure(health)) return [{ kind: 'fetch-failed', endpoint: name, error: health.error }];

  const { workers, queued } = health.value;
  const problems: Problem[] = [];
  if (workers.unhealthy > 0) problems.push({ kind: 'unhealthy', endpoint: name, unhealthy: workers.unhealthy });
  if (queued === 0) return problems;

  if (max === 0) {
    problems.push({ kind: 'no-max', endpoint: name, queued });
  } else if (workers.throttled > 0) {
    problems.push({ kind: 'throttled', endpoint: name, queued, throttled: workers.throttled, availability });
  } else if (workers.running >= max) {
    problems.push({ kind: 'at-max', endpoint: name, queued, max });
  }
  return problems;
}

function diagnoseAccount(snapshot: Snapshot): Problem[] {
  const problems: Problem[] = [];
  const { totalMax, cap } = capacity(snapshot);
  if (cap !== null && totalMax > cap) problems.push({ kind: 'over-cap', totalMax, cap });
  if (snapshot.account.ok) {
    const { spendLimitPerHour: limit, currentSpendPerHour: current } = snapshot.account.value;
    if (limit !== null && current !== null && current >= limit * SPEND_WARNING_RATIO) {
      problems.push({ kind: 'spend-near-limit', current, limit });
    }
  }
  return problems;
}

export function diagnose(snapshot: Snapshot): Problem[] {
  return [...snapshot.endpoints.flatMap((status) => diagnoseEndpoint(status)), ...diagnoseAccount(snapshot)];
}

export function planMaxChange(snapshot: Snapshot, endpoint: Endpoint, to: number): MaxChangePlan {
  const { totalMax, cap } = capacity(snapshot);
  const from = endpoint.workers.max;
  const totalAfter = totalMax - from + to;
  const overCapBy = cap !== null && to > from ? Math.max(0, totalAfter - cap) : 0;
  return { endpoint, from, to, totalBefore: totalMax, totalAfter, cap, overCapBy };
}

export function findEndpoint({ endpoints }: Snapshot, ref: string): Endpoint {
  const query = ref.trim().toLowerCase();
  const all = endpoints.map(({ endpoint }) => endpoint);
  const match = all.find(({ id, name }) => id.toLowerCase() === query || name.toLowerCase() === query);
  if (match) return match;

  const names = all.map(({ name }) => name);
  const similar = names.filter((name) => name.toLowerCase().includes(query));
  const hint = similar.length > 0 ? `Did you mean: ${similar.join(', ')}` : `Endpoints: ${names.join(', ')}`;
  throw new Error(`No endpoint named or with id "${ref}". ${hint}`);
}
