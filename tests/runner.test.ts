import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BotRunner } from '../src/bot/runner.js';
import { FakePort } from '../src/telegram/fake-port.js';
import type { TenantBot } from '../src/bot/factory.js';

class TestRunner extends BotRunner {
  restarted: Array<{ id: string; slug: string; token: string }> = [];
  override async startTenant(id: string, slug: string, token: string): Promise<void> {
    this.restarted.push({ id, slug, token });
  }
}

function maps(runner: BotRunner) {
  return runner as unknown as {
    bots: Map<string, TenantBot>;
    handles: Map<string, { stop: () => Promise<void> }>;
    tokens: Map<string, { slug: string; encryptedToken: string }>;
  };
}

describe('runner tenant isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.SUPERADMIN_TELEGRAM_ID = '1';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SUPERADMIN_TELEGRAM_ID;
  });

  function setup() {
    const runner = new TestRunner('secret', 60_000);
    const port = new FakePort();
    const m = maps(runner);
    // A second healthy bot that stays up to deliver superadmin notices.
    m.bots.set('t0', { port, username: 'healthy' } as unknown as TenantBot);
    m.bots.set('t1', { port, username: 'fallen' } as unknown as TenantBot);
    m.handles.set('t1', { stop: async () => {} });
    m.tokens.set('t1', { slug: 'demo', encryptedToken: 'enc' });
    return { runner, port, m };
  }

  function superadminTexts(port: FakePort): string[] {
    return port.getCallsForMethod('sendMessage').map((c) => String(c.args[1]));
  }

  it('401 stops the tenant without restart and notifies', async () => {
    const { runner, port, m } = setup();
    await runner.onTenantDown('t1', { error_code: 401, message: 'Unauthorized' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(m.bots.has('t1')).toBe(false);
    expect(m.handles.has('t1')).toBe(false);
    expect(m.bots.has('t0')).toBe(true);
    expect((runner as TestRunner).restarted).toHaveLength(0);
    expect(superadminTexts(port).some((t) => t.includes('demo') && t.includes('401'))).toBe(true);
  });

  it('409 stops the tenant without restart and notifies', async () => {
    const { runner, port, m } = setup();
    await runner.onTenantDown('t1', { error_code: 409, message: 'Conflict' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(m.bots.has('t1')).toBe(false);
    expect((runner as TestRunner).restarted).toHaveLength(0);
    expect(superadminTexts(port).some((t) => t.includes('demo') && t.includes('409'))).toBe(true);
  });

  it('other errors restart the tenant after a delay', async () => {
    const { runner, port, m } = setup();
    const p = runner.onTenantDown('t1', new Error('socket hang up'));
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    expect(m.bots.has('t1')).toBe(false);
    expect((runner as TestRunner).restarted).toEqual([{ id: 't1', slug: 'demo', token: 'enc' }]);
    expect(superadminTexts(port).some((t) => t.includes('перезапуск'))).toBe(true);
  });

  it('stopTenant during the delay cancels the restart', async () => {
    const { runner, m } = setup();
    const p = runner.onTenantDown('t1', new Error('socket hang up'));
    await runner.stopTenant('t1');
    await vi.advanceTimersByTimeAsync(120_000);
    await p;
    expect((runner as TestRunner).restarted).toHaveLength(0);
  });
});
