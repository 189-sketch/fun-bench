import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FileText,
  Plus,
  Rocket,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { ModelConfig, Task } from './types';
import { AGENT_PROMPT, EXAMPLE, parseCriteria, parseImport } from './import';
import { api, reportError } from './api';
import { Badge } from './ui';

export default function Create({
  models,
  navigate,
  notify,
}: {
  models: ModelConfig[];
  navigate: (p: string) => void;
  notify: (s: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const materialRef = useRef<HTMLInputElement>(null);
  const [materialTask, setMaterialTask] = useState(0);
  function importSource(value = source) {
    try {
      const parsed = parseImport(value);
      setTasks(parsed);
      setTitle(parsed[0].title);
      setError('');
      notify(`已识别 ${parsed.length} 道题，请核对题目和评分标准`);
    } catch (e) {
      setError(reportError(e));
    }
  }
  function updateTask(index: number, patch: Partial<Task>) {
    setTasks((current) => current.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }
  async function readFile(e: React.ChangeEvent<HTMLInputElement>, material = false) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('文件请控制在 1 MB 内');
      const text = await file.text();
      if (material) {
        updateTask(materialTask, {
          prompt: `${tasks[materialTask].prompt}\n\n补充材料（${file.name}）：\n${text}`,
        });
        notify('材料已加入题目，所有选手会收到相同内容');
      } else {
        setSource(text);
        importSource(text);
      }
    } catch (err) {
      setError(reportError(err));
    } finally {
      e.target.value = '';
    }
  }
  function next() {
    setError('');
    if (
      step === 0 &&
      (!tasks.length ||
        tasks.some(
          (t) =>
            !t.title.trim() ||
            !t.prompt.trim() ||
            !t.evaluation.trim() ||
            !t.criteria.length ||
            t.criteria.some(
              (c) =>
                !c.name.trim() ||
                !Number.isInteger(c.maxScore) ||
                c.maxScore < 1 ||
                c.maxScore > 100,
            ),
        ))
    ) {
      setError('请先识别题目，并补齐标题、测试提示词、评分标准与有效分值');
      return;
    }
    if (step === 1 && selected.length < 2) {
      setError('至少选择两个模型，才能进行盲评对比');
      return;
    }
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      const bench = await api<{ id: string }>('/benches', { title, tasks, modelIds: selected });
      navigate(`/bench/${bench.id}`);
    } catch (e) {
      setError(reportError(e));
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={() => navigate('/')}>
        <ArrowLeft size={16} />
        回到我的评测
      </button>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">MAKE IT PERSONAL</div>
          <h1>把真实任务，变成一场盲评。</h1>
          <p>题目来自你的 Agent，答案交给模型，判断留给自己。</p>
        </div>
        <Badge tone="orange">新一场评测</Badge>
      </div>
      <div className="stepper">
        {['导入题目', '选择选手', '确认开场'].map((label, i) => (
          <div
            className={`step ${i === step ? 'current' : i < step ? 'complete' : ''}`}
            key={label}
          >
            <span>{i < step ? <Check size={15} /> : `0${i + 1}`}</span>
            <strong>{label}</strong>
            {i < 2 && <div />}
          </div>
        ))}
      </div>
      {step === 0 && (
        <div className="create-layout">
          <div className="create-main">
            <section className="panel import-panel">
              <div className="section-label">
                <ClipboardPaste size={18} />
                <h2>粘贴 Agent 生成的题目</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    setSource(EXAMPLE);
                    importSource(EXAMPLE);
                  }}
                >
                  填入示例
                </button>
              </div>
              <p className="muted">
                包含完整测试提示词、输出要求和评分标准。支持 Markdown 或 JSON，多道题用{' '}
                <code>---</code> 分隔。
              </p>
              <textarea
                className="import-textarea"
                aria-label="Agent 生成的题目"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={
                  '# 测试标题\n## 测试提示词\n在这里粘贴完整任务、输入材料和输出要求…\n\n## 评分标准\n- 准确性（40分）：具体判断依据\n- 实用性（35分）：具体判断依据\n- 表达（25分）：具体判断依据'
                }
              />
              <div className="import-actions">
                <button className="button secondary" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} />
                  导入文件
                </button>
                <span>.md / .txt / .json</span>
                <button className="button dark" onClick={() => importSource()}>
                  识别题目
                  <ArrowRight size={16} />
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.json"
                hidden
                onChange={(e) => readFile(e)}
              />
            </section>
            {tasks.map((task, index) => (
              <section className="panel task-editor" key={index}>
                <div className="section-label">
                  <span className="number-chip">{String(index + 1).padStart(2, '0')}</span>
                  <h2>核对测试题</h2>
                  <button
                    className="icon-button"
                    aria-label={`移除题目 ${index + 1}`}
                    onClick={() => setTasks(tasks.filter((_, i) => i !== index))}
                  >
                    <X size={18} />
                  </button>
                </div>
                <label className="field-label" htmlFor={`task-title-${index}`}>
                  测试标题
                </label>
                <input
                  id={`task-title-${index}`}
                  maxLength={140}
                  value={task.title}
                  onChange={(e) => {
                    updateTask(index, { title: e.target.value });
                    if (index === 0) setTitle(e.target.value);
                  }}
                />
                <label className="field-label" htmlFor={`task-prompt-${index}`}>
                  测试提示词与输入材料
                </label>
                <textarea
                  id={`task-prompt-${index}`}
                  rows={7}
                  maxLength={60000}
                  value={task.prompt}
                  onChange={(e) => updateTask(index, { prompt: e.target.value })}
                />
                <button
                  className="text-button material-button"
                  onClick={() => {
                    setMaterialTask(index);
                    materialRef.current?.click();
                  }}
                >
                  <Plus size={14} />
                  补充文本材料（TXT / MD / CSV / JSON）
                </button>
                <label className="field-label" htmlFor={`task-eval-${index}`}>
                  原始评分标准
                </label>
                <textarea
                  id={`task-eval-${index}`}
                  rows={4}
                  maxLength={20000}
                  value={task.evaluation}
                  onChange={(e) => updateTask(index, { evaluation: e.target.value })}
                />
                <div className="rubric-label">
                  <span>评分表 · 总分 {task.criteria.reduce((n, c) => n + c.maxScore, 0)}</span>
                  <button
                    className="text-button"
                    onClick={() => updateTask(index, { criteria: parseCriteria(task.evaluation) })}
                  >
                    从标准更新评分项
                  </button>
                </div>
                {task.criteria.map((criterion, ci) => (
                  <div className="criterion-editor" key={ci}>
                    <input
                      aria-label={`题目 ${index + 1} 评分项 ${ci + 1} 名称`}
                      value={criterion.name}
                      maxLength={80}
                      onChange={(e) =>
                        updateTask(index, {
                          criteria: task.criteria.map((c, k) =>
                            k === ci ? { ...c, name: e.target.value } : c,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`题目 ${index + 1} 评分项 ${ci + 1} 满分`}
                      type="number"
                      min={1}
                      max={100}
                      value={criterion.maxScore}
                      onChange={(e) =>
                        updateTask(index, {
                          criteria: task.criteria.map((c, k) =>
                            k === ci ? { ...c, maxScore: Number(e.target.value) } : c,
                          ),
                        })
                      }
                    />
                    <span>分</span>
                    <button
                      className="icon-button"
                      disabled={task.criteria.length === 1}
                      aria-label={`删除评分项 ${ci + 1}`}
                      onClick={() =>
                        updateTask(index, { criteria: task.criteria.filter((_, k) => k !== ci) })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  disabled={task.criteria.length >= 12}
                  onClick={() =>
                    updateTask(index, {
                      criteria: [
                        ...task.criteria,
                        { name: '新评分项', description: '', maxScore: 10 },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  添加评分项
                </button>
                <label className="field-label" htmlFor={`task-format-${index}`}>
                  成果展示方式
                </label>
                <select
                  id={`task-format-${index}`}
                  value={task.format}
                  onChange={(e) => updateTask(index, { format: e.target.value as Task['format'] })}
                >
                  <option value="text">文字 / Markdown</option>
                  <option value="html">可运行的 HTML 网页</option>
                </select>
                <small className="field-help">
                  网页任务请要求返回完整的单文件 HTML，CSS / JavaScript 内联，不依赖外部网络资源。
                </small>
              </section>
            ))}
            <input
              ref={materialRef}
              type="file"
              accept=".txt,.md,.csv,.json"
              hidden
              onChange={(e) => readFile(e, true)}
            />
          </div>
          <aside className="create-aside">
            <div className="guide-card">
              <span className="guide-kicker">从你的 Agent 开始</span>
              <div className="mini-character">
                <span>?</span>
              </div>
              <h3>好题目，来自真问题。</h3>
              <p>你的 Agent 最了解你的工作。让它提炼一个有代表性的任务，并给出可判断的评分标准。</p>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(AGENT_PROMPT);
                    notify('出题提示词已复制，交给你的 Agent 吧');
                  } catch {
                    setShowPrompt(true);
                  }
                }}
              >
                <Copy size={15} />
                复制出题提示词
              </button>
              <button className="text-button" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? '收起提示词' : '查看完整提示词'}
              </button>
              {showPrompt && <pre className="agent-prompt">{AGENT_PROMPT}</pre>}
            </div>
            <div className="aside-note">
              <ShieldCheck size={20} />
              <p>题目和评分标准由你确认。我们保留原始要求，给每个模型相同的起跑线。</p>
            </div>
          </aside>
        </div>
      )}
      {step === 1 && (
        <section className="panel select-panel">
          <div className="section-label">
            <Users size={19} />
            <h2>邀请你的参赛选手</h2>
            <span className="muted">已选 {selected.length} / 6</span>
          </div>
          <p className="muted">你知道谁参赛，但在打分前，不知道谁写了哪份答案。</p>
          {models.length ? (
            <div className="select-model-grid">
              {models.map((m) => (
                <button
                  key={m.id}
                  className={`select-model ${selected.includes(m.id) ? 'selected' : ''}`}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(m.id)
                        ? current.filter((v) => v !== m.id)
                        : current.length < 6
                          ? [...current, m.id]
                          : current,
                    )
                  }
                >
                  <div className="select-model-head">
                    <Badge tone={m.protocol === 'openai' ? 'green' : 'orange'}>
                      {m.protocol === 'openai' ? 'OpenAI' : 'Anthropic'}
                    </Badge>
                    <span className="checkbox">
                      {selected.includes(m.id) && <Check size={15} />}
                    </span>
                  </div>
                  <h3>{m.name}</h3>
                  <code>{m.model}</code>
                  <small>{m.maxTokens.toLocaleString()} 输出 tokens</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state small-empty">
              <Users size={30} />
              <h3>先给你的选手留个席位</h3>
              <p>到模型设置中添加至少两个 API 配置，再回来导入题目。</p>
              <button className="button dark" onClick={() => navigate('/models')}>
                去添加模型
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}
      {step === 2 && (
        <section className="panel launch-panel">
          <div className="launch-icon">
            <Rocket size={32} />
          </div>
          <h2>准备好，让答案先说话。</h2>
          <p className="muted">
            {tasks.length} 道真实任务，{selected.length} 位选手，同一条起跑线。
          </p>
          <label className="field-label" htmlFor="bench-title">
            这场评测的名字
          </label>
          <input
            id="bench-title"
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="launch-summary">
            {tasks.map((t, i) => (
              <div key={i}>
                <FileText size={17} />
                <span>{t.title}</span>
                <Badge>{t.criteria.reduce((n, c) => n + c.maxScore, 0)} 分</Badge>
              </div>
            ))}
          </div>
          <div className="cast-list">
            {models
              .filter((m) => selected.includes(m.id))
              .map((m) => (
                <span key={m.id}>{m.name}</span>
              ))}
          </div>
          <div className="launch-note">
            <ShieldCheck size={19} />
            <p>
              将发起 {tasks.length * selected.length} 次 API 生成，使用你保存的
              Key，费用由服务商按实际用量收取。仅发送测试提示词与其中的材料；评分标准供评审使用。当前支持文本生成与单文件网页，不调用外部搜索工具。
            </p>
          </div>
        </section>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="wizard-footer">
        <span>
          <CheckCircle2 size={15} />
          {step === 0
            ? '先核对题目，再开启测试'
            : step === 1
              ? '模型由你选，身份由我们藏'
              : '打分之前，保持一点神秘感'}
        </span>
        <div>
          {step > 0 && (
            <button className="button secondary" disabled={busy} onClick={() => setStep(step - 1)}>
              <ArrowLeft size={16} />
              上一步
            </button>
          )}
          {step < 2 ? (
            <button className="button primary" onClick={next}>
              下一步
              <ArrowRight size={17} />
            </button>
          ) : (
            <button className="button primary" disabled={busy || !title.trim()} onClick={start}>
              <Rocket size={17} />
              {busy ? '正在开场…' : '开始并行测试'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
