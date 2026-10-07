import { loadConfig } from './config.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { migrate } from './db/migrate.js';
import { BotRunner } from './bot/runner.js';
import { JobScheduler } from './jobs/scheduler.js';
import {
  createPaymentReminderHandler,
  createPaymentExpireHandler,
} from './jobs/handlers/order-payment.js';
import { createPickupReminderHandler } from './jobs/handlers/pickup-reminder.js';

async function main() {
  const config = loadConfig();
  console.log('Configuration loaded successfully');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Log level: ${config.logLevel}`);
  console.log(`Database path: ${config.databasePath}`);

  initDatabase(config.databasePath);
  console.log('Database initialized in WAL mode');

  migrate();
  console.log('Migrations applied');

  const runner = new BotRunner();
  const scheduler = new JobScheduler();
  const ports = { getPort: (tenantId: string) => runner.getBot(tenantId)?.port };
  scheduler.registerHandler('order.payment_reminder', createPaymentReminderHandler(ports));
  scheduler.registerHandler('order.expire', createPaymentExpireHandler(ports));
  scheduler.registerHandler('customer.pickup_reminder', createPickupReminderHandler(ports));

  const shutdown = async () => {
    console.log('Shutting down...');
    scheduler.stop();
    await runner.stopAll();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await runner.startAll();
  scheduler.start();
  console.log('Bot is running');
}

try {
  void main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
