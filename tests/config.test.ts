import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid configuration', () => {
    process.env.APP_SECRET = 'a'.repeat(32);
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';
    process.env.DATABASE_PATH = './test.db';
    process.env.LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'development';

    const config = loadConfig();

    expect(config.appSecret).toBe('a'.repeat(32));
    expect(config.superadminTelegramId).toBe(123456789);
    expect(config.databasePath).toBe('./test.db');
    expect(config.logLevel).toBe('debug');
    expect(config.nodeEnv).toBe('development');
  });

  it('applies defaults for optional fields', () => {
    process.env.APP_SECRET = 'a'.repeat(32);
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_PATH;

    const config = loadConfig();

    expect(config.databasePath).toBe('./data.db');
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
  });

  it('rejects APP_SECRET shorter than 32 characters', () => {
    process.env.APP_SECRET = 'short';
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';

    expect(() => loadConfig()).toThrow();
  });

  it('rejects missing APP_SECRET', () => {
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';

    expect(() => loadConfig()).toThrow();
  });

  it('rejects missing SUPERADMIN_TELEGRAM_ID', () => {
    process.env.APP_SECRET = 'a'.repeat(32);

    expect(() => loadConfig()).toThrow();
  });

  it('rejects invalid log level', () => {
    process.env.APP_SECRET = 'a'.repeat(32);
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';
    process.env.LOG_LEVEL = 'invalid';

    expect(() => loadConfig()).toThrow();
  });

  it('rejects invalid node environment', () => {
    process.env.APP_SECRET = 'a'.repeat(32);
    process.env.SUPERADMIN_TELEGRAM_ID = '123456789';
    process.env.NODE_ENV = 'invalid';

    expect(() => loadConfig()).toThrow();
  });

  it('coerces SUPERADMIN_TELEGRAM_ID to number', () => {
    process.env.APP_SECRET = 'a'.repeat(32);
    process.env.SUPERADMIN_TELEGRAM_ID = '987654321';

    const config = loadConfig();

    expect(config.superadminTelegramId).toBe(987654321);
    expect(typeof config.superadminTelegramId).toBe('number');
  });
});
