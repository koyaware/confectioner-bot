import { z } from 'zod';

const configSchema = z.object({
  appSecret: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  superadminTelegramId: z.coerce.number().int().positive(),
  adminTelegramIds: z.string().optional().default(''),
  databasePath: z.string().min(1),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = {
    appSecret: process.env.APP_SECRET,
    superadminTelegramId: process.env.SUPERADMIN_TELEGRAM_ID,
    adminTelegramIds: process.env.ADMIN_TELEGRAM_IDS,
    databasePath: process.env.DATABASE_PATH || './data.db',
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}
