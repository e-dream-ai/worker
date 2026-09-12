import type { Job } from 'bullmq';

export interface JobRunContext {
  run_id: string;
  run_started_at: number;
  user_id?: number | string;
}

export function getJobRunContext(job: Job<Partial<JobRunContext>>): JobRunContext {
  const { run_id, run_started_at, user_id } = job.data;

  return {
    run_id: run_id ?? `${job.queueName}:${job.id}`,
    run_started_at: run_started_at ?? job.timestamp,
    user_id,
  };
}
