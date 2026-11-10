import { confirm, number, search, select } from '@inquirer/prompts';
import type { RunpodAdminClient } from './client.js';
import { renderPlan, renderReport, type RenderOptions } from './render.js';
import { capacity, planMaxChange } from './report.js';
import { errorMessage } from './result.js';
import { loadSnapshot } from './snapshot.js';
import type { EndpointStatus, Snapshot } from './types.js';

type MenuAction = 'change' | 'refresh' | 'quit';

export async function runMenu(runpod: RunpodAdminClient, options: RenderOptions): Promise<void> {
  let snapshot = await loadAndPrint(runpod, options);
  for (;;) {
    const action = await chooseAction(snapshot);
    if (action === 'quit') return;
    const changed = action === 'change' && snapshot !== null && (await changeMaxWorkers(runpod, snapshot, options));
    if (action === 'refresh' || changed) snapshot = await loadAndPrint(runpod, options);
  }
}

async function loadAndPrint(runpod: RunpodAdminClient, options: RenderOptions): Promise<Snapshot | null> {
  console.log('Loading RunPod endpoints...');
  try {
    const snapshot = await loadSnapshot(runpod);
    console.log(`\n${renderReport(snapshot, options)}\n`);
    return snapshot;
  } catch (error) {
    console.log(`Could not load endpoints: ${errorMessage(error)}`);
    return null;
  }
}

function chooseAction(snapshot: Snapshot | null): Promise<MenuAction> {
  const hasEndpoints = snapshot !== null && snapshot.endpoints.length > 0;
  return select<MenuAction>({
    message: 'What do you want to do?',
    choices: [
      { name: 'Change max workers on an endpoint', value: 'change', disabled: !hasEndpoints && 'no endpoints loaded' },
      { name: 'Refresh', value: 'refresh' },
      { name: 'Quit', value: 'quit' },
    ],
  });
}

function endpointLabel({ endpoint, health }: EndpointStatus, width: number): string {
  const queued = health.ok ? health.value.queued : 0;
  const queue = queued > 0 ? ` · ${queued} queued` : '';
  return `${endpoint.name.padEnd(width)}  max ${endpoint.workers.max}${queue}`;
}

function pickEndpoint({ endpoints }: Snapshot): Promise<EndpointStatus | null> {
  const width = Math.max(...endpoints.map(({ endpoint }) => endpoint.name.length));
  return search<EndpointStatus | null>({
    message: 'Which endpoint? Type to filter',
    source: (term) => {
      const query = (term ?? '').trim().toLowerCase();
      const choices = endpoints
        .filter(({ endpoint }) => `${endpoint.name} ${endpoint.id}`.toLowerCase().includes(query))
        .map((status) => ({ name: endpointLabel(status, width), value: status, description: status.endpoint.id }));
      return query ? choices : [...choices, { name: 'Back', value: null }];
    },
  });
}

function freeHint(snapshot: Snapshot): string {
  const { free } = capacity(snapshot);
  if (free === null) return '';
  return free >= 0 ? `, ${free} free in account` : `, account is ${-free} over its cap`;
}

async function changeMaxWorkers(
  runpod: RunpodAdminClient,
  snapshot: Snapshot,
  options: RenderOptions
): Promise<boolean> {
  const status = await pickEndpoint(snapshot);
  if (status === null) return false;
  const { endpoint } = status;
  const { min, max: currentMax } = endpoint.workers;

  const max = await number({
    message: `New max workers for ${endpoint.name} (now ${currentMax}${freeHint(snapshot)})`,
    default: currentMax,
    required: true,
    validate: (value) => value >= min || `Max workers can't be lower than min workers (${min})`,
  });
  if (max === currentMax) {
    console.log('No change.');
    return false;
  }

  console.log(renderPlan(planMaxChange(snapshot, endpoint, max), options));
  if (!(await confirm({ message: 'Apply this change?', default: false }))) {
    console.log('Cancelled, nothing changed.');
    return false;
  }

  try {
    const updated = await runpod.setMaxWorkers(endpoint.id, max);
    console.log(`Updated ${updated.name}: max workers is now ${updated.workers.max}.`);
    return true;
  } catch (error) {
    console.log(`Update failed: ${errorMessage(error)}`);
    return false;
  }
}
