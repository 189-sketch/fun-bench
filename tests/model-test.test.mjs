import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createServer } from 'node:http';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';

const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));

test('model connection test: saved and draft configurations, key fallback and readable failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fun-bench-model-test-'));
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ path: req.url, body: parsed, headers: req.headers });
    if (parsed.model === 'missing-model') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model not found: secret' } }));
      return;
    }
    if (parsed.model === 'unauthorized') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `secret: ${req.headers.authorization}` }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({ choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] }),
    );
  });
  const upstreamUrl = await listen(upstream);
  let store = createStore(directory);
  let server = createServer(createApp(store));
  let base = await listen(server);
  let ownerCookie = '',
    guestCookie = '';
  async function request(path, body, guest = false, method) {
    const res = await fetch(`${base}/api${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', Cookie: guest ? guestCookie : ownerCookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    if (cookie) {
      if (guest) guestCookie = cookie;
      else ownerCookie = cookie;
    }
    return { status: res.status, data: await res.json() };
  }
  try {
    const created = await request('/models', {
      name: '测试选手',
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'mock-openai',
      key: 'private-key',
    });
    assert.equal(created.status, 201);
    const id = created.data.id;

    // The saved configuration is tested through the real protocol path.
    const tested = await request(`/models/${id}/test`, {});
    assert.equal(tested.status, 200);
    assert.equal(tested.data.ok, true);
    assert.match(tested.data.reply, /连接正常/);
    assert.ok(tested.data.latency >= 0);
    assert.ok(requests.at(-1).path.endsWith('/v1/chat/completions'));
    assert.equal(requests.at(-1).headers.authorization, 'Bearer private-key');

    // A draft in the form is tested with the key currently typed.
    const draft = await request('/models/test', {
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'draft-model',
      key: 'draft-key',
      maxTokens: 512,
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.data.ok, true);
    assert.equal(requests.at(-1).headers.authorization, 'Bearer draft-key');
    assert.equal(requests.at(-1).body.max_tokens, 512);

    // Without a key and without a saved model there is nothing to test with.
    const missing = await request('/models/test', {
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'draft-model',
    });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /API Key/);

    // Leaving the key empty in the editor reuses the stored key.
    const reused = await request('/models/test', {
      id,
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'draft-model',
    });
    assert.equal(reused.status, 200);
    assert.equal(requests.at(-1).headers.authorization, 'Bearer private-key');

    // Upstream failures stay readable and never leak the upstream body.
    const denied = await request('/models/test', {
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'unauthorized',
      key: 'private-key',
    });
    assert.equal(denied.status, 502);
    assert.equal(denied.data.ok, false);
    assert.match(denied.data.error, /HTTP 401/);
    assert.doesNotMatch(denied.data.error, /secret|private-key/);
    const absent = await request('/models/test', {
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'missing-model',
      key: 'private-key',
    });
    assert.equal(absent.status, 502);
    assert.match(absent.data.error, /HTTP 404/);
    assert.doesNotMatch(absent.data.error, /secret/);

    // Another workspace cannot test a configuration it does not own.
    assert.equal((await request(`/models/${id}/test`, {}, true)).status, 404);
    assert.equal(
      (await request('/models/test', { protocol: 'openai', baseUrl: 'not-a-url', model: 'x' }))
        .status,
      400,
    );
  } finally {
    await close(server);
    await close(upstream);
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('fun-bench-model-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
