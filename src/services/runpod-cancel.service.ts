import { PublicEndpointService } from './public-endpoint.service.js';

export class RunpodCancelService {
  async cancelJob(endpoint: any, runpodId: string): Promise<void> {
    if (!runpodId) {
      console.warn('[RunpodCancelService] No runpod_id provided, skipping cancellation');
      return;
    }

    try {
      if (endpoint instanceof PublicEndpointService) {
        await endpoint.cancel(runpodId);
        console.info(`[RunpodCancelService] Cancelled public endpoint job: ${runpodId}`);
      } else if (endpoint?.cancel && typeof endpoint.cancel === 'function') {
        await endpoint.cancel(runpodId);
        console.info(`[RunpodCancelService] Cancelled SDK endpoint job: ${runpodId}`);
      } else {
        console.warn(`[RunpodCancelService] Endpoint does not support cancellation: ${runpodId}`);
      }
    } catch (error: any) {
      console.error(`[RunpodCancelService] Failed to cancel RunPod job ${runpodId}:`, error.message || error);
    }
  }
}
