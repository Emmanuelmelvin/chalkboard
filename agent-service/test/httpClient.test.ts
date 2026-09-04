import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  brainClient,
  backendClient,
  createAgentHttpClient,
  _resetHttpClientsForTests,
} from '../src/http/httpClient.js';
import { AgentError } from '../src/utils/errors.js';
import { config } from '../src/config.js';

describe('Centralized HTTP client', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastHeaders: Record<string, string | string[] | undefined> = {};
  let mode: 'ok' | 'error-status' | 'slow' = 'ok';

  before(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          lastHeaders = { ...req.headers };
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (mode === 'error-status') {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false }));
              return;
            }
            if (mode === 'slow') {
              setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
              }, 500);
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
          });
        });
        server.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          resolve();
        });
      })
  );

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('singletons exist and reset works', () => {
    assert.ok(brainClient());
    assert.ok(backendClient());
    _resetHttpClientsForTests();
    assert.ok(brainClient());
    assert.ok(backendClient());
  });

  it('sends x-agent-secret header from config on every request', async () => {
    mode = 'ok';
    const client = createAgentHttpClient(baseUrl, 'probe', 5000);
    await client.post('/tools/execute', { tool: 'x' });
    assert.equal(lastHeaders['x-agent-secret'], config.AGENT_SECRET);
    assert.match(String(lastHeaders['content-type'] || ''), /application\/json/);
  });

  it('maps timeouts to AgentError http_timeout', async () => {
    mode = 'slow';
    const client = createAgentHttpClient(baseUrl, 'probe', 50);
    await assert.rejects(client.get('/x'), (err: any) => {
      assert.ok(err instanceof AgentError);
      assert.equal(err.code, 'http_timeout');
      return true;
    });
    mode = 'ok';
  });

  it('resolves HTTP error statuses instead of throwing (callers branch on status)', async () => {
    mode = 'error-status';
    const client = createAgentHttpClient(baseUrl, 'probe', 5000);
    const res = await client.post('/tools/execute', { tool: 'x' });
    assert.equal(res.status, 403);
    assert.equal(res.data.ok, false);
    mode = 'ok';
  });

  it('round-trips JSON bodies', async () => {
    mode = 'ok';
    const client = createAgentHttpClient(baseUrl, 'probe', 5000);
    const res = await client.post('/run', { roomId: 'r1', n: 2 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.echo, { roomId: 'r1', n: 2 });
  });

  it('maps connection-refused to AgentError http_unreachable', async () => {
    const client = createAgentHttpClient('http://127.0.0.1:1', 'probe', 2000);
    await assert.rejects(client.get('/x'), (err: any) => {
      assert.ok(err instanceof AgentError);
      assert.equal(err.code, 'http_unreachable');
      return true;
    });
  });
});
