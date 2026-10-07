import { z } from 'zod';

/**
 * Job payload schemas - from tech.md section 8.2
 */

export const orderPaymentReminderPayloadSchema = z.object({
  orderId: z.string(),
});

export const orderExpirePayloadSchema = z.object({
  orderId: z.string(),
});

export const customerPickupReminderPayloadSchema = z.object({
  orderId: z.string(),
});

export const ownerDailyDigestPayloadSchema = z.object({
  tenantId: z.string(),
  date: z.string(), // IsoDate
});

export const backupDbPayloadSchema = z.object({});

export type OrderPaymentReminderPayload = z.infer<typeof orderPaymentReminderPayloadSchema>;
export type OrderExpirePayload = z.infer<typeof orderExpirePayloadSchema>;
export type CustomerPickupReminderPayload = z.infer<typeof customerPickupReminderPayloadSchema>;
export type OwnerDailyDigestPayload = z.infer<typeof ownerDailyDigestPayloadSchema>;
export type BackupDbPayload = z.infer<typeof backupDbPayloadSchema>;

/**
 * Job types
 */
export type JobType =
  | 'order.payment_reminder'
  | 'order.expire'
  | 'customer.pickup_reminder'
  | 'owner.daily_digest'
  | 'backup.db';

/**
 * Job handler result
 */
export type JobResult = { success: true } | { success: false; error: string };

/**
 * Job handler function
 */
export type JobHandler<T = unknown> = (payload: T, jobId: string) => Promise<JobResult>;

/**
 * Job from database
 */
export interface Job {
  id: string;
  type: JobType;
  tenantId: string | null;
  payload: unknown;
  runAt: Date;
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  dedupeKey: string;
  lastError: string | null;
  createdAt: Date;
}
