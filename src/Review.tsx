import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Expand,
  Eye,
  FileText,
  Flag,
  Gift,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { Bench, Entry, Scores, Task } from './types';
import { api, reportError } from './api';
import { Badge, Loading, Modal } from './ui';

export default function Review({
  reference,
  shared,
  navigate,
  notify,
  onSubmitted,
}: {
  reference: string;
  shared: boolean;
  navigate: (p: string) => void;
  notify: (s: string) => void;
  onSubmitted: () => Promise<void>;
}) {
  const base = `/${shared ? 'reviews' : 'benches'}/${reference}`;
  const [bench, setBench] = useState<Bench | null>(null);
  const [error, setError] = useState('');
  const [taskIndex, setTaskIndex] = useState(0);
  const [scores, setScores] = useState<Scores>(() => {
    try {
      return JSON.parse(localStorage.getItem(`fb-draft-${reference}`) || '{}');
    } catch {
      return {};
    }
  });
  const [comment, setComment] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const cardsRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef(false);
  const load = useCallback(async () => {
    if (activeRequest.current) return;
    activeRequest.current = true;
    try {
      const data = await api<Bench>(base);
      setBench(data);
      setError('');
      if (data.myBallot) {
        setScores(data.myBallot.scores);
        setComment(data.myBallot.comment);
      }
    } catch (e) {
      setError(reportError(e));
    } finally {
      activeRequest.current = false;
    }
  }, [base]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (bench?.status !== 'running') return;
    const timer = setInterval(() => void load(), 1400);
    return () => clearInterval(timer);
  }, [bench?.status, load]);
  useEffect(() => {
    if (bench && !bench.revealed)
      localStorage.setItem(`fb-draft-${reference}`, JSON.stringify(scores));
  }, [scores, bench, reference]);
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 3500);
    return () => clearTimeout(timer);
  }, [celebrate]);
  if (!bench)
    return error ? (
      <div className="empty-state">
        <LockKeyhole size={32} />
        <h2>这场评测暂时无法打开</h2>
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => void load()}>
          重新加载
        </button>
        <button className="text-button" onClick={() => navigate('/')}>
          回到首页
        </button>
      </div>
    ) : (
      <Loading text="正在准备神秘选手的成果…" />
    );
  const task = bench.tasks[taskIndex];
  const entries = bench.order[task.id].map((id) => bench.entries.find((e) => e.id === id)!);
  const doneEntries = bench.entries.filter((e) => e.status === 'done');
  const totalRatings = doneEntries.reduce(
    (n, e) => n + bench.tasks.find((t) => t.id === e.taskId)!.criteria.length,
    0,
  );
  const rated = doneEntries.reduce(
    (n, e) =>
      n +
      bench.tasks
        .find((t) => t.id === e.taskId)!
        .criteria.filter((_, i) => scores[e.id]?.[String(i)] !== undefined).length,
    0,
  );
  const canSubmit = bench.status === 'done' && totalRatings > 0 && rated === totalRatings;
  const failed = bench.entries.filter((e) => e.status === 'failed').length;
  function setScore(entryId: string, criterion: number, value: number | undefined) {
    setScores((current) => {
      const entryScores = { ...current[entryId] };
      if (value === undefined) delete entryScores[String(criterion)];
      else entryScores[String(criterion)] = value;
      return { ...current, [entryId]: entryScores };
    });
  }
  async function vote() {
    setBusy(true);
    try {
      const validScores = Object.fromEntries(
        bench!.entries.filter((e) => e.status === 'done').map((e) => [e.id, scores[e.id]]),
      );
      const data = await api<Bench>(`${base}/vote`, { scores: validScores, comment });
      setBench(data);
      setSubmitOpen(false);
      setCelebrate(true);
      localStorage.removeItem(`fb-draft-${reference}`);
      void onSubmitted();
      requestAnimationFrame(() =>
        cardsRef.current?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        }),
      );
    } catch (e) {
      notify(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const path = shared
        ? `/play/${reference}`
        : (await api<{ path: string }>(`/benches/${bench!.id}/share`, {})).path;
      setShareUrl(new URL(path, window.location.origin).href);
      setShareOpen(true);
    } catch (e) {
      notify(reportError(e));
    } finally {
      setShareBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      await api(`/benches/${bench!.id}/retry`, {});
      await load();
    } catch (e) {
      notify(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="review-topline">
        <button className="back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          {shared ? 'Fun Bench 首页' : '我的评测'}
        </button>
        <div>
          {bench.demo && <Badge tone="orange">演示 · 手工制作的虚构选手作品</Badge>}
          <button className="button secondary small" disabled={shareBusy} onClick={share}>
            <Share2 size={15} />
            {shareBusy ? '准备链接…' : '邀请朋友盲评'}
          </button>
        </div>
      </div>
      <div className="review-heading">
        <div>
          <div className="eyebrow">
            {bench.revealed ? 'THE BIG REVEAL' : 'LET THE ANSWERS SPEAK'}
          </div>
          <h1>{bench.title}</h1>
          <p>
            {bench.revealed
              ? '名字揭晓了。你的判断，值得被看见。'
              : '先体验，再打分。你选的模型，正在匿名席上等你。'}
          </p>
        </div>
        <div className={`blind-status ${bench.revealed ? 'unlocked' : ''}`}>
          {bench.revealed ? <Gift size={21} /> : <LockKeyhole size={21} />}
          <div>
            <strong>{bench.revealed ? '身份已揭晓' : '盲评进行中'}</strong>
            <span>
              {bench.participantCount} 位选手 · {bench.tasks.length} 道题目
            </span>
          </div>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {bench.status === 'running' && (
        <div className="generation-banner">
          <LoaderCircle size={19} className="spin" />
          <div>
            <strong>选手们正在同时作答…</strong>
            <span>
              已完成 {doneEntries.length} / {bench.entries.length}{' '}
              份成果。可以先看已完成的答案，全部结束后提交评分。
            </span>
          </div>
          <div className="mini-progress">
            <i
              style={{ width: `${((doneEntries.length + failed) / bench.entries.length) * 100}%` }}
            />
          </div>
        </div>
      )}
      {failed > 0 && bench.status === 'done' && (
        <div className="failure-banner">
          <Flag size={19} />
          <p>
            {failed} 份成果未生成成功，不计入评分。
            {bench.revealed ? '本轮结果仅包含成功的成果。' : '你可以先处理失败，或评价已有成果。'}
          </p>
          {bench.owner && !bench.revealed && (
            <button className="button secondary small" disabled={busy} onClick={retry}>
              <RotateCcw size={14} />
              重试失败项
            </button>
          )}
        </div>
      )}
      {bench.tasks.length > 1 && (
        <div className="task-tabs" aria-label="测试题目">
          {bench.tasks.map((t, i) => {
            const total =
              bench.entries.filter((e) => e.taskId === t.id && e.status === 'done').length *
              t.criteria.length;
            const count = bench.entries
              .filter((e) => e.taskId === t.id && e.status === 'done')
              .reduce(
                (n, e) =>
                  n + t.criteria.filter((_, ci) => scores[e.id]?.[String(ci)] !== undefined).length,
                0,
              );
            return (
              <button
                className={taskIndex === i ? 'active' : ''}
                key={t.id}
                onClick={() => setTaskIndex(i)}
              >
                <span>0{i + 1}</span>
                {t.title}
                {total > 0 && count === total && <CheckCircle2 size={14} />}
              </button>
            );
          })}
        </div>
      )}
      <details className="task-details">
        <summary>
          <span>
            <FileText size={17} />
            本轮题目与评分依据
          </span>
          <span>
            {task.criteria.reduce((n, c) => n + c.maxScore, 0)} 分制
            <ChevronDown size={17} />
          </span>
        </summary>
        <div className="task-details-content">
          <div>
            <h3>测试提示词</h3>
            <pre>{task.prompt}</pre>
          </div>
          <div>
            <h3>原始评分标准</h3>
            <Markdown>{task.evaluation}</Markdown>
            <div className="criteria-pills">
              {task.criteria.map((c, i) => (
                <span key={i}>
                  {c.name}
                  <strong>{c.maxScore}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      </details>
      <div className="comparison-title">
        <h2>{bench.revealed ? '回看这些答案' : '神秘选手，已就位。'}</h2>
        <span>
          <ShieldCheck size={14} />
          {bench.revealed ? '评分已锁定，保留第一判断' : '随机排列 · 提交评分后揭晓'}
        </span>
      </div>
      <div ref={cardsRef} className={`entry-grid count-${entries.length}`}>
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            index={index}
            task={task}
            revealed={bench.revealed}
            animateReveal={celebrate}
            average={bench.results?.find((r) => r.entryId === entry.id)?.average}
            voterCount={bench.voterCount}
            values={scores[entry.id] || {}}
            setScore={(ci, value) => setScore(entry.id, ci, value)}
          />
        ))}
      </div>
      {bench.revealed && bench.myBallot?.comment && (
        <p className="locked-comment">你的评语：{bench.myBallot.comment}</p>
      )}
      {!bench.revealed ? (
        <>
          <section className="panel comment-panel">
            <label htmlFor="review-comment">
              <Sparkles size={17} />
              记录一下，你为什么这样选？<span>选填</span>
            </label>
            <textarea
              id="review-comment"
              rows={2}
              maxLength={2000}
              placeholder="哪份答案真正帮到了你？有没有让你惊喜或失望的细节？"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </section>
          <div className="vote-dock">
            <div>
              <div className="vote-progress">
                <span>你的评分进度</span>
                <strong>
                  {rated} / {totalRatings}
                </strong>
              </div>
              <div className="progress-track">
                <i style={{ width: `${totalRatings ? (rated / totalRatings) * 100 : 0}%` }} />
              </div>
              <small>
                {bench.status === 'running'
                  ? '等待选手全部交卷，评分草稿会保留'
                  : !totalRatings
                    ? '没有可评分的成果，请检查模型设置或重试'
                    : canSubmit
                      ? '准备好了吗？答案马上揭晓。'
                      : '完成每份成果的所有评分项，即可揭晓'}
              </small>
            </div>
            <button
              className="button primary large"
              disabled={!canSubmit || busy}
              onClick={() => setSubmitOpen(true)}
            >
              <Gift size={19} />
              提交评分，揭晓身份
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      ) : (
        <div className="after-review">
          <div>
            <Sparkles size={24} />
            <div>
              <h3>好奇心，不止这一场。</h3>
              <p>邀请朋友给这些答案打分，看看他们会不会和你选一样。</p>
            </div>
          </div>
          <button className="button secondary" onClick={share}>
            <Share2 size={16} />
            邀请朋友
          </button>
          <button className="button primary" onClick={() => navigate('/new')}>
            开启下一场
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {submitOpen && (
        <Modal title="准备揭晓神秘选手？" onClose={() => !busy && setSubmitOpen(false)}>
          <div className="reveal-modal-art">
            <Gift size={44} />
            <span>?</span>
          </div>
          <p className="muted">
            你已完成 {doneEntries.length}{' '}
            份成果的评分。提交后锁定本轮判断，再揭晓每份答案背后的模型。
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setSubmitOpen(false)}
            >
              再看一眼
            </button>
            <button className="button primary" disabled={busy} onClick={vote}>
              <Send size={16} />
              {busy ? '正在揭晓…' : '确认评分并揭晓'}
            </button>
          </div>
        </Modal>
      )}
      {shareOpen && (
        <Modal title="邀请朋友，来一次独立判断。" onClose={() => setShareOpen(false)}>
          <p className="muted">
            拿到链接的人可以查看本场题目、材料和匿名成果。他们完成自己的评分后才会揭晓身份，你的评分不会提前显示。
          </p>
          <label className="field-label" htmlFor="share-url">
            评审链接
          </label>
          <input id="share-url" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <small className="field-help">其他设备访问时，需要能连接到运行本项目的服务器。</small>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setShareOpen(false)}>
              完成
            </button>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  notify('邀请链接已复制，给朋友留点悬念');
                } catch {
                  notify('请选中链接手动复制');
                }
              }}
            >
              <Copy size={16} />
              复制邀请链接
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function secureHtml(content: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none';">`;
  return /<head[\s>]/i.test(content)
    ? content.replace(/<head[^>]*>/i, (head) => head + csp)
    : csp + content;
}

function EntryCard({
  entry,
  index,
  task,
  revealed,
  animateReveal,
  average,
  voterCount,
  values,
  setScore,
}: {
  entry: Entry;
  index: number;
  task: Task;
  revealed: boolean;
  animateReveal: boolean;
  average?: number | null;
  voterCount?: number;
  values: Record<string, number>;
  setScore: (index: number, score: number | undefined) => void;
}) {
  const [tab, setTab] = useState<'preview' | 'raw'>('preview');
  const [reset, setReset] = useState(0);
  const [full, setFull] = useState(false);
  const [faceRevealed, setFaceRevealed] = useState(revealed);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playing = revealed && animateReveal && !reducedMotion;
  const showIdentity = revealed && (!playing || faceRevealed);
  useEffect(() => {
    if (!playing) return;
    // Swap identities at the edge of the turn, while the card face is out of view.
    const timer = setTimeout(() => setFaceRevealed(true), 800 + index * 180);
    return () => clearTimeout(timer);
  }, [playing, index]);
  const letter = String.fromCharCode(65 + index);
  const complete = task.criteria.every((_, i) => values[String(i)] !== undefined);
  const html = entry.html ? secureHtml(entry.html) : '';
  function download() {
    const url = URL.createObjectURL(
      new Blob([entry.html || entry.content || ''], {
        type: entry.html ? 'text/html' : 'text/plain',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `fun-bench-${letter}.${entry.html ? 'html' : 'md'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const preview = (expanded = false) =>
    entry.html && tab === 'preview' ? (
      <iframe
        key={`${reset}-${expanded}`}
        title={`选手 ${letter} 成果${expanded ? '全屏' : ''}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={html}
      />
    ) : (
      <div className="markdown-output">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            img: ({ alt }) => <span className="muted">[图片：{alt || '外部图片未自动加载'}]</span>,
          }}
        >
          {entry.content || ''}
        </Markdown>
      </div>
    );
  return (
    <article
      className={`entry-card entry-${index % 3} ${complete ? 'scored' : ''} ${playing ? 'reveal-playing' : ''} ${showIdentity ? 'identity-revealed' : ''}`}
      style={{ animationDelay: `${index * 180}ms` }}
      data-reveal-phase={playing ? (showIdentity ? 'unmasked' : 'turning') : 'idle'}
    >
      <div className="entry-head">
        <span className="entry-letter">{letter}</span>
        <div>
          <h3>{showIdentity ? entry.model?.name : `神秘选手 ${letter}`}</h3>
          <span>{showIdentity ? entry.model?.model : '身份保密中'}</span>
        </div>
        {showIdentity ? (
          <Badge tone="green">
            <Sparkles size={12} />
            已揭晓
          </Badge>
        ) : complete ? (
          <span className="scored-check">
            <Check size={14} />
            已评分
          </span>
        ) : (
          <LockKeyhole size={16} className="muted" />
        )}
      </div>
      {entry.status === 'done' ? (
        <>
          <div className="entry-toolbar">
            <div>
              {entry.html ? (
                <>
                  <button
                    className={tab === 'preview' ? 'active' : ''}
                    onClick={() => setTab('preview')}
                  >
                    <Eye size={13} />
                    体验成果
                  </button>
                  <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>
                    <FileText size={13} />
                    原始回答
                  </button>
                </>
              ) : (
                <span>完整回答</span>
              )}
            </div>
            <div>
              {entry.html && (
                <button aria-label={`重置选手 ${letter} 成果`} onClick={() => setReset(reset + 1)}>
                  <RotateCcw size={14} />
                </button>
              )}
              <button aria-label={`下载选手 ${letter} 成果`} onClick={download}>
                <Download size={14} />
              </button>
              <button aria-label={`全屏查看选手 ${letter}`} onClick={() => setFull(true)}>
                <Expand size={14} />
              </button>
            </div>
          </div>
          <div className="entry-preview">{preview()}</div>
          {entry.truncated && (
            <div className="truncated-note">达到输出长度上限，成果可能不完整。</div>
          )}
          {task.format === 'html' && !entry.html && (
            <div className="truncated-note">未找到完整 HTML，已展示原始回答。</div>
          )}
          <div className="score-panel">
            {revealed && (
              <div
                className="card-community-score"
                style={{ visibility: showIdentity ? 'visible' : 'hidden' }}
              >
                <span>
                  <ShieldCheck size={14} />
                  {voterCount} 人盲评均分
                </span>
                <strong>
                  {average?.toFixed(1) ?? '-'}
                  <small> / 100</small>
                </strong>
              </div>
            )}
            <div className="score-title">
              <strong>{revealed ? '你的评分' : '你的直觉，值几分？'}</strong>
              <span>
                {Object.keys(values).length
                  ? Object.values(values).reduce((a, b) => a + b, 0)
                  : '-'}
                <small> / {task.criteria.reduce((n, c) => n + c.maxScore, 0)}</small>
              </span>
            </div>
            {task.criteria.map((criterion, ci) => (
              <div className="score-row" key={ci}>
                <div className="score-label">
                  <label htmlFor={`score-${entry.id}-${ci}`}>{criterion.name}</label>
                  <span>
                    {values[String(ci)] === undefined ? '未评分' : `${values[String(ci)]} 分`}
                  </span>
                </div>
                <p>{criterion.description}</p>
                <div className="score-control">
                  <input
                    id={`score-${entry.id}-${ci}`}
                    type="range"
                    min={0}
                    max={criterion.maxScore}
                    step={1}
                    value={values[String(ci)] ?? 0}
                    disabled={revealed}
                    aria-label={`选手 ${letter} ${criterion.name}`}
                    aria-valuetext={
                      values[String(ci)] === undefined ? '尚未评分' : `${values[String(ci)]} 分`
                    }
                    onChange={(e) => setScore(ci, Number(e.target.value))}
                    onPointerUp={(e) => {
                      if (!revealed) setScore(ci, Number(e.currentTarget.value));
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={criterion.maxScore}
                    step={1}
                    placeholder="-"
                    value={values[String(ci)] ?? ''}
                    disabled={revealed}
                    aria-label={`选手 ${letter} ${criterion.name} 分数`}
                    onChange={(e) => {
                      if (e.target.value === '') setScore(ci, undefined);
                      else {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n >= 0 && n <= criterion.maxScore)
                          setScore(ci, n);
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={`entry-placeholder ${entry.status === 'failed' ? 'failed' : ''}`}>
          {entry.status === 'failed' ? (
            <>
              <Flag size={31} />
              <h3>这位选手暂时掉线了</h3>
              <p>{entry.error}</p>
              <Badge>不计入评分</Badge>
            </>
          ) : (
            <>
              <div className="thinking-character">
                <div />
                <div />
              </div>
              <h3>{entry.status === 'queued' ? '正在候场…' : '正在认真作答…'}</h3>
              <p>
                {entry.outputChars
                  ? `已收到 ${entry.outputChars.toLocaleString()} 字符，仍在生成…`
                  : '先藏好名字，再交出答案。复杂任务可能需要较长时间，最多等待 30 分钟。'}
              </p>
              <LoaderCircle size={19} className="spin" />
            </>
          )}
        </div>
      )}
      {full && (
        <Modal
          title={`选手 ${letter} · ${revealed ? entry.model?.name : '匿名成果'}`}
          wide
          onClose={() => setFull(false)}
        >
          <div className="fullscreen-preview">{preview(true)}</div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setFull(false)}>
              <X size={15} />
              回到对比
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
