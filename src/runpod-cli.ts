import { Command } from 'commander';
import env from './shared/env.js';
import { RunpodAdminClient } from './runpod-admin/client.js';
import { runMenu } from './runpod-admin/menu.js';
import { renderReport } from './runpod-admin/render.js';
import { errorMessage } from './runpod-admin/result.js';
import { loadSnapshot } from './runpod-admin/snapshot.js';

interface CliOptions {
  readonly once: boolean;
}

const program = new Command()
  .name('runpod')
  .description('Show RunPod serverless endpoints, their worker limits and why jobs are waiting, and change max workers')
  .option('--once', 'print the status and exit without opening the menu', false)
  .parse();

const isPromptExit = (error: unknown): boolean => error instanceof Error && error.name === 'ExitPromptError';

async function main({ once }: CliOptions): Promise<void> {
  const runpod = new RunpodAdminClient(env.RUNPOD_API_KEY);
  const color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
  const interactive = !once && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

  if (interactive) {
    await runMenu(runpod, { color });
  } else {
    console.log(renderReport(await loadSnapshot(runpod), { color }));
  }
}

try {
  await main(program.opts<CliOptions>());
} catch (error) {
  if (!isPromptExit(error)) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
