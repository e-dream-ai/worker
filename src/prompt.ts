import { program } from 'commander';
import { CLIService } from './services/cli.service.js';

const cliService = new CLIService();

program.name('prompt').description('CLI to queue runpod jobs');

program
  .command('deforum')
  .description('Queue a deforum video job')
  .argument('<file>', 'Path to JSON file containing deforum settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    await cliService.processJobFile('deforumvideo', file, options);
  });

program
  .command('hunyuan')
  .description('Queue a hunyuan video job')
  .argument('<file>', 'Path to JSON file containing hunyuan settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    await cliService.processJobFile('hunyuanvideo', file, options);
  });

program
  .command('animatediff')
  .description('Queue an animatediff video job')
  .argument('<file>', 'Path to JSON file containing animatediff settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    await cliService.processJobFile('video', file, options);
  });

program
  .command('uprez')
  .description('Queue an uprez video job')
  .argument('<file>', 'Path to JSON file containing uprez settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    await cliService.processJobFile('uprezvideo', file, options);
  });

program.parse();
