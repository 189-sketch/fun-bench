import test from 'node:test';
import assert from 'node:assert/strict';
import { endpoint, validateScores, totals, extractHtml } from '../server/domain.mjs';
import { parseImport, parseCriteria, EXAMPLE } from '../src/import.ts';

test('accepts protocol roots, versioned bases and full endpoints without duplicating paths', () => {
  assert.equal(
    endpoint('https://gateway.example/v1/', 'openai'),
    'https://gateway.example/v1/chat/completions',
  );
  assert.equal(
    endpoint('https://gateway.example', 'anthropic'),
    'https://gateway.example/v1/messages',
  );
  assert.equal(
    endpoint('https://gateway.example/v1/messages', 'anthropic'),
    'https://gateway.example/v1/messages',
  );
});
test('imports agent Markdown without losing input materials or output requirements', () => {
  const [task] = parseImport(EXAMPLE);
  assert.match(task.prompt, /团队有 8 个人/);
  assert.match(task.prompt, /不超过 100 字/);
  assert.equal(
    task.criteria.reduce((n, c) => n + c.maxScore, 0),
    100,
  );
  assert.equal(task.criteria[1].name, '需求洞察');
  assert.ok(!task.prompt.includes('## 评分标准'));
  assert.equal(parseImport(`${EXAMPLE}\n---\n${EXAMPLE}`).length, 2);
});
test('imports JSON task arrays and preserves unstructured rubrics as a single rating', () => {
  const [task] = parseImport(
    JSON.stringify({
      tasks: [{ title: '测试', prompt: '完整任务', evaluation: '判断是否有帮助' }],
    }),
  );
  assert.equal(task.criteria[0].maxScore, 100);
  assert.equal(task.criteria[0].description, '判断是否有帮助');
  assert.throws(() => parseImport('{ broken JSON'), /JSON 格式有误/);
  assert.equal(parseCriteria('- 准确性（40 分）：证据充分')[0].maxScore, 40);
});
const bench = {
  tasks: [
    {
      id: 't',
      criteria: [
        { name: '准确性', maxScore: 40 },
        { name: '表达', maxScore: 60 },
      ],
    },
  ],
  entries: [
    { id: 'a', taskId: 't', status: 'done' },
    { id: 'b', taskId: 't', status: 'failed' },
  ],
};
test('ratings require every successful entry and dimension, support deliberate zero, reject out-of-range and forged entries', () => {
  assert.deepEqual(validateScores(bench, { a: { 0: 0, 1: 60 } }), { a: { 0: 0, 1: 60 } });
  for (const scores of [
    {},
    { a: { 0: 20 } },
    { a: { 0: 41, 1: 50 } },
    { a: { 0: 20.5, 1: 50 } },
    { a: { 0: 20, 1: 50 }, b: { 0: 40, 1: 60 } },
  ])
    assert.throws(() => validateScores(bench, scores));
});
test('community scores normalize different point scales and exclude failed outputs', () => {
  const result = totals(bench, [
    { scores: { a: { 0: 20, 1: 30 } } },
    { scores: { a: { 0: 40, 1: 60 } } },
  ]);
  assert.deepEqual(result, [{ entryId: 'a', average: 75, count: 2 }]);
});
test('extracts runnable HTML from model prose without treating ordinary text as code', () => {
  assert.equal(
    extractHtml('示例：\n```html\n<!doctype html><html><body>hi</body></html>\n```\n说明'),
    '<!doctype html><html><body>hi</body></html>',
  );
  assert.equal(extractHtml('这是文字回答'), null);
});
