import { loadConfig } from './config.js';

function main() {
  const config = loadConfig();
  console.log('Configuration loaded successfully');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Log level: ${config.logLevel}`);
  console.log(`Database path: ${config.databasePath}`);
  console.log('Bot is starting...');
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
