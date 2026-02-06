import 'dotenv/config';
import { startMarketingEmailWorker } from './workers/marketing-email.worker.js';

startMarketingEmailWorker();
