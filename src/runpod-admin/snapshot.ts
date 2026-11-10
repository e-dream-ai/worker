import type { RunpodAdminClient } from './client.js';
import { endpointAvailability } from './report.js';
import { settle } from './result.js';
import type { EndpointStatus, Snapshot } from './types.js';

export async function loadSnapshot(runpod: RunpodAdminClient): Promise<Snapshot> {
  const [endpoints, gpuStock, account] = await Promise.all([
    runpod.listEndpoints(),
    settle(runpod.listServerlessGpuStock()),
    settle(runpod.getAccountLimits()),
  ]);

  const statuses = await Promise.all(
    endpoints.map(
      async (endpoint): Promise<EndpointStatus> => ({
        endpoint,
        health: await settle(runpod.getHealth(endpoint.id)),
        availability: gpuStock.ok ? endpointAvailability(endpoint, gpuStock.value) : null,
      })
    )
  );

  return {
    endpoints: statuses.sort((a, b) => a.endpoint.name.localeCompare(b.endpoint.name)),
    account,
    gpuStock,
    fetchedAt: new Date(),
  };
}
