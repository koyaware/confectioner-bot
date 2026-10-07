import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, getDb, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { JobScheduler } from '../src/jobs/scheduler.js';
import { createJob } from '../src/jobs/create.js';
import { jobs } from '../src/db/schema.js';
import { JobResult } from '../src/jobs/types.js';
import { eq } from 'drizzle-orm';

describe('job scheduler', () => {
  const testDbPath = './test-jobs.db';
  let scheduler: JobScheduler;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal');
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm');
    }

    process.env.APP_SECRET = 'a'.repeat(32);
    initDatabase(testDbPath);
    migrate();

    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.stop();
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal');
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm');
    }
    delete process.env.APP_SECRET;
  });

  describe('createJob', () => {
    it('creates a new job', async () => {
      const result = await createJob({
        type: 'order.payment_reminder',
        tenantId: 'tenant-1',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() + 60_000),
        dedupeKey: 'test:1',
      });

      expect(result.created).toBe(true);
      expect(result.id).toBeTruthy();

      const db = getDb();
      const allJobs = await db.select().from(jobs);
      expect(allJobs.length).toBe(1);
      expect(allJobs[0]?.type).toBe('order.payment_reminder');
    });

    it('is idempotent by dedupeKey', async () => {
      const result1 = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() + 60_000),
        dedupeKey: 'test:1',
      });

      const result2 = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() + 120_000),
        dedupeKey: 'test:1',
      });

      expect(result1.created).toBe(true);
      expect(result2.created).toBe(false);
      expect(result2.id).toBe(result1.id);

      const db = getDb();
      const allJobs = await db.select().from(jobs);
      expect(allJobs.length).toBe(1);
    });

    it('rejects invalid payload before insert', async () => {
      await expect(
        createJob({
          type: 'order.payment_reminder',
          payload: {},
          runAt: new Date(Date.now() + 60_000),
          dedupeKey: 'test:bad',
        })
      ).rejects.toThrow('Invalid payload');

      const db = getDb();
      expect(await db.select().from(jobs)).toHaveLength(0);
    });
  });

  describe('scheduler', () => {
    it('executes due jobs', async () => {
      const executed: string[] = [];

      scheduler.registerHandler('order.payment_reminder', async (payload: unknown) => {
        const p = payload as { orderId: string };
        executed.push(p.orderId);
        return { success: true };
      });

      // Create a job that's due now
      await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      scheduler.start();

      // Wait for job to execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(executed).toContain('order-1');

      // Check job is marked as done
      const db = getDb();
      const allJobs = await db.select().from(jobs);
      expect(allJobs[0]?.status).toBe('done');
    });

    it('does not execute future jobs', async () => {
      const executed: string[] = [];

      scheduler.registerHandler('order.payment_reminder', async (payload: unknown) => {
        const p = payload as { orderId: string };
        executed.push(p.orderId);
        return { success: true };
      });

      // Create a job that's due in the future
      await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() + 60_000),
        dedupeKey: 'test:1',
      });

      scheduler.start();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(executed).toHaveLength(0);

      // Check job is still pending
      const db = getDb();
      const allJobs = await db.select().from(jobs);
      expect(allJobs[0]?.status).toBe('pending');
    });

    it('retries failed jobs', async () => {
      const attempts: number[] = [];

      scheduler.registerHandler('order.payment_reminder', async () => {
        attempts.push(1);
        return { success: false, error: 'Simulated failure' };
      });

      // Create a job
      const { id } = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      scheduler.start();

      // Wait for first attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(attempts.length).toBe(1);

      // Check job is scheduled for retry
      const db = getDb();
      const job = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      expect(job[0]?.status).toBe('pending');
      expect(job[0]?.attempts).toBe(1);
      expect(job[0]?.lastError).toBe('Simulated failure');
    });

    it('schedules the third retry after the third failure', async () => {
      scheduler.registerHandler('order.payment_reminder', async () => {
        return { success: false, error: 'Simulated failure' };
      });

      const db = getDb();

      // Create a job with 2 attempts already
      const { id } = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      // Manually set attempts to 2
      await db.update(jobs).set({ attempts: 2 }).where(eq(jobs.id, id));

      const before = Date.now();
      scheduler.start();

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Third failure schedules the 1800s retry, job stays pending
      const job = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      expect(job[0]?.status).toBe('pending');
      expect(job[0]?.attempts).toBe(3);
      const delayMs = (job[0]?.runAt as Date).getTime() - before;
      expect(delayMs).toBeGreaterThan(1700_000);
    });

    it('marks job as failed after the fourth failure', async () => {
      scheduler.registerHandler('order.payment_reminder', async () => {
        return { success: false, error: 'Simulated failure' };
      });

      const db = getDb();

      // Create a job with 3 attempts already
      const { id } = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      // Manually set attempts to 3
      await db.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, id));

      scheduler.start();

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check job is marked as failed
      const job = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      expect(job[0]?.status).toBe('failed');
      expect(job[0]?.attempts).toBe(4);
    });

    it('handles handler exceptions', async () => {
      scheduler.registerHandler('order.payment_reminder', async () => {
        throw new Error('Handler crashed');
      });

      const { id } = await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      scheduler.start();

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check job is scheduled for retry
      const db = getDb();
      const job = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      expect(job[0]?.status).toBe('pending');
      expect(job[0]?.attempts).toBe(1);
      expect(job[0]?.lastError).toContain('Handler crashed');
    });

    it('is idempotent - running same job twice has same effect', async () => {
      let executionCount = 0;

      scheduler.registerHandler('order.payment_reminder', async () => {
        executionCount++;
        return { success: true };
      });

      // Create job
      await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(executionCount).toBe(1);

      // Try to create the same job again (should be deduplicated)
      await createJob({
        type: 'order.payment_reminder',
        payload: { orderId: 'order-1' },
        runAt: new Date(Date.now() - 1000),
        dedupeKey: 'test:1',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be 1 because dedupeKey prevents duplicate
      expect(executionCount).toBe(1);
    });
  });
});
