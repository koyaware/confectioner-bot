import { loadConfig } from './config.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { migrate } from './db/migrate.js';

function main() {
  const config = loadConfig();
  console.log('Configuration loaded successfully');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Log level: ${config.logLevel}`);
  console.log(`Database path: ${config.databasePath}`);

  // Initialize database
  initDatabase(config.databasePath);
  console.log('Database initialized in WAL mode');

  // Apply migrations
  migrate();
  console.log('Migrations applied');

  console.log('Bot is starting...');

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
