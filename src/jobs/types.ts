import { z } from 'zod';

/**
 * Job payload schemas - from tech.md section 8.2
 */

export const orderPaymentReminderPayloadSchema = z.object({
  orderId: z.string().min(1),
});

export const orderExpirePayloadSchema = z.object({
  orderId: z.string().min(1),
});

export const customerPickupReminderPayloadSchema = z.object({
  orderId: z.string().min(1),
});

export const ownerDailyDigestPayloadSchema = z.object({
  tenantId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const backupDbPayloadSchema = z.object({});

export type OrderPaymentReminderPayload = z.infer<typeof orderPaymentReminderPayloadSchema>;

export function validateJobPayload(type: JobType, payload: unknown): boolean {
  switch (type) {
    case 'order.payment_reminder':
      return orderPaymentReminderPayloadSchema.safeParse(payload).success;
    case 'order.expire':
      return orderExpirePayloadSchema.safeParse(payload).success;
    case 'customer.pickup_reminder':
      return customerPickupReminderPayloadSchema.safeParse(payload).success;
    case 'owner.daily_digest':
      return ownerDailyDigestPayloadSchema.safeParse(payload).success;
    case 'backup.db':
      return backupDbPayloadSchema.safeParse(payload).success;
  }
}
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
