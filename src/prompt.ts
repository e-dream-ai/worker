import { program } from 'commander';
import { CLIService } from './services/cli.service.js';

const cliService = new CLIService();

program.name('prompt').description('CLI to queue runpod jobs');

program
  .argument('<file>', 'Path to JSON file containing job settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    await cliService.processJobFileAuto(file, options);
  });

program.parse();

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
