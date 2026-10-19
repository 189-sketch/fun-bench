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
    const scores = Object.fromEntries(view.entries.map((e) => [e.id, 80]));
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
    const guestScores = Object.fromEntries(guestView.entries.map((e) => [e.id, 100]));
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

test('per-task reveal: one question can be revealed on its own, locks its scores and stays private to the reviewer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fun-bench-reveal-'));
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '这是一份匿名成果。' }, finish_reason: 'stop' }],
      }),
    );
  });
  const upstreamUrl = await listen(upstream);
  let store = createStore(directory);
  let server = createServer(createApp(store));
  let base = await listen(server);
  let ownerCookie = '';
  let guestCookie = '';
  async function request(path, body, guest = false) {
    const res = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
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
  // 等到某道题的所有成果落定。
  async function settled(view, taskId) {
    const list = view.entries.filter((e) => e.taskId === taskId);
    return list.length > 0 && list.every((e) => ['done', 'failed'].includes(e.status));
  }
  async function waitFor(taskId) {
    for (let i = 0; i < 200; i++) {
      const view = (await request(`/benches/${benchId}`)).data;
      if (await settled(view, taskId)) return view;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('生成未在预期时间内结束');
  }
  let benchId = '';
  try {
    const modelIds = [];
    for (const name of ['隐藏选手一', '隐藏选手二']) {
      const created = await request('/models', {
        name,
        protocol: 'openai',
        baseUrl: `${upstreamUrl}/v1`,
        model: 'mock-openai',
        key: 'reveal-secret',
      });
      modelIds.push(created.data.id);
    }
    const task = {
      title: '真实任务',
      prompt: '完成一件真实的事',
      evaluation: '看是否有用',
      format: 'text',
      criteria: [{ name: '帮助程度', maxScore: 100 }],
    };
    const created = await request('/benches', {
      title: '单题揭晓',
      tasks: [task, { ...task, title: '第二题' }],
      modelIds,
    });
    benchId = created.data.id;
    let view = await waitFor((await request(`/benches/${benchId}`)).data.tasks[0].id);
    const first = view.tasks[0];
    const firstEntries = view.entries.filter((e) => e.taskId === first.id);
    assert.equal(firstEntries.length, 2);
    assert.ok(firstEntries.every((e) => e.status === 'done'));
    // 揭晓前必须先给本题打分
    assert.equal(
      (await request(`/benches/${benchId}/reveal`, { taskId: first.id, scores: {} })).status,
      400,
    );
    // 别的评测的题目 id 无效
    assert.equal(
      (await request(`/benches/${benchId}/reveal`, { taskId: 'foreign-task', scores: { a: 50 } }))
        .status,
      400,
    );
    // 还没开始的题目不能揭晓
    assert.equal(
      (await request(`/benches/${benchId}/reveal`, { taskId: view.tasks[1].id, scores: {} }))
        .status,
      409,
    );
    const scores = Object.fromEntries(firstEntries.map((e) => [e.id, 60]));
    const revealed = await request(`/benches/${benchId}/reveal`, { taskId: first.id, scores });
    assert.equal(revealed.status, 200);
    assert.equal(revealed.data.revealed, false, '单题揭晓不等于全场揭晓');
    assert.deepEqual(revealed.data.revealedTasks, [first.id]);
    const revealedEntries = revealed.data.entries.filter((e) => e.taskId === first.id);
    assert.ok(revealedEntries.every((e) => e.model?.name));
    assert.ok(
      revealedEntries.every((e) => !('baseUrl' in e.model)),
      '揭晓后不下发 Base URL',
    );
    assert.ok(!JSON.stringify(revealed.data).includes(upstreamUrl));
    assert.deepEqual(revealed.data.lockedScores, scores);
    // 重复提交保持幂等
    assert.equal(
      (await request(`/benches/${benchId}/reveal`, { taskId: first.id, scores })).status,
      200,
    );
    // 其他评审者既看不到身份，也看不到别人的揭晓状态
    const share = await request(`/benches/${benchId}/share`, {});
    const token = share.data.path.split('/').at(-1);
    const guestView = (await request(`/reviews/${token}`, undefined, true)).data;
    assert.deepEqual(guestView.revealedTasks, []);
    assert.deepEqual(guestView.lockedScores, {});
    assert.equal(
      guestView.entries.filter((e) => e.taskId === first.id).some((e) => e.model),
      false,
    );
    // 进入第二题并完成
    await request(`/benches/${benchId}/next`, {});
    view = await waitFor(view.tasks[1].id);
    const allEntries = view.entries.filter((e) => e.status === 'done');
    const finalScores = Object.fromEntries(allEntries.map((e) => [e.id, 90]));
    for (const entry of firstEntries) finalScores[entry.id] = 10;
    const vote = await request(`/benches/${benchId}/vote`, { scores: finalScores });
    assert.equal(vote.status, 200);
    for (const entry of firstEntries)
      assert.equal(vote.data.myBallot.scores[entry.id], 60, '已揭晓题目的分数以服务端锁定值为准');
    // 重启后揭晓状态与锁定分数仍在
    await close(server);
    store.close();
    store = createStore(directory);
    server = createServer(createApp(store));
    base = await listen(server);
    const restored = (await request(`/benches/${benchId}`)).data;
    assert.ok(restored.revealedTasks.includes(first.id));
    assert.deepEqual(restored.lockedScores, scores);
  } finally {
    await close(server);
    await close(upstream);
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('fun-bench-reveal-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a dropped contestant can start over on its own, without touching the rest of the bench', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fun-bench-restart-'));
  const attempts = new Map();
  const upstream = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const count = (attempts.get(body.model) || 0) + 1;
    attempts.set(body.model, count);
    res.setHeader('Content-Type', 'application/json');
    // 掉线的选手第一次没有答上来，重新开始之后正常作答。
    if (body.model === 'flaky' && count === 1) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: { message: '临时故障' } }));
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '这是一份匿名成果。' }, finish_reason: 'stop' }],
      }),
    );
  });
  const upstreamUrl = await listen(upstream);
  let store = createStore(directory);
  let server = createServer(createApp(store));
  let base = await listen(server);
  let ownerCookie = '';
  let guestCookie = '';
  async function request(path, body, guest = false) {
    const res = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
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
  async function waitFor(predicate, label) {
    for (let i = 0; i < 200; i++) {
      const view = (await request(`/benches/${benchId}`)).data;
      if (predicate(view)) return view;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${label}未在预期时间内发生`);
  }
  let benchId = '';
  try {
    const modelIds = [];
    for (const name of ['flaky', 'steady']) {
      const created = await request('/models', {
        name,
        protocol: 'openai',
        baseUrl: `${upstreamUrl}/v1`,
        model: name,
        key: 'restart-secret',
      });
      modelIds.push(created.data.id);
    }
    const task = {
      title: '真实任务',
      prompt: '完成一件真实的事',
      evaluation: '看是否有用',
      format: 'text',
      criteria: [{ name: '帮助程度', maxScore: 100 }],
    };
    const created = await request('/benches', {
      title: '掉线重启',
      tasks: [task, { ...task, title: '第二题' }],
      modelIds,
    });
    benchId = created.data.id;
    // 第一题里掉线的选手保持 failed，其它选手正常完成。
    const view = await waitFor(
      (v) =>
        v.entries
          .filter((e) => e.taskId === v.tasks[0].id)
          .every((e) => ['done', 'failed'].includes(e.status)),
      '第一题作答',
    );
    const first = view.tasks[0];
    const dropped = view.entries.find((e) => e.taskId === first.id && e.status === 'failed');
    const healthy = view.entries.find((e) => e.taskId === first.id && e.status === 'done');
    assert.ok(dropped, '掉线的成果应当保持 failed');
    assert.equal(dropped.attempts, 1);
    assert.ok(healthy);
    // 访客不能替创建者重新开始：重新生成用的是创建者的 Key。
    const share = await request(`/benches/${benchId}/share`, {});
    const token = share.data.path.split('/').at(-1);
    const guestView = (await request(`/reviews/${token}`, undefined, true)).data;
    assert.ok(
      guestView.entries.some((e) => e.id === dropped.id && e.status === 'failed'),
      '访客看到同样的掉线状态',
    );
    assert.equal(
      (await request(`/benches/${benchId}/entries/${dropped.id}/retry`, {}, true)).status,
      404,
    );
    // 已经在作答的成果不能重新开始。
    assert.equal(
      (await request(`/benches/${benchId}/entries/${healthy.id}/retry`, {})).status,
      409,
    );
    // 重新开始：只重跑这一份成果。
    const restarted = await request(`/benches/${benchId}/entries/${dropped.id}/retry`, {});
    assert.equal(restarted.status, 200);
    const restartedEntry = restarted.data.entries.find((e) => e.id === dropped.id);
    assert.equal(restartedEntry.attempts, 2);
    assert.ok(['queued', 'running'].includes(restartedEntry.status));
    assert.equal(restartedEntry.error, undefined, '上一次的错误应当被清掉');
    assert.equal(healthy.status, 'done');
    // 重新作答之后，这份成果进入正常流程，可以评分和揭晓。
    const settled = await waitFor(
      (v) => v.entries.find((e) => e.id === dropped.id)?.status === 'done',
      '重新作答',
    );
    const scores = Object.fromEntries(
      settled.entries
        .filter((e) => e.taskId === first.id && e.status === 'done')
        .map((e) => [e.id, 70]),
    );
    const revealed = await request(`/benches/${benchId}/reveal`, { taskId: first.id, scores });
    assert.equal(revealed.status, 200, '掉线的选手重新作答后，这一题可以揭晓');
    assert.deepEqual(revealed.data.revealedTasks, [first.id]);
    // 全部揭晓之后不能再重新开始。
    assert.equal(
      (await request(`/benches/${benchId}/entries/${dropped.id}/retry`, {})).status,
      409,
    );
  } finally {
    await close(server);
    await close(upstream);
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('fun-bench-restart-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
