import { test, expect } from '@playwright/test';

// 成果可能陆续到达，且重复点击同一个档位会取消评分。
// 因此只给尚未打分的成果点档位，并持续到指定的按钮变为可用。
async function scoreAll(page, ready) {
  const target = ready || page.getByRole('button', { name: '提交评分，揭晓身份' });
  for (let attempt = 0; attempt < 60; attempt++) {
    const cards = page.locator('.entry-card');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      if ((await card.getAttribute('class'))?.includes('scored')) continue;
      const button = card.locator('.fuzzy-score button', { hasText: '可以' });
      if (!(await button.count())) continue;
      if ((await button.getAttribute('aria-pressed')) === 'true') continue;
      await button.click();
      await expect(card).toHaveClass(/scored/);
    }
    if ((await target.count()) && (await target.isEnabled())) return;
    await page.waitForTimeout(250);
  }
  await expect(target).toBeEnabled();
}
// 演示成果运行在 sandbox iframe 内。移动端模拟下，iframe 首帧落定前的首次点击
// 偶发丢失，因此重试直到模式真正切换（切换动作是幂等的，重复点击安全）。
async function clickUntilText(frame, name, expected) {
  await expect(async () => {
    await frame.getByRole('button', { name }).click();
    await expect(frame.getByText(expected, { exact: true })).toBeVisible({ timeout: 800 });
  }).toPass({ timeout: 15000 });
}
async function reveal(page) {
  await page.getByRole('button', { name: '提交评分，揭晓身份' }).click();
  await page.getByRole('button', { name: '确认评分并揭晓' }).click();
  await expect(page.getByText('身份已揭晓', { exact: true })).toBeVisible();
}
test('demo: playable anonymous artifacts, reload-safe draft, reveal and independently invited reviewer', async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '先玩一场演示' }).click();
  await expect(page.getByText('盲评进行中', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '神秘选手 A', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /纸飞机|小彗星|夜航船/ })).toHaveCount(0);
  const frame = page.frameLocator('iframe[title="选手 A 成果"]');
  await expect(frame.getByText('25:00', { exact: true })).toBeVisible();
  await clickUntilText(frame, /休息/, '05:00');
  await page.getByRole('button', { name: '重置选手 A 成果' }).click();
  await expect(frame.getByText('25:00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeDisabled();
  await scoreAll(page);
  await page.reload();
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeEnabled();
  const card = await page.locator('.entry-card').first().elementHandle();
  await reveal(page);
  await expect(page.locator('.entry-card.reveal-playing')).toHaveCount(3);
  expect(await page.locator('.reveal-veil').count()).toBe(0);
  const frames = await page
    .locator('.entry-card')
    .first()
    .evaluate((node) =>
      node.getAnimations().flatMap((animation) => animation.effect.getKeyframes()),
    );
  expect(frames.some((frame) => frame.transform?.includes('rotateY(90deg)'))).toBeTruthy();
  expect(
    await card.evaluate((node) => node === document.querySelector('.entry-card')),
  ).toBeTruthy();
  await expect(page.locator('.reveal-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /纸飞机|小彗星|夜航船/ })).toHaveCount(3);
  await expect(frame.getByText('25:00', { exact: true })).toBeVisible();
  await expect(page.getByText('1 人盲评均分')).toHaveCount(3);
  await expect(
    page.locator('.entry-card').first().locator('.fuzzy-score button').first(),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: /纸飞机|小彗星|夜航船/ })).toHaveCount(3);
  await expect(page.locator('.entry-card.reveal-playing')).toHaveCount(0);
  await page.getByRole('button', { name: '邀请朋友盲评' }).click();
  const url = await page.getByLabel('评审链接').inputValue();
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(guest.getByText('盲评进行中', { exact: true })).toBeVisible();
  await expect(guest.getByRole('heading', { name: /纸飞机|小彗星|夜航船/ })).toHaveCount(0);
  await scoreAll(guest);
  await reveal(guest);
  await expect(guest.locator('.entry-card.reveal-playing')).toHaveCount(0);
  await expect(guest.getByRole('heading', { name: /纸飞机|小彗星|夜航船/ })).toHaveCount(3);
  await expect(guest.getByText('2 人盲评均分').first()).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);
});

test('real configuration flow: both protocol forms, agent import, parallel generation and scoring', async ({
  page,
}) => {
  await page.goto('/models');
  for (const [name, protocol, model] of [
    ['我的 OpenAI 选手', 'OpenAI', 'mock-openai'],
    ['我的 Claude 选手', 'Anthropic', 'mock-anthropic'],
  ]) {
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByRole('button', { name: protocol, exact: true }).click();
    await page.getByLabel('显示名称', { exact: true }).fill(name);
    await page.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:4174/v1');
    await page.getByLabel('Model ID', { exact: true }).fill(model);
    await page.getByLabel('API Key', { exact: true }).fill('e2e-fake-key');
    await page.getByLabel('最大输出 Tokens', { exact: true }).fill('1000000');
    await page.getByRole('button', { name: '保存模型', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const savedModels = await (await page.context().request.get('/api/models')).json();
  expect(savedModels.every((model) => model.maxTokens === 1_000_000)).toBeTruthy();
  await page.getByRole('button', { name: '我的评测', exact: true }).click();
  await page.getByRole('button', { name: '开启我的评测' }).click();
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await expect(page.getByLabel('测试提示词与输入材料', { exact: true })).toHaveValue(
    /团队有 8 个人/,
  );
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: /我的 OpenAI 选手/ }).click();
  await page.getByRole('button', { name: /我的 Claude 选手/ }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '神秘选手 A', exact: true })).toBeVisible();
  await expect(page.getByText('访谈分析', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await scoreAll(page);
  await reveal(page);
  await expect(page.getByRole('heading', { name: '我的 OpenAI 选手', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我的 Claude 选手', exact: true })).toBeVisible();
});

test('model connection test: draft and saved configurations report a working or broken model', async ({
  page,
}) => {
  await page.goto('/models');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('连接测试选手');
  await page.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:4174/v1');
  await page.getByLabel('Model ID', { exact: true }).fill('mock-openai');
  await page.getByLabel('API Key', { exact: true }).fill('e2e-fake-key');
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/连接正常/)).toBeVisible();
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '连接测试选手' })).toBeVisible();
  await page.getByRole('button', { name: '测试 连接测试选手 连接' }).click();
  await expect(page.getByText(/连接正常/)).toBeVisible();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('无法连接选手');
  await page.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:4174/v1');
  await page.getByLabel('Model ID', { exact: true }).fill('mock-fail');
  await page.getByLabel('API Key', { exact: true }).fill('e2e-secret-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '无法连接选手' })).toBeVisible();
  await page.getByRole('button', { name: '测试 无法连接选手 连接' }).click();
  await expect(page.getByText(/服务返回 HTTP 401/)).toBeVisible();
  await expect(page.getByText('e2e-secret-key', { exact: false })).toHaveCount(0);
});

test('multiple tasks require complete scores and upstream failures remain anonymous', async ({
  page,
}) => {
  const request = page.context().request;
  // Establish the session deterministically before the app fires its own parallel requests.
  await request.get('/api/health');
  await page.goto('/');
  const models = [];
  for (const model of ['mock-openai', 'mock-fail']) {
    const response = await request.post('/api/models', {
      data: {
        name: model,
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:4174/v1',
        model,
        key: 'failure-test-secret',
      },
    });
    models.push((await response.json()).id);
  }
  const task = {
    prompt: '对这份访谈做摘要。',
    evaluation: '是否准确',
    format: 'text',
    criteria: [{ name: '准确性', maxScore: 10, description: '结论有证据' }],
  };
  const response = await request.post('/api/benches', {
    data: {
      title: '多题盲评',
      modelIds: models,
      tasks: [
        { ...task, title: '题目一' },
        { ...task, title: '题目二' },
      ],
    },
  });
  const { id } = await response.json();
  await page.goto(`/bench/${id}`);
  await expect(page.getByText('这位选手暂时掉线了', { exact: true })).toBeVisible();
  await expect(page.getByText(/服务返回 HTTP 401/)).toBeVisible();
  await expect(page.getByText('failure-test-secret', { exact: false })).toHaveCount(0);
  // 第 2 题在继续之前保持锁定
  await expect(page.getByRole('button', { name: /02.*题目二/ })).toBeDisabled();
  const next = page.getByRole('button', { name: '继续测试下一个' });
  await expect(next).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toHaveCount(0);
  await scoreAll(page, next);
  await expect(next).toBeEnabled();
  await next.click();
  // 第 2 题开始作答，等待其成果出现后再评分
  await expect(page.locator('.entry-card .fuzzy-score').first()).toBeVisible({ timeout: 20000 });
  await scoreAll(page);
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeEnabled();
  await reveal(page);
  await expect(page.getByRole('heading', { name: 'mock-openai', exact: true })).toBeVisible();
});

test('a single question can be revealed on its own, locking only that question', async ({
  page,
}) => {
  const request = page.context().request;
  // Establish the session deterministically before the app fires its own parallel requests.
  await request.get('/api/health');
  const modelIds = [];
  for (const [name, protocol, model] of [
    ['隐藏的 openai', 'openai', 'mock-openai'],
    ['隐藏的 anthropic', 'anthropic', 'mock-anthropic'],
  ]) {
    const response = await request.post('/api/models', {
      data: {
        name,
        protocol,
        baseUrl: 'http://127.0.0.1:4174/v1',
        model,
        key: 'reveal-e2e-secret',
      },
    });
    modelIds.push((await response.json()).id);
  }
  const task = {
    prompt: '完成一件真实的事。',
    evaluation: '是否真的有用',
    format: 'text',
    criteria: [{ name: '帮助程度', maxScore: 100 }],
  };
  const response = await request.post('/api/benches', {
    data: {
      title: '单题揭晓',
      modelIds,
      tasks: [
        { ...task, title: '题目一' },
        { ...task, title: '题目二' },
      ],
    },
  });
  const { id } = await response.json();
  await page.goto(`/bench/${id}`);
  // 第 1 题作答完成前不能揭晓
  const revealOne = page.getByRole('button', { name: '立即揭晓第 1 题' });
  await expect(revealOne).toBeDisabled();
  const next = page.getByRole('button', { name: '继续测试下一个' });
  await scoreAll(page, next);
  await expect(revealOne).toBeEnabled();
  await revealOne.click();
  // 第 1 题揭晓身份，且该题评分锁定
  await expect(page.getByRole('heading', { name: '隐藏的 openai', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '隐藏的 anthropic', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '神秘选手 A', exact: true })).toHaveCount(0);
  await expect(page.locator('.entry-card .fuzzy-score button').first()).toBeDisabled();
  // 其它题目仍然匿名
  await next.click();
  await expect(page.locator('.entry-card .fuzzy-score').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: '神秘选手 A', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '隐藏的 openai', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '立即揭晓第 2 题' })).toBeDisabled();
  // 全部完成后照常提交揭晓
  await scoreAll(page);
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeEnabled();
  await reveal(page);
  await expect(page.getByRole('heading', { name: '隐藏的 openai', exact: true })).toBeVisible();
});

test('slow providers finish through streaming without dropping anonymous contestants', async ({
  page,
}, testInfo) => {
  const request = page.context().request;
  // Establish the session deterministically before the app fires its own parallel requests.
  await request.get('/api/health');
  await page.goto('/');
  const modelIds = [];
  for (const protocol of ['openai', 'anthropic']) {
    const response = await request.post('/api/models', {
      data: {
        name: `隐藏的 ${protocol}`,
        protocol,
        baseUrl: 'http://127.0.0.1:4174/v1',
        model: `mock-slow-${protocol}`,
        key: 'stream-test-secret',
        maxTokens: 1_000_000,
      },
    });
    modelIds.push((await response.json()).id);
  }
  const response = await request.post('/api/benches', {
    data: {
      title: '长时间生成回归',
      modelIds,
      tasks: [
        {
          title: '生成成果',
          prompt: '完成一个真实任务',
          evaluation: '完成度',
          format: 'text',
          criteria: [{ name: '完成度', maxScore: 10 }],
        },
      ],
    },
  });
  await page.goto(`/bench/${(await response.json()).id}`);
  await expect(page.getByText(/已收到 .* 字符，仍在生成/)).toHaveCount(2);
  await expect(page.getByText('流式成果已完成', { exact: true })).toHaveCount(2);
  await expect(page.getByText('这位选手暂时掉线了', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /隐藏的/ })).toHaveCount(0);
  await page.screenshot({
    path: `artifacts/streaming-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await scoreAll(page);
  await reveal(page);
});

test('responsive layout has no horizontal page overflow and keeps import usable', async ({
  page,
}) => {
  await page.goto('/');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: '开启我的评测' }).click();
  await page.getByRole('button', { name: '填入示例' }).click();
  await expect(page.getByLabel('Agent 生成的题目')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
