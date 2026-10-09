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

test('end-to-end API: encrypted credentials, parallel protocols, independent blind votes, reveal lock, persistence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fun-bench-api-'));
  let active = 0,
    maxActive = 0;
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ path: req.url, body: parsed, headers: req.headers });
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 130));
    active--;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url.endsWith('/messages')
          ? { content: [{ type: 'text', text: '这是一个匿名成果。' }], stop_reason: 'end_turn' }
          : { choices: [{ message: { content: '这是另一个匿名成果。' }, finish_reason: 'stop' }] },
      ),
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
    const first = await request('/models', {
      name: '隐藏选手一',
      protocol: 'openai',
      baseUrl: `${upstreamUrl}/v1`,
      model: 'secret-openai-model',
      key: 'private-key-openai',
      maxTokens: 1_000_000,
      tokenParameter: 'max_completion_tokens',
    });
    const second = await request('/models', {
      name: '隐藏选手二',
      protocol: 'anthropic',
      baseUrl: upstreamUrl,
      model: 'secret-anthropic-model',
      key: 'private-key-anthropic',
      maxTokens: 1_000_000,
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.data.maxTokens, 1_000_000);
    assert.equal(second.data.maxTokens, 1_000_000);
    assert.equal(
      (
        await request(
          `/models/${first.data.id}`,
          { ...first.data, maxTokens: 1_000_001 },
          false,
          'PUT',
        )
      ).status,
      400,
    );
    assert.ok(!JSON.stringify(first.data).includes('private-key'));
    assert.ok(!store.get('model', first.data.id).encryptedKey.includes('private-key'));
    assert.equal((await request('/models', undefined, true)).data.length, 0);
    const task = {
      title: '真实任务',
      prompt: '精确的测试提示词，包含原始材料。',
      evaluation: '评判实际帮助',
      format: 'text',
      criteria: [{ name: '帮助程度', description: '是否有帮助', maxScore: 100 }],
    };
    const created = await request('/benches', {
      title: '独立盲评',
      tasks: [task],
      modelIds: [first.data.id, second.data.id],
    });
    const benchId = created.data.id;
    assert.equal(created.status, 201);
    const premature = await request(`/benches/${benchId}/vote`, { scores: {} });
    assert.equal(premature.status, 409);
    let view;
    for (let i = 0; i < 100; i++) {
      view = (await request(`/benches/${benchId}`)).data;
      if (view.status === 'done') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(view.status, 'done');
    assert.equal(view.entries.filter((e) => e.status === 'done').length, 2);
    assert.equal(maxActive, 2, 'both providers execute concurrently');
    assert.equal(requests[0].body.messages[0].content, task.prompt);
    assert.equal(requests[1].body.messages[0].content, task.prompt);
    assert.equal(
      requests.find((r) => r.path.endsWith('/chat/completions')).body.max_completion_tokens,
      1_000_000,
    );
    assert.equal(
      requests.find((r) => r.path.endsWith('/chat/completions')).body.max_tokens,
      undefined,
    );
    assert.equal(
      requests.find((r) => r.path.endsWith('/chat/completions')).headers.authorization,
      'Bearer private-key-openai',
    );
    assert.equal(
      requests.find((r) => r.path.endsWith('/messages')).headers['x-api-key'],
      'private-key-anthropic',
    );
    assert.equal(requests.find((r) => r.path.endsWith('/messages')).body.max_tokens, 1_000_000);
    const anonymous = JSON.stringify(view);
    for (const hidden of [
      'secret-openai',
      'secret-anthropic',
      '隐藏选手',
      'private-key',
      upstreamUrl,
    ])
      assert.ok(!anonymous.includes(hidden));
    assert.deepEqual(
      view.entries.map((e) => e.id),
      view.order[view.tasks[0].id],
    );
    assert.equal((await request(`/benches/${benchId}`, undefined, true)).status, 404);
    const share = await request(`/benches/${benchId}/share`, {});
    const token = share.data.path.split('/').at(-1);
    const guestView = (await request(`/reviews/${token}`, undefined, true)).data;
    assert.equal(guestView.revealed, false);
    assert.equal((await request(`/benches/${benchId}/vote`, { scores: {} })).status, 400);
    const scores = Object.fromEntries(view.entries.map((e) => [e.id, { 0: 80 }]));
    const reveal = await request(`/benches/${benchId}/vote`, { scores, comment: '判断已锁定' });
    assert.equal(reveal.status, 200);
    assert.equal(reveal.data.revealed, true);
    assert.ok(reveal.data.entries.every((e) => e.model));
    assert.equal((await request(`/benches/${benchId}/vote`, { scores })).status, 409);
    assert.equal(
      (await request(`/reviews/${token}`, undefined, true)).data.revealed,
      false,
      'owner reveal does not reveal guest identity',
    );
    const guestScores = Object.fromEntries(guestView.entries.map((e) => [e.id, { 0: 100 }]));
    const guestReveal = await request(`/reviews/${token}/vote`, { scores: guestScores }, true);
    assert.equal(guestReveal.data.voterCount, 2);
    assert.equal(guestReveal.data.results[0].average, 90);
    await close(server);
    store.close();
    store = createStore(directory);
    server = createServer(createApp(store));
    base = await listen(server);
    const restored = (await request(`/benches/${benchId}`)).data;
    assert.equal(restored.revealed, true);
    assert.equal(restored.myBallot.comment, '判断已锁定');
    assert.equal((await request('/models')).data.length, 2);
    const crossOrigin = await fetch(`${base}/api/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await close(server);
    await close(upstream);
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('fun-bench-api-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
