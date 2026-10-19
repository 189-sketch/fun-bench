import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const directory = 'artifacts';
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  await page.goto(process.env.CAPTURE_URL || 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: '开启我的评测' }).waitFor();
  await page.screenshot({ path: `${directory}/home.png`, fullPage: true });
  await page.getByRole('button', { name: '先玩一场演示' }).click();
  await page.getByRole('heading', { name: '神秘选手 A', exact: true }).waitFor();
  await page
    .frameLocator('iframe[title="选手 A 成果"]')
    .getByText('25:00', { exact: true })
    .waitFor();
  await page.screenshot({ path: `${directory}/blind-review.png`, fullPage: true });
  const cards = page.locator('.entry-card');
  for (let i = 0; i < (await cards.count()); i++)
    await cards.nth(i).locator('.fuzzy-score button', { hasText: '可以' }).click();
  await page.getByRole('button', { name: '提交评分，揭晓身份' }).click();
  await page.getByRole('button', { name: '确认评分并揭晓' }).click();
  await page.getByText('身份已揭晓', { exact: true }).waitFor();
  await page.screenshot({ path: `${directory}/reveal-mystery.png` });
  await page.locator('.entry-card.reveal-playing').first().waitFor({ state: 'detached' });
  await page.screenshot({
    path: `${directory}/reveal.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fun Bench 首页', exact: true }).click();
  await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  console.info(`Screenshots saved to ${directory}/`);
} finally {
  await browser.close();
}
