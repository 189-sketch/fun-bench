import express from 'express';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  modelSchema,
  testModelSchema,
  createBenchSchema,
  buildPrompt,
  extractHtml,
  validateScores,
  validateTaskScores,
  normalizeScore,
  totals,
} from './domain.mjs';
import { generate, generationError, testConnection, connectionError } from './providers.mjs';
import { demoTask, demoEntries } from './demo.mjs';

const id = () => randomBytes(18).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('hex');
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const publicModel = ({ encryptedKey: _key, owner: _owner, ...model }) => ({
  ...model,
  hasKey: Boolean(_key),
});
// A revealed identity carries no endpoint or credential material: the base URL
// alone would fingerprint the vendor behind a generic display name.
const publicIdentity = ({ id, name, model, protocol }) => ({ id, name, model, protocol });
const log = (event, data) =>
  console.info(JSON.stringify({ time: new Date().toISOString(), event, ...data }));

export function createApp(store) {
  const app = express();
  const pending = [];
  let active = 0;
  function drain() {
    while (active < 8 && pending.length) {
      const work = pending.shift();
      active++;
      work()
        .catch(() => log('runner.unexpected', {}))
        .finally(() => {
          active--;
          drain();
        });
    }
  }
  function persistBench(bench) {
    store.put('bench', bench, bench.owner);
  }
  // Interrupted requests are not automatically replayed, to avoid unexpected charges.
  // Tasks the user had not started yet stay pending, so the sequential flow can continue.
  for (const bench of store.all('bench')) {
    if (bench.status === 'running') {
      bench.entries.forEach((e) => {
        if (['queued', 'running'].includes(e.status)) {
          e.status = 'failed';
          e.error = '服务重启中断了本次生成，可手动重试';
        }
      });
      if (bench.entries.every((e) => ['done', 'failed'].includes(e.status))) bench.status = 'done';
      persistBench(bench);
    }
  }
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== `${req.protocol}://${req.get('host')}`)
        return res.status(403).json({ error: '请求来源不匹配，请从当前页面重试' });
      if (!req.is('application/json'))
        return res.status(415).json({ error: '请使用 JSON 格式提交' });
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('fb_session='))
      ?.slice(11);
    const token =
      cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : randomBytes(32).toString('base64url');
    if (token !== cookie)
      res.cookie('fb_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        maxAge: 365 * 86400000,
        path: '/',
      });
    req.session = digest(token);
    next();
  });
  function ownModel(req, modelId) {
    const m = store.get('model', modelId);
    return m?.owner === req.session ? m : null;
  }
  function access(req, value, shared) {
    const bench = shared
      ? store.all('bench').find((b) => b.shareToken === value)
      : store.get('bench', value);
    return bench && (shared || bench.owner === req.session) ? bench : null;
  }
  function ballots(bench) {
    return store.all('ballot', bench.id);
  }
  // 每位评审的揭晓互不影响：记录按 bench 存放，读取时再按会话过滤。
  function reveals(bench, session) {
    return store.all('reveal', bench.id).filter((r) => r.session === session);
  }
  function lockedScores(bench, session) {
    return Object.assign({}, ...reveals(bench, session).map((r) => r.scores));
  }
  function view(req, bench) {
    const ballotId = `${bench.id}:${req.session}`;
    let assignment = store.get('assignment', ballotId);
    if (!assignment) {
      assignment = {
        id: ballotId,
        order: Object.fromEntries(
          bench.tasks.map((t) => [
            t.id,
            shuffle(bench.entries.filter((e) => e.taskId === t.id).map((e) => e.id)),
          ]),
        ),
      };
      store.put('assignment', assignment, bench.id);
    }
    const ballot = store.get('ballot', ballotId);
    const myReveals = reveals(bench, req.session);
    const revealedTasks = new Set(myReveals.map((r) => r.taskId));
    if (ballot) bench.tasks.forEach((t) => revealedTasks.add(t.id));
    const myScores = ballot
      ? Object.fromEntries(
          Object.entries(ballot.scores).map(([entryId, value]) => {
            const entry = bench.entries.find((e) => e.id === entryId);
            const task = entry && bench.tasks.find((t) => t.id === entry.taskId);
            const max = task ? task.criteria.reduce((n, c) => n + c.maxScore, 0) : 0;
            const folded = normalizeScore(value, max);
            return [entryId, folded === null ? value : Math.round(folded * 10) / 10];
          }),
        )
      : null;
    return {
      id: bench.id,
      title: bench.title,
      createdAt: bench.createdAt,
      demo: bench.demo,
      status: bench.status,
      tasks: bench.tasks,
      activeIndex: bench.activeIndex ?? 0,
      participantCount: bench.models.length,
      owner: bench.owner === req.session,
      sharePath:
        bench.owner === req.session && bench.shareToken ? `/play/${bench.shareToken}` : undefined,
      order: assignment.order,
      revealed: Boolean(ballot),
      revealedTasks: [...revealedTasks],
      lockedScores: Object.assign({}, ...myReveals.map((r) => r.scores)),
      myBallot: ballot ? { scores: myScores, comment: ballot.comment } : null,
      entries: bench.tasks
        .flatMap((t) =>
          assignment.order[t.id].map((entryId) => bench.entries.find((e) => e.id === entryId)),
        )
        .map((e) => {
          const identity = revealedTasks.has(e.taskId)
            ? bench.models.find((m) => m.id === e.modelId)
            : null;
          return {
            id: e.id,
            taskId: e.taskId,
            status: e.status,
            content: e.status === 'done' ? e.content : undefined,
            html:
              e.status === 'done' && bench.tasks.find((t) => t.id === e.taskId).format === 'html'
                ? extractHtml(e.content)
                : null,
            truncated: e.truncated,
            error: e.error,
            outputChars: e.status === 'running' ? e.outputChars : undefined,
            ...(identity ? { model: publicIdentity(identity) } : {}),
            ...(ballot ? { duration: e.duration } : {}),
          };
        }),
      results: ballot ? totals(bench, ballots(bench)) : undefined,
      voterCount: ballot ? ballots(bench).length : undefined,
    };
  }
  function queue(benchId, entryId) {
    pending.push(async () => {
      const bench = store.get('bench', benchId);
      const entry = bench.entries.find((e) => e.id === entryId);
      entry.status = 'running';
      persistBench(bench);
      const start = Date.now();
      let lastProgress = 0;
      log('generation.start', { benchId, entryId });
      let output, error;
      try {
        const config = store.get('model', entry.modelId);
        if (!config?.encryptedKey || config.owner !== bench.owner)
          throw new Error('模型配置已移除，请重新创建评测');
        const snapshot = bench.models.find((m) => m.id === entry.modelId);
        output = await generate(
          snapshot,
          store.decrypt(config.encryptedKey),
          buildPrompt(bench.tasks.find((t) => t.id === entry.taskId)),
          {
            onProgress(outputChars) {
              if (Date.now() - lastProgress < 1000) return;
              lastProgress = Date.now();
              const latest = store.get('bench', benchId);
              latest.entries.find((e) => e.id === entryId).outputChars = outputChars;
              persistBench(latest);
            },
          },
        );
      } catch (err) {
        error = generationError(err);
        log('generation.error', { benchId, entryId, type: err.name, reason: error });
      }
      // Reload to merge concurrent results rather than overwrite another completion.
      const latest = store.get('bench', benchId);
      const result = latest.entries.find((e) => e.id === entryId);
      Object.assign(
        result,
        output
          ? { status: 'done', ...output, duration: Date.now() - start }
          : { status: 'failed', error },
      );
      if (latest.entries.every((e) => ['done', 'failed'].includes(e.status)))
        latest.status = 'done';
      persistBench(latest);
      log('generation.finish', {
        benchId,
        entryId,
        status: result.status,
        duration: Date.now() - start,
      });
    });
    drain();
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/models', (req, res) => res.json(store.all('model', req.session).map(publicModel)));
  app.post('/api/models', (req, res) => {
    const data = modelSchema.parse(req.body);
    if (!data.key?.trim()) return res.status(400).json({ error: '请填写 API Key' });
    if (store.all('model', req.session).length >= 30)
      return res.status(400).json({ error: '最多保存 30 个模型配置' });
    const { key, ...config } = data;
    const model = {
      ...config,
      id: id(),
      owner: req.session,
      encryptedKey: store.encrypt(key.trim()),
    };
    store.put('model', model, req.session);
    log('model.created', { id: model.id, protocol: model.protocol });
    res.status(201).json(publicModel(model));
  });
  app.put('/api/models/:id', (req, res) => {
    const model = ownModel(req, req.params.id);
    if (!model) return res.status(404).json({ error: '找不到模型配置' });
    const { key, ...data } = modelSchema.parse(req.body);
    Object.assign(model, data);
    if (key?.trim()) model.encryptedKey = store.encrypt(key.trim());
    store.put('model', model, req.session);
    res.json(publicModel(model));
  });
  app.delete('/api/models/:id', (req, res) => {
    const running = store
      .all('bench', req.session)
      .some((b) => b.status === 'running' && b.models.some((m) => m.id === req.params.id));
    if (running) return res.status(409).json({ error: '该模型正在参与测试，完成后再移除' });
    store.remove('model', req.params.id, req.session);
    res.json({ ok: true });
  });
  async function runModelTest(config, key, source) {
    try {
      const result = await testConnection(config, key);
      log('model.test', { source, protocol: config.protocol, ok: true, latency: result.latency });
      return { ok: true, reply: result.reply, latency: result.latency };
    } catch (err) {
      const error = connectionError(err);
      log('model.test', {
        source,
        protocol: config.protocol,
        ok: false,
        type: err.name,
        reason: error,
      });
      return { ok: false, error };
    }
  }
  // Tests the configuration currently in the form, before it is saved.
  app.post('/api/models/test', async (req, res) => {
    const data = testModelSchema.parse(req.body);
    let key = data.key?.trim();
    if (!key) {
      const saved = data.id ? ownModel(req, data.id) : null;
      if (!saved?.encryptedKey) return res.status(400).json({ error: '请填写 API Key' });
      key = store.decrypt(saved.encryptedKey);
    }
    const { id: _id, key: _key, ...config } = data;
    const result = await runModelTest(config, key, 'draft');
    res.status(result.ok ? 200 : 502).json(result);
  });
  // Tests a saved configuration exactly as it is stored.
  app.post('/api/models/:id/test', async (req, res) => {
    const model = ownModel(req, req.params.id);
    if (!model) return res.status(404).json({ error: '找不到模型配置' });
    if (!model.encryptedKey) return res.status(400).json({ error: '该模型尚未保存 API Key' });
    const result = await runModelTest(model, store.decrypt(model.encryptedKey), 'saved');
    res.status(result.ok ? 200 : 502).json(result);
  });
  app.get('/api/benches', (req, res) =>
    res.json(
      store
        .all('bench', req.session)
        .map((b) => ({
          id: b.id,
          title: b.title,
          createdAt: b.createdAt,
          status: b.status,
          demo: b.demo,
          taskCount: b.tasks.length,
          modelCount: b.models.length,
          revealed: Boolean(store.get('ballot', `${b.id}:${req.session}`)),
        }))
        .reverse(),
    ),
  );
  app.post('/api/benches', (req, res) => {
    const data = createBenchSchema.parse(req.body);
    if (store.all('bench', req.session).filter((b) => b.status === 'running').length >= 2)
      return res.status(409).json({ error: '已有两场测试进行中，请等待完成' });
    const models = data.modelIds.map((value) => ownModel(req, value));
    if (models.some((m) => !m))
      return res.status(400).json({ error: '所选模型不存在，请刷新后重试' });
    const bench = {
      id: id(),
      owner: req.session,
      title: data.title,
      createdAt: new Date().toISOString(),
      status: 'running',
      tasks: data.tasks.map((t) => ({ ...t, id: id() })),
      models: models.map(publicModel),
      activeIndex: 0,
    };
    // Sequential testing: only the first task starts now; the rest wait for the reviewer.
    bench.entries = bench.tasks.flatMap((task, ti) =>
      models.map((m) => ({
        id: id(),
        taskId: task.id,
        modelId: m.id,
        status: ti === 0 ? 'queued' : 'pending',
      })),
    );
    persistBench(bench);
    log('bench.created', { id: bench.id, tasks: bench.tasks.length, models: models.length });
    res.status(201).json({ id: bench.id });
    bench.entries.filter((e) => e.status === 'queued').forEach((e) => queue(bench.id, e.id));
  });
  app.post('/api/benches/:id/next', (req, res) => {
    const bench = access(req, req.params.id, false);
    if (!bench) return res.status(404).json({ error: '找不到评测' });
    if (bench.status === 'done' || ballots(bench).length)
      return res.status(409).json({ error: '测试已结束，无法继续' });
    const active = bench.activeIndex ?? 0;
    if (active >= bench.tasks.length - 1)
      return res.status(409).json({ error: '已经是最后一道题' });
    const current = bench.entries.filter((e) => e.taskId === bench.tasks[active].id);
    if (current.some((e) => ['pending', 'queued', 'running'].includes(e.status)))
      return res.status(409).json({ error: '当前题目尚未完成，请先等待作答结束' });
    bench.activeIndex = active + 1;
    const nextId = bench.tasks[bench.activeIndex].id;
    const nextEntries = bench.entries.filter((e) => e.taskId === nextId);
    nextEntries.forEach((e) => {
      e.status = 'queued';
      delete e.error;
      delete e.outputChars;
    });
    persistBench(bench);
    log('bench.next', { id: bench.id, activeIndex: bench.activeIndex });
    res.json({ ok: true });
    nextEntries.forEach((e) => queue(bench.id, e.id));
  });
  app.post('/api/demo', (req, res) => {
    const task = { ...demoTask, id: id() };
    const models = demoEntries.map(({ content: _content, ...m }) => ({ ...m, id: id() }));
    const bench = {
      id: id(),
      owner: req.session,
      title: '专注番茄钟 · 体验盲评',
      createdAt: new Date().toISOString(),
      demo: true,
      status: 'done',
      tasks: [task],
      models,
      entries: demoEntries.map((e, i) => ({
        id: id(),
        taskId: task.id,
        modelId: models[i].id,
        status: 'done',
        content: e.content,
        duration: 0,
      })),
    };
    persistBench(bench);
    res.status(201).json({ id: bench.id });
  });
  app.post('/api/benches/:id/retry', (req, res) => {
    const bench = access(req, req.params.id, false);
    if (!bench) return res.status(404).json({ error: '找不到评测' });
    if (bench.status === 'running' || ballots(bench).length)
      return res.status(409).json({ error: '测试进行中或已有评分，无法重试；请新建一场评测' });
    const failed = bench.entries.filter((e) => e.status === 'failed');
    if (!failed.length) return res.status(400).json({ error: '没有需要重试的成果' });
    failed.forEach((e) => {
      e.status = 'queued';
      delete e.error;
      delete e.outputChars;
    });
    bench.status = 'running';
    persistBench(bench);
    res.json({ ok: true });
    failed.forEach((e) => queue(bench.id, e.id));
  });
  app.post('/api/benches/:id/share', (req, res) => {
    const bench = access(req, req.params.id, false);
    if (!bench) return res.status(404).json({ error: '找不到评测' });
    bench.shareToken ||= randomBytes(24).toString('base64url');
    persistBench(bench);
    res.json({ path: `/play/${bench.shareToken}` });
  });
  for (const [route, shared] of [
    ['benches', false],
    ['reviews', true],
  ]) {
    app.get(`/api/${route}/:id`, (req, res) => {
      const bench = access(req, req.params.id, shared);
      if (!bench) return res.status(404).json({ error: '评测不存在，或此浏览器没有访问权限' });
      res.json(view(req, bench));
    });
    // 揭晓单题：先给该题打分，再单独查看它背后的模型；该题评分随即锁定。
    app.post(`/api/${route}/:id/reveal`, (req, res) => {
      const bench = access(req, req.params.id, shared);
      if (!bench) return res.status(404).json({ error: '找不到评测' });
      const ballotId = `${bench.id}:${req.session}`;
      if (store.get('ballot', ballotId))
        return res.status(409).json({ error: '本场评测已全部揭晓' });
      const taskId = req.body?.taskId;
      const index = bench.tasks.findIndex((t) => t.id === taskId);
      if (index < 0) return res.status(400).json({ error: '题目不存在' });
      const revealId = `${bench.id}:${req.session}:${taskId}`;
      // 重复提交保持幂等，避免重复点击产生多余提示。
      if (store.get('reveal', revealId)) return res.json(view(req, bench));
      if (index > (bench.activeIndex ?? 0))
        return res.status(409).json({ error: '这道题还没有开始' });
      const entries = bench.entries.filter((e) => e.taskId === taskId);
      if (entries.some((e) => ['pending', 'queued', 'running'].includes(e.status)))
        return res.status(409).json({ error: '选手们还没有作答完成' });
      const failed = entries.filter((e) => e.status === 'failed').length;
      if (failed) return res.status(409).json({ error: `有 ${failed} 份成果未生成成功` });
      let scores;
      try {
        scores = validateTaskScores(bench, taskId, req.body?.scores);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      store.put(
        'reveal',
        {
          id: revealId,
          benchId: bench.id,
          session: req.session,
          taskId,
          scores,
          createdAt: new Date().toISOString(),
        },
        bench.id,
      );
      log('task.revealed', { benchId: bench.id, taskId });
      res.json(view(req, bench));
    });
    app.post(`/api/${route}/:id/vote`, (req, res) => {
      const bench = access(req, req.params.id, shared);
      if (!bench) return res.status(404).json({ error: '找不到评测' });
      if (bench.status !== 'done')
        return res.status(409).json({ error: '请等待所有测试结束后提交评分' });
      const ballotId = `${bench.id}:${req.session}`;
      if (store.get('ballot', ballotId))
        return res.status(409).json({ error: '你已提交评分，揭晓后不能修改' });
      if (!store.get('assignment', ballotId))
        return res.status(400).json({ error: '请先打开匿名评审页面' });
      let scores;
      try {
        // 已经揭晓的题目分数以服务端锁定值为准，客户端无法改写。
        scores = validateScores(bench, {
          ...req.body.scores,
          ...lockedScores(bench, req.session),
        });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const comment =
        typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : '';
      store.put(
        'ballot',
        { id: ballotId, scores, comment, createdAt: new Date().toISOString() },
        bench.id,
      );
      log('ballot.submitted', { benchId: bench.id });
      res.json(view(req, bench));
    });
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((err, _req, res, _next) => {
    if (err.name === 'ZodError')
      return res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；') });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: '导入内容过大，请限制在 2 MB 内' });
    if (err instanceof SyntaxError && err.status === 400)
      return res.status(400).json({ error: 'JSON 格式无效' });
    log('request.error', { type: err.name });
    res.status(500).json({ error: '服务暂时遇到问题，请稍后重试' });
  });
  return app;
}
