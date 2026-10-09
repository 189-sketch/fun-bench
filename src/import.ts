import type { Criterion, Task } from './types';

export const AGENT_PROMPT = `请根据你对我的工作、项目和日常使用 AI 场景的了解，帮我设计适合比较不同 AI 模型的测试题。
如果背景不足，先问我几个关键问题；然后提出几个我经常做、且能判断结果好坏的代表性任务，让我选择。
为选中的任务生成自包含的测试提示词，把必要背景、输入材料、约束和预期输出格式写进去，使一个全新会话中的模型也能独立完成。
同时给出贴合这个任务的评分标准，各项写明分值和具体判断依据，总分 100 分。请与我确认题目和标准是否合适。
确认后，按以下 Markdown 格式输出，便于粘贴到 Fun Bench。不要替参赛模型作答，也不要根据模型品牌预判结果。

# 测试标题
## 测试提示词
（完整任务、必要材料、约束和输出要求）
## 评分标准
- 评分项名称（40分）：具体判断依据
- 评分项名称（35分）：具体判断依据
- 评分项名称（25分）：具体判断依据

有多道题时，用单独一行 --- 分隔。题目中涉及的附件请另列清单，并提醒我在测试时提供相同材料。`;

export const EXAMPLE = `# 客户访谈 → 可执行需求
## 测试提示词
你是一位产品经理。请根据下面的客户访谈，整理真实问题、原文证据和可执行的需求建议，区分用户提出的方案与底层需求，不要补充未经证实的信息。

访谈材料：
“我们团队有 8 个人，每周五都要手动汇总进度，复制到一个文档里，差不多花两个小时。有时候两个人会改同一份内容，最后不知道以谁的为准。我觉得你们应该加一个群聊功能。其实我最想知道的是，哪些任务卡住了、谁需要帮忙。老板通常只看一页摘要。”

输出要求：用表格列出问题、证据、建议和优先级，最后给出不超过 100 字的摘要。
## 评分标准
- 准确性（40分）：所有结论都有访谈原文支撑，不编造事实
- 需求洞察（35分）：区分“想要群聊”的方案与协作、汇总、阻塞可见性的真实需求
- 可用性（25分）：表格完整，优先级合理，摘要不超过 100 字`;

export function parseCriteria(text: string): Criterion[] {
  const lines = text.split('\n');
  const result: Criterion[] = [];
  for (const line of lines) {
    const clean = line
      .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '')
      .replace(/\*\*/g, '')
      .trim();
    const match =
      clean.match(/^(.{1,80}?)\s*[（(]\s*(\d+)\s*(?:分|points?)?\s*[）)]\s*[:：-]?\s*(.*)$/i) ||
      clean.match(/^(.{1,80}?)\s*[:：]\s*(\d+)\s*分\s*[,，:：-]?\s*(.*)$/);
    if (match && Number(match[2]) > 0 && Number(match[2]) <= 100)
      result.push({
        name: match[1].trim(),
        maxScore: Number(match[2]),
        description: match[3].trim(),
      });
  }
  return result.length ? result : [{ name: '综合评分', description: text.trim(), maxScore: 100 }];
}

function normalizeTask(input: unknown): Task {
  if (!input || typeof input !== 'object')
    throw new Error('题目需要包含标题、测试提示词和评分标准');
  const value = input as Record<string, unknown>;
  const prompt = String(value.prompt || value.test_prompt || '');
  const evaluation =
    typeof value.evaluation === 'string'
      ? value.evaluation
      : typeof value.rubric === 'string'
        ? value.rubric
        : '';
  const criteria = Array.isArray(value.criteria)
    ? value.criteria.map((c: Record<string, unknown>) => ({
        name: String(c.name || ''),
        description: String(c.description || ''),
        maxScore: Number(c.maxScore || c.max_score || 100),
      }))
    : parseCriteria(evaluation);
  return {
    title: String(value.title || '我的真实场景测试'),
    prompt,
    evaluation:
      evaluation ||
      criteria.map((c: Criterion) => `- ${c.name}（${c.maxScore}分）：${c.description}`).join('\n'),
    format: value.format === 'html' ? 'html' : 'text',
    criteria,
  };
}

export function parseImport(source: string): Task[] {
  const input = source
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1')
    .trim();
  if (!input) throw new Error('先粘贴 Agent 为你生成的题目');
  if (input.startsWith('{') || input.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('JSON 格式有误，请检查引号、逗号，或改用 Markdown 粘贴');
    }
    const tasks = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.tasks)
        ? parsed.tasks
        : [parsed];
    if (!tasks.length || tasks.length > 10) throw new Error('每场支持 1 到 10 道题目');
    return tasks.map(normalizeTask);
  }
  const blocks = input.split(/^\s*---\s*$/m).filter((b) => b.trim());
  if (blocks.length > 10) throw new Error('每场最多导入 10 道题目');
  return blocks.map((block, index) => {
    const titleMatch = block.match(/^#\s+(.+)$/m);
    const sections =
      /^\s*(?:#{1,4}\s*)?(?:\*\*)?(?:评分标准|评价标准|评估标准|Evaluation(?: Criteria)?|Rubric)(?:\*\*)?\s*[:：]?\s*$/im.exec(
        block,
      );
    const evaluation = sections ? block.slice(sections.index + sections[0].length).trim() : '';
    let prompt = (sections ? block.slice(0, sections.index) : block).trim();
    if (titleMatch) prompt = prompt.replace(titleMatch[0], '').trim();
    prompt = prompt
      .replace(/^\s*(?:#{1,4}\s*)?(?:测试提示词|测试题目|Test Prompt|Prompt)\s*[:：]?\s*\n/i, '')
      .trim();
    return {
      title: titleMatch?.[1].trim() || `真实场景测试 ${index + 1}`,
      prompt,
      evaluation,
      criteria: parseCriteria(evaluation),
      format: /单文件\s*HTML|完整\s*HTML|single.?file\s*html/i.test(prompt) ? 'html' : 'text',
    };
  });
}
