import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

const { startStandaloneServer, stopStandalone } = await import('../src/standalone.js');

describe('startStandaloneServer', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-standalone-'));
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('starts a server bound to an auto-assigned port and answers /api/health', async () => {
    const handle = await startStandaloneServer({
      distRoot: path.join(__dirname, '..', '..', 'dist'),
      port: 0,
      namespace: 'electron',
    });
    try {
      expect(handle.config.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${handle.config.port}/api/health`);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    } finally {
      stopStandalone(handle);
    }
  });
});
