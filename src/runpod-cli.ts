import { Command, InvalidArgumentError } from '@commander-js/extra-typings';
import env from './shared/env.js';
import { RunpodAdminClient } from './runpod-admin/client.js';
import { renderPlan, renderReport, type RenderOptions } from './runpod-admin/render.js';
import { findEndpoint, planMaxChange } from './runpod-admin/report.js';
import { errorMessage } from './runpod-admin/result.js';
import { loadSnapshot } from './runpod-admin/snapshot.js';

const renderOptions: RenderOptions = {
  color: Boolean(process.stdout.isTTY) && process.stdout.hasColors(),
};

function parseWorkerCount(value: string): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count)) {
    throw new InvalidArgumentError('Expected a whole number of workers.');
  }
  return count;
}

async function printStatus(): Promise<void> {
  const runpod = new RunpodAdminClient(env.RUNPOD_API_KEY);
  console.log(renderReport(await loadSnapshot(runpod), renderOptions));
}

async function changeMaxWorkers(endpointRef: string, max: number, apply: boolean): Promise<void> {
  const runpod = new RunpodAdminClient(env.RUNPOD_API_KEY);
  const snapshot = await loadSnapshot(runpod);
  const endpoint = findEndpoint(snapshot, endpointRef);
  const { min, max: currentMax } = endpoint.workers;

  if (max < min) throw new Error(`Max workers can't be lower than min workers (${min}) on ${endpoint.name}.`);
  if (max === currentMax) {
    console.log(`${endpoint.name} already has max workers ${max}, nothing to change.`);
    return;
  }

  console.log(renderPlan(planMaxChange(snapshot, endpoint, max), renderOptions));
  if (!apply) {
    console.log('Dry run, nothing changed. Run it again with --yes to apply.');
    return;
  }

  const updated = await runpod.setMaxWorkers(endpoint.id, max);
  console.log(`Updated ${updated.name}: max workers is now ${updated.workers.max}.`);
}

const program = new Command()
  .name('runpod')
  .description('Show RunPod serverless endpoints, their worker limits and why jobs are waiting, and change max workers')
  .showHelpAfterError();

program
  .command('status', { isDefault: true })
  .description('print every endpoint with its workers, queue and GPU stock, plus account totals and likely problems')
  .action(printStatus);

program
  .command('set-max')
  .description('change the max workers of an endpoint; shows the change and only applies it with --yes')
  .argument('<endpoint>', 'endpoint name or id')
  .argument('<max>', 'new max workers', parseWorkerCount)
  .option('-y, --yes', 'apply the change instead of only showing it', false)
  .action((endpointRef, max, { yes }) => changeMaxWorkers(endpointRef, max, yes));

try {
  await program.parseAsync();
} catch (error) {
  console.error(`error: ${errorMessage(error)}`);
  process.exitCode = 1;
}
