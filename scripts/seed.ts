import { loadConfig } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';

const config = loadConfig();
initDatabase(config.databasePath);
migrate();

const result = await seedDemo(config.appSecret, new Date());
if (result.created) {
  console.log(`Demo shop created (tenant ${result.tenantId}).`);
} else {
  console.log('Demo shop already exists, nothing to do.');
}

closeDatabase();
