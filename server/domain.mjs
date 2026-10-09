import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
export const modelSchema = z.object({
  name: text(80),
  protocol: z.enum(['openai', 'anthropic']),
  baseUrl: text(1000).refine((v) => {
    try {
      const u = new URL(v);
      return (
        ['http:', 'https:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    } catch {
      return false;
    }
  }, '请输入不含账号、参数的 HTTP(S) Base URL'),
  model: text(150),
  key: z.string().max(2000).optional(),
  maxTokens: z.number().int().min(256).max(1_000_000).default(4096),
  tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
});
export const taskSchema = z.object({
  title: text(140),
  prompt: text(60000),
  evaluation: text(20000),
  format: z.enum(['text', 'html']).default('text'),
  criteria: z
    .array(
      z.object({
        name: text(80),
        description: z.string().max(1000).default(''),
        maxScore: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(12),
});
export const createBenchSchema = z.object({
  title: text(140),
  tasks: z.array(taskSchema).min(1).max(10),
  modelIds: z
    .array(text(100))
    .min(2)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length, '模型不能重复'),
});

export function endpoint(baseUrl, protocol) {
  const url = baseUrl.replace(/\/+$/, '');
  const suffix = protocol === 'openai' ? '/chat/completions' : '/messages';
  if (url.endsWith(suffix)) return url;
  return `${url}${url.endsWith('/v1') ? '' : '/v1'}${suffix}`;
}

export function buildPrompt(task) {
  // The imported task is unchanged; material and output requirements belong in it.
  return task.prompt;
}

export function extractHtml(content) {
  const fenced = content.match(/```(?:html)?\s*\n([\s\S]*?)```/i)?.[1];
  const raw = fenced || content;
  const start = raw.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  const end = raw.toLowerCase().lastIndexOf('</html>');
  return raw.slice(start, end >= 0 ? end + 7 : undefined);
}

export function validateScores(bench, scores) {
  const parsed = z.record(z.string(), z.record(z.string(), z.number().finite())).safeParse(scores);
  if (!parsed.success) throw new Error('评分格式不正确');
  const successful = bench.entries.filter((e) => e.status === 'done');
  if (!successful.length) throw new Error('没有可评分的成果');
  if (Object.keys(parsed.data).length !== successful.length)
    throw new Error('请为每份已完成的成果打分');
  for (const entry of successful) {
    const criteria = bench.tasks.find((t) => t.id === entry.taskId).criteria;
    const values = parsed.data[entry.id];
    if (!values || Object.keys(values).length !== criteria.length)
      throw new Error('请完成所有评分项');
    for (const [i, criterion] of criteria.entries()) {
      const value = values[String(i)];
      if (!Number.isInteger(value) || value < 0 || value > criterion.maxScore)
        throw new Error(`「${criterion.name}」评分应在 0 到 ${criterion.maxScore} 之间`);
    }
  }
  return parsed.data;
}

export function totals(bench, ballots) {
  return bench.entries
    .filter((e) => e.status === 'done')
    .map((entry) => {
      const task = bench.tasks.find((t) => t.id === entry.taskId);
      const max = task.criteria.reduce((n, c) => n + c.maxScore, 0);
      const values = ballots
        .map((b) => b.scores[entry.id])
        .filter(Boolean)
        .map((s) => (Object.values(s).reduce((a, b) => a + b, 0) / max) * 100);
      return {
        entryId: entry.id,
        average: values.length
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : null,
        count: values.length,
      };
    });
}
