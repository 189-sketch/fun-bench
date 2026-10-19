import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const baseUrlSchema = text(1000).refine((v) => {
  try {
    const u = new URL(v);
    return (
      ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash
    );
  } catch {
    return false;
  }
}, '请输入不含账号、参数的 HTTP(S) Base URL');
const protocolSchema = z.enum(['openai', 'anthropic']);
const maxTokensSchema = z.number().int().min(256).max(1_000_000).default(4096);
const tokenParameterSchema = z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens');
export const modelSchema = z.object({
  name: text(80),
  protocol: protocolSchema,
  baseUrl: baseUrlSchema,
  model: text(150),
  key: z.string().max(2000).optional(),
  maxTokens: maxTokensSchema,
  tokenParameter: tokenParameterSchema,
});
// A connection test only needs the endpoint, the model and a key.
export const testModelSchema = z.object({
  id: text(100).optional(),
  protocol: protocolSchema,
  baseUrl: baseUrlSchema,
  model: text(150),
  key: z.string().max(2000).optional(),
  maxTokens: maxTokensSchema,
  tokenParameter: tokenParameterSchema,
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

// Reviewers give one holistic score per output; failed outputs are excluded.
export function validateScores(bench, scores) {
  const parsed = z.record(z.string(), z.number().int().min(0).max(100)).safeParse(scores);
  if (!parsed.success) throw new Error('评分格式不正确');
  const successful = bench.entries.filter((e) => e.status === 'done');
  if (!successful.length) throw new Error('没有可评分的成果');
  if (Object.keys(parsed.data).length !== successful.length)
    throw new Error('请为每份已完成的成果打分');
  for (const entry of successful) {
    if (parsed.data[entry.id] === undefined) throw new Error('请为每份已完成的成果打分');
  }
  return parsed.data;
}

// A single task can be revealed on its own, but only with a grade for every
// successful output of that very task. Unknown entries are rejected so a
// client bug never passes silently.
export function validateTaskScores(bench, taskId, scores) {
  const parsed = z.record(z.string(), z.number().int().min(0).max(100)).safeParse(scores ?? {});
  if (!parsed.success) throw new Error('评分格式不正确');
  const successful = bench.entries.filter((e) => e.taskId === taskId && e.status === 'done');
  if (!successful.length) throw new Error('本题没有可评分的成果');
  for (const entry of successful) {
    if (parsed.data[entry.id] === undefined) throw new Error('请先为本题的每份成果打分');
  }
  const known = new Set(successful.map((e) => e.id));
  if (Object.keys(parsed.data).some((id) => !known.has(id)))
    throw new Error('评分包含了不属于本题的成果');
  return Object.fromEntries(successful.map((e) => [e.id, parsed.data[e.id]]));
}

// Older ballots stored per-criterion scores; fold them into a 0-100 percentage.
export function normalizeScore(value, criteriaMax) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const sum = Object.values(value).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return criteriaMax ? (sum / criteriaMax) * 100 : sum;
  }
  return null;
}

export function totals(bench, ballots) {
  return bench.entries
    .filter((e) => e.status === 'done')
    .map((entry) => {
      const task = bench.tasks.find((t) => t.id === entry.taskId);
      const max = task.criteria.reduce((n, c) => n + c.maxScore, 0);
      const values = ballots
        .map((b) => normalizeScore(b.scores[entry.id], max))
        .filter((v) => typeof v === 'number');
      return {
        entryId: entry.id,
        average: values.length
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
          : null,
        count: values.length,
      };
    });
}
