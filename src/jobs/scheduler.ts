import { getDb } from '../db/client.js';
import { jobs } from '../db/schema.js';
import { eq, and, lte } from 'drizzle-orm';
import { JobHandler, JobResult, Job } from './types.js';
import { ensureDailyDigestJobs } from '../services/digest.js';

const RETRY_DELAYS = [60_000, 300_000, 1_800_000]; // 60s, 300s, 1800s in milliseconds
const POLL_INTERVAL = 10_000; // 10 seconds

/**
 * Job scheduler - polls database for pending jobs and executes them
 */
export class JobScheduler {
  private handlers: Map<string, JobHandler> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Register a job handler
   */
  registerHandler<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('Job scheduler already running');
      return;
    }

    this.isRunning = true;
    console.log('Job scheduler started');

    // Run immediately
    void this.poll();

    // Then poll every POLL_INTERVAL
    this.intervalId = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('Job scheduler stopped');
  }

  /**
   * Poll for pending jobs and execute them
   */
  private async poll(): Promise<void> {
    const db = getDb();
    const now = new Date();

    try {
      await ensureDailyDigestJobs(now);

      // Find pending jobs that are due
      const pendingJobs = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
        .limit(10);

      for (const job of pendingJobs) {
        await this.executeJob(job as Job);
      }
    } catch (error) {
      console.error('Error polling jobs:', error);
    }
  }

  /**
   * Execute a single job
   */
  private async executeJob(job: Job): Promise<void> {
    const db = getDb();
    const handler = this.handlers.get(job.type);

    if (!handler) {
      console.error(`No handler registered for job type: ${job.type}`);
      await db
        .update(jobs)
        .set({
          status: 'failed',
          lastError: `No handler registered for type: ${job.type}`,
        })
        .where(eq(jobs.id, job.id));
      return;
    }

    try {
      // Execute handler
      const result: JobResult = await handler(job.payload, job.id);

      if (result.success) {
        // Mark as done
        await db
          .update(jobs)
          .set({
            status: 'done',
            attempts: job.attempts + 1,
          })
          .where(eq(jobs.id, job.id));
        console.log(`Job ${job.id} (${job.type}) completed successfully`);
      } else {
        // Handler returned failure
        await this.handleJobFailure(job, result.error);
      }
    } catch (error) {
      // Handler threw exception
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleJobFailure(job, errorMessage);
    }
  }

  /**
   * Handle job failure - retry or mark as failed
   */
  private async handleJobFailure(job: Job, errorMessage: string): Promise<void> {
    const db = getDb();
    const nextAttempt = job.attempts + 1;

    if (nextAttempt < RETRY_DELAYS.length) {
      // Schedule retry
      const delay = RETRY_DELAYS[nextAttempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]!;
      const nextRunAt = new Date(Date.now() + delay);

      await db
        .update(jobs)
        .set({
          attempts: nextAttempt,
          runAt: nextRunAt,
          lastError: errorMessage,
        })
        .where(eq(jobs.id, job.id));

      console.log(
        `Job ${job.id} (${job.type}) failed (attempt ${nextAttempt}), retrying at ${nextRunAt.toISOString()}`
      );
    } else {
      // All retries exhausted, mark as failed
      await db
        .update(jobs)
        .set({
          status: 'failed',
          attempts: nextAttempt,
          lastError: errorMessage,
        })
        .where(eq(jobs.id, job.id));

      console.error(
        `Job ${job.id} (${job.type}) failed after ${nextAttempt} attempts: ${errorMessage}`
      );

      // TODO: Notify superadmin of failed job
    }
  }

  /**
   * Get scheduler status
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
