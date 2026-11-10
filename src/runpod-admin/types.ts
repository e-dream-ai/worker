import type { components } from '@runpod/typescript-api-sdk';
import type { Result } from './result.js';

export type Endpoint = components['schemas']['Endpoint'];

export type GpuType = components['schemas']['GpuType'];

export type AvailabilityLevel = components['schemas']['AvailabilityLevel'];

export interface WorkerCounts {
  readonly running: number;
  readonly idle: number;
  readonly initializing: number;
  readonly throttled: number;
  readonly unhealthy: number;
}

export interface EndpointHealth {
  readonly workers: WorkerCounts;
  readonly queued: number;
}

export interface AccountLimits {
  readonly workerCap: number | null;
  readonly spendLimitPerHour: number | null;
  readonly currentSpendPerHour: number | null;
}

export interface EndpointStatus {
  readonly endpoint: Endpoint;
  readonly health: Result<EndpointHealth>;
  readonly availability: AvailabilityLevel | null;
}

export interface Snapshot {
  readonly endpoints: readonly EndpointStatus[];
  readonly account: Result<AccountLimits>;
  readonly gpuStock: Result<readonly GpuType[]>;
  readonly fetchedAt: Date;
}
