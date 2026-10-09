import { test, expect } from '@playwright/test';

async function scoreAll(page, demo = true) {
  const fields = page.getByRole('spinbutton', { name: /选手 .* 分数/ });
  for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(demo ? '20' : '10');
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
  await frame.getByRole('button', { name: /休息/ }).click();
  await expect(frame.getByText('05:00', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('spinbutton', { name: '选手 A 功能完整性 分数' })).toBeDisabled();
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
  await page.getByRole('button', { name: '开始并行测试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '神秘选手 A', exact: true })).toBeVisible();
  await expect(page.getByText('访谈分析', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await scoreAll(page, false);
  await reveal(page);
  await expect(page.getByRole('heading', { name: '我的 OpenAI 选手', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我的 Claude 选手', exact: true })).toBeVisible();
});

test('multiple tasks require complete scores and upstream failures remain anonymous', async ({
  page,
}) => {
  await page.goto('/');
  const request = page.context().request;
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
  await page.getByRole('spinbutton', { name: /分数/ }).fill('0');
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeDisabled();
  await page.getByRole('button', { name: /02.*题目二/ }).click();
  await page.getByRole('spinbutton', { name: /分数/ }).fill('10');
  await expect(page.getByRole('button', { name: '提交评分，揭晓身份' })).toBeEnabled();
  await reveal(page);
  await expect(page.getByRole('heading', { name: 'mock-openai', exact: true })).toBeVisible();
});

test('slow providers finish through streaming without dropping anonymous contestants', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const request = page.context().request;
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
  await scoreAll(page, false);
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
