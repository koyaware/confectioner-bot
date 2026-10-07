import { getDb } from '../db/client.js';
import { jobs } from '../db/schema.js';
import { JobType, validateJobPayload } from './types.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

export interface CreateJobInput {
  type: JobType;
  tenantId?: string;
  payload: unknown;
  runAt: Date;
  dedupeKey: string;
}

/**
 * Create a new job (idempotent by dedupeKey)
 */
export async function createJob(input: CreateJobInput): Promise<{ id: string; created: boolean }> {
  if (!validateJobPayload(input.type, input.payload)) {
    throw new Error(`Invalid payload for job type ${input.type}`);
  }

  const db = getDb();
  const id = nanoid();
  const now = new Date();

  try {
    // Try to insert
    await db.insert(jobs).values({
      id,
      type: input.type,
      tenantId: input.tenantId || null,
      payload: input.payload,
      runAt: input.runAt,
      status: 'pending',
      attempts: 0,
      dedupeKey: input.dedupeKey,
      lastError: null,
      createdAt: now,
    });

    return { id, created: true };
  } catch (error) {
    // Check if it's a unique constraint violation on dedupeKey
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      // Job already exists, return existing job id
      const existing = await db
        .select()
        .from(jobs)
        .where(eq(jobs.dedupeKey, input.dedupeKey))
        .limit(1);

      if (existing.length > 0) {
        return { id: existing[0]!.id, created: false };
      }
    }

    // Re-throw if it's a different error
    throw error;
  }
}

/**
 * Cancel a job (mark as done so it won't run)
 */
export async function cancelJob(jobId: string): Promise<void> {
  const db = getDb();
  await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, jobId));
}
