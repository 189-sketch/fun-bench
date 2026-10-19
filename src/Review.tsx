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
  Lock,
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

// Reviewers give one holistic grade per output instead of scoring every criterion.
const LEVELS = [
  { label: '很差', value: 25 },
  { label: '一般', value: 50 },
  { label: '可以', value: 75 },
  { label: '非常好', value: 100 },
];
function levelLabel(value: number) {
  return LEVELS.reduce(
    (best, level) => (Math.abs(level.value - value) < Math.abs(best.value - value) ? level : best),
    LEVELS[0],
  ).label;
}

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
  // The reviewer follows the active task; a manual pick may look back at earlier ones.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
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
  const [celebrate, setCelebrate] = useState(0);
  // 正在重新开始的选手，避免重复点击重复提交。
  const [restartingId, setRestartingId] = useState('');
  const cardsRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef(false);
  // 轮询与揭晓、投票的响应可能乱序，用版本号丢弃过期响应。
  const version = useRef(0);
  const lockedRef = useRef('');
  const load = useCallback(async () => {
    if (activeRequest.current) return;
    activeRequest.current = true;
    const stamp = version.current;
    try {
      const data = await api<Bench>(base);
      if (stamp !== version.current) return;
      setBench(data);
      setError('');
      if (data.myBallot) {
        setScores(data.myBallot.scores);
        setComment(data.myBallot.comment);
      } else {
        // 已揭晓题目的分数以服务端锁定值为准，覆盖本地草稿。
        const locked = data.lockedScores ?? {};
        const signature = JSON.stringify(locked);
        if (signature !== lockedRef.current) {
          lockedRef.current = signature;
          setScores((current) => ({ ...current, ...locked }));
        }
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
  const generating =
    bench?.entries.some((e) => e.status === 'running' || e.status === 'queued') ?? false;
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => void load(), 1400);
    return () => clearInterval(timer);
  }, [generating, load]);
  useEffect(() => {
    if (bench && !bench.revealed)
      localStorage.setItem(`fb-draft-${reference}`, JSON.stringify(scores));
  }, [scores, bench, reference]);
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(0), 3500);
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
  const taskIndex =
    viewIndex !== null && viewIndex <= bench.activeIndex ? viewIndex : bench.activeIndex;
  const task = bench.tasks[taskIndex];
  const activeTask = bench.tasks[bench.activeIndex];
  const entries = bench.order[task.id].map((id) => bench.entries.find((e) => e.id === id)!);
  const doneEntries = bench.entries.filter((e) => e.status === 'done');
  const totalRatings = doneEntries.length;
  const rated = doneEntries.filter((e) => scores[e.id] !== undefined).length;
  const canSubmit = bench.status === 'done' && totalRatings > 0 && rated === totalRatings;
  const failed = bench.entries.filter((e) => e.status === 'failed').length;
  // 只有创建者能让掉线的选手重新开始：重新生成用的是创建者的 Key 和费用。
  const canRestart = bench.owner && !bench.revealed;
  const activeEntries = bench.entries.filter((e) => e.taskId === activeTask.id);
  const activeDone = activeEntries.filter((e) => e.status === 'done');
  const activeSettled = activeEntries.filter((e) => ['done', 'failed'].includes(e.status)).length;
  const activeGenerating = activeEntries.some((e) => ['queued', 'running'].includes(e.status));
  const activeFinished = activeEntries.every((e) => ['done', 'failed'].includes(e.status));
  const activeScoredCount = activeDone.filter((e) => scores[e.id] !== undefined).length;
  const activeScored = activeScoredCount === activeDone.length;
  const hasMoreTasks = bench.activeIndex < bench.tasks.length - 1;
  const canContinue = activeFinished && activeScored;
  // 正在看的那道题：进度、揭晓与卡片都指向它，避免各说各话。
  const viewEntries = bench.entries.filter((e) => e.taskId === task.id);
  const viewDone = viewEntries.filter((e) => e.status === 'done');
  const viewFailed = viewEntries.filter((e) => e.status === 'failed');
  const viewSettled = viewEntries.every((e) => ['done', 'failed'].includes(e.status));
  const viewScoredCount = viewDone.filter((e) => scores[e.id] !== undefined).length;
  const viewScored = viewScoredCount === viewDone.length;
  const taskRevealed = bench.revealed || bench.revealedTasks.includes(task.id);
  // 每一道题都单独揭晓过时，页面就是完整揭晓的样子，不必再说是“部分”。
  const allTasksRevealed =
    bench.tasks.length > 0 && bench.revealedTasks.length >= bench.tasks.length;
  const identityFullyVisible = bench.revealed || allTasksRevealed;
  const partialReveal = !identityFullyVisible && bench.revealedTasks.length > 0;
  const canRevealTask =
    !bench.revealed &&
    !taskRevealed &&
    viewSettled &&
    !viewFailed.length &&
    viewDone.length > 0 &&
    viewScored;
  const revealHint = taskRevealed
    ? '本题身份已揭晓，评分已锁定'
    : !viewSettled
      ? '选手们还没有作答完成'
      : viewFailed.length
        ? `有 ${viewFailed.length} 份成果未生成成功${canRestart ? '，可让他们重新开始' : ''}`
        : !viewScored
          ? '先给本题的成果打分，再揭晓'
          : '揭晓后本题评分将锁定';
  function taskComplete(t: Task & { id: string }) {
    const list = bench!.entries.filter((e) => e.taskId === t.id);
    if (list.some((e) => !['done', 'failed'].includes(e.status))) return false;
    return list.filter((e) => e.status === 'done').every((e) => scores[e.id] !== undefined);
  }
  function setScore(entryId: string, value: number | undefined) {
    if (taskRevealed) return;
    setScores((current) => {
      const next = { ...current };
      if (value === undefined) delete next[entryId];
      else next[entryId] = value;
      return next;
    });
  }
  // 单独揭晓一道题：先打分，再看它背后的模型，该题评分随即锁定。
  async function revealTask() {
    if (!canRevealTask || busy) return;
    setBusy(true);
    try {
      const taskScores = Object.fromEntries(
        entries.filter((e) => e.status === 'done').map((e) => [e.id, scores[e.id]]),
      );
      version.current += 1;
      const data = await api<Bench>(`${base}/reveal`, { taskId: task.id, scores: taskScores });
      // 揭晓先于轮询请求落地，作废两者之间返回的旧视图。
      version.current += 1;
      setBench(data);
      setCelebrate((n) => n + 1);
    } catch (e) {
      notify(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  async function vote() {
    setBusy(true);
    try {
      const validScores = Object.fromEntries(
        bench!.entries.filter((e) => e.status === 'done').map((e) => [e.id, scores[e.id]]),
      );
      version.current += 1;
      const data = await api<Bench>(`${base}/vote`, { scores: validScores, comment });
      version.current += 1;
      setBench(data);
      setSubmitOpen(false);
      setCelebrate((n) => n + 1);
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
  async function continueNext() {
    setBusy(true);
    try {
      await api(`/benches/${bench!.id}/next`, {});
      setViewIndex(null);
      await load();
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
      version.current += 1;
      const data = await api<Bench>(`/benches/${bench!.id}/retry`, {});
      version.current += 1;
      setBench(data);
      notify('掉线的选手正在重新开始');
    } catch (e) {
      notify(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  // 让掉线的选手重新开始：只重跑这一份成果，其它题目和评分都不受影响。
  async function retryEntry(entryId: string) {
    if (restartingId) return;
    setRestartingId(entryId);
    try {
      version.current += 1;
      const data = await api<Bench>(`/benches/${bench!.id}/entries/${entryId}/retry`, {});
      version.current += 1;
      setBench(data);
      notify('这位选手正在重新开始');
    } catch (e) {
      notify(reportError(e));
    } finally {
      setRestartingId('');
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
            {identityFullyVisible
              ? 'THE BIG REVEAL'
              : partialReveal
                ? 'PARTIAL REVEAL'
                : 'LET THE ANSWERS SPEAK'}
          </div>
          <h1>{bench.title}</h1>
          <p>
            {identityFullyVisible
              ? '名字揭晓了。你的判断，值得被看见。'
              : partialReveal
                ? '有的题目已经揭晓，其余仍在你手里。'
                : '先体验，再打分。你选的模型，正在匿名席上等你。'}
          </p>
        </div>
        <div className={`blind-status ${identityFullyVisible ? 'unlocked' : ''}`}>
          {identityFullyVisible ? (
            <Gift size={21} />
          ) : partialReveal ? (
            <Eye size={21} />
          ) : (
            <LockKeyhole size={21} />
          )}
          <div>
            <strong>
              {identityFullyVisible
                ? '身份已揭晓'
                : partialReveal
                  ? '部分题目已揭晓'
                  : '盲评进行中'}
            </strong>
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
      {activeGenerating && (
        <div className="generation-banner">
          <LoaderCircle size={19} className="spin" />
          <div>
            <strong>选手们正在作答第 {bench.activeIndex + 1} 题…</strong>
            <span>
              本题已完成 {activeSettled} / {activeEntries.length}{' '}
              份成果。作答结束后即可评分，再继续下一题。
            </span>
          </div>
          <div className="mini-progress">
            <i style={{ width: `${(activeSettled / activeEntries.length) * 100}%` }} />
          </div>
        </div>
      )}
      {failed > 0 && (
        <div className="failure-banner">
          <Flag size={19} />
          <p>
            {failed} 份成果未生成成功，不计入评分。
            {bench.revealed
              ? '本轮结果仅包含成功的成果。'
              : bench.owner
                ? '掉线的选手可以重新开始，其它成果照常评分。'
                : '创建者可以让掉线的选手重新开始。'}
          </p>
          {canRestart && (
            <button className="button secondary small" disabled={busy} onClick={retry}>
              <RotateCcw size={14} />
              全部重新开始
            </button>
          )}
        </div>
      )}
      {bench.tasks.length > 1 && (
        <div className="task-tabs" aria-label="测试题目">
          {bench.tasks.map((t, i) => {
            const started = i <= bench.activeIndex;
            const complete = started && taskComplete(t);
            const revealed = bench.revealed || bench.revealedTasks.includes(t.id);
            return (
              <button
                className={`${taskIndex === i ? 'active' : ''} ${started ? '' : 'locked'}`}
                key={t.id}
                disabled={!started}
                onClick={() => started && setViewIndex(i)}
              >
                <span>0{i + 1}</span>
                {t.title}
                {revealed ? (
                  <Eye size={14} />
                ) : started ? (
                  complete && <CheckCircle2 size={14} />
                ) : (
                  <Lock size={13} />
                )}
              </button>
            );
          })}
        </div>
      )}
      <details className="task-details">
        <summary>
          <span>
            <FileText size={17} />
            本题题目与评分依据
          </span>
          <span>
            {task.criteria.reduce((n, c) => n + c.maxScore, 0)} 分制 · 仅供参考
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
        <h2>
          {identityFullyVisible
            ? '回看这些答案'
            : taskRevealed
              ? '这一题，揭晓了。'
              : '神秘选手，已就位。'}
        </h2>
        <span>
          <ShieldCheck size={14} />
          {identityFullyVisible
            ? '评分已锁定，保留第一判断'
            : taskRevealed
              ? '本题身份已揭晓，评分已锁定'
              : taskIndex === bench.activeIndex
                ? '按整体印象给一个档位，不必逐条打分'
                : '这是已完成的题目，可回看或调整档位'}
        </span>
      </div>
      <div ref={cardsRef} className={`entry-grid count-${entries.length}`}>
        {entries.map((entry, index) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            index={index}
            task={task}
            identityVisible={taskRevealed}
            scoresLocked={taskRevealed}
            communityVisible={bench.revealed}
            animateReveal={celebrate > 0}
            average={bench.results?.find((r) => r.entryId === entry.id)?.average}
            voterCount={bench.voterCount}
            value={scores[entry.id]}
            setScore={(value) => setScore(entry.id, value)}
            canRestart={canRestart}
            restarting={restartingId === entry.id}
            onRetry={retryEntry}
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
          {hasMoreTasks ? (
            <div className="vote-dock">
              <div>
                <div className="vote-progress">
                  <span>本题评分进度</span>
                  <strong>
                    {viewScoredCount} / {viewDone.length}
                  </strong>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${viewDone.length ? (viewScoredCount / viewDone.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <small>
                  {taskIndex !== bench.activeIndex
                    ? `正在回看第 ${taskIndex + 1} 题，${
                        bench.owner ? '完成当前题后可继续下一道题' : '等待创建者继续下一道题'
                      }`
                    : !bench.owner
                      ? '等待创建者继续下一道题'
                      : activeGenerating
                        ? '选手们正在作答本题，作答结束后即可评分'
                        : !activeFinished
                          ? '本题尚未作答结束'
                          : !activeScored
                            ? `给本题的 ${activeDone.length} 份成果各选一个档位，再继续下一题`
                            : '本题已完成，点击继续下一道题'}
                </small>
              </div>
              <div className="vote-dock-actions">
                <div className="reveal-action">
                  <button
                    className="button secondary"
                    disabled={!canRevealTask || busy}
                    onClick={revealTask}
                    title={revealHint}
                  >
                    <Eye size={16} />
                    立即揭晓第 {taskIndex + 1} 题
                  </button>
                  <small className="reveal-hint">{revealHint}</small>
                </div>
                {bench.owner && (
                  <button
                    className="button primary large"
                    disabled={!canContinue || busy}
                    onClick={continueNext}
                  >
                    <ArrowRight size={19} />
                    继续测试下一个
                    <ArrowRight size={17} />
                  </button>
                )}
              </div>
            </div>
          ) : (
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
                        : '给每份成果选一个档位，即可揭晓'}
                </small>
              </div>
              <div className="vote-dock-actions">
                <div className="reveal-action">
                  <button
                    className="button secondary"
                    disabled={!canRevealTask || busy}
                    onClick={revealTask}
                    title={revealHint}
                  >
                    <Eye size={16} />
                    立即揭晓第 {taskIndex + 1} 题
                  </button>
                  <small className="reveal-hint">{revealHint}</small>
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
            </div>
          )}
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
  identityVisible,
  scoresLocked,
  communityVisible,
  animateReveal,
  average,
  voterCount,
  value,
  setScore,
  canRestart,
  restarting,
  onRetry,
}: {
  entry: Entry;
  index: number;
  task: Task;
  identityVisible: boolean;
  scoresLocked: boolean;
  communityVisible: boolean;
  animateReveal: boolean;
  average?: number | null;
  voterCount?: number;
  value: number | undefined;
  setScore: (value: number | undefined) => void;
  canRestart: boolean;
  restarting: boolean;
  onRetry: (entryId: string) => void;
}) {
  const [tab, setTab] = useState<'preview' | 'raw'>('preview');
  const [reset, setReset] = useState(0);
  const [full, setFull] = useState(false);
  const [faceRevealed, setFaceRevealed] = useState(identityVisible);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playing = identityVisible && animateReveal && !reducedMotion;
  const showIdentity = identityVisible && (!playing || faceRevealed);
  useEffect(() => {
    if (!playing) return;
    // Swap identities at the edge of the turn, while the card face is out of view.
    const timer = setTimeout(() => setFaceRevealed(true), 800 + index * 180);
    return () => clearTimeout(timer);
  }, [playing, index]);
  const letter = String.fromCharCode(65 + index);
  // 掉线后重新开始的选手，用不同的文案说明 TA 正在第二次作答。
  const restarted = (entry.attempts ?? 1) > 1;
  const complete = value !== undefined;
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
            {communityVisible && (
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
              <strong>{scoresLocked ? '你的评分' : '你的直觉，值几分？'}</strong>
              <span>
                {value === undefined ? (
                  '-'
                ) : (
                  <>
                    {levelLabel(value)}
                    <small> · {value} / 100</small>
                  </>
                )}
              </span>
            </div>
            <div className="fuzzy-score" role="group" aria-label={`选手 ${letter} 评分`}>
              {LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  className={value === level.value ? 'active' : ''}
                  disabled={scoresLocked}
                  aria-pressed={value === level.value}
                  onClick={() => setScore(value === level.value ? undefined : level.value)}
                >
                  <span>{level.label}</span>
                  <small>{level.value}</small>
                </button>
              ))}
            </div>
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
              {canRestart && (
                <>
                  <button
                    className="button secondary small"
                    disabled={restarting}
                    onClick={() => onRetry(entry.id)}
                  >
                    <RotateCcw size={14} />
                    {restarting ? '正在重新开始…' : '重新开始'}
                  </button>
                  <small className="entry-hint">重新开始会重新生成这一份成果，成功后即可评分</small>
                </>
              )}
            </>
          ) : (
            <>
              <div className="thinking-character">
                <div />
                <div />
              </div>
              <h3>
                {entry.status === 'queued'
                  ? restarted
                    ? '正在重新候场…'
                    : '正在候场…'
                  : restarted
                    ? '正在重新作答…'
                    : '正在认真作答…'}
              </h3>
              <p>
                {entry.outputChars
                  ? `已收到 ${entry.outputChars.toLocaleString()} 字符，仍在生成…`
                  : restarted
                    ? '上一次掉线了，这次重新来过。'
                    : '先藏好名字，再交出答案。复杂任务可能需要较长时间，最多等待 30 分钟。'}
              </p>
              <LoaderCircle size={19} className="spin" />
            </>
          )}
        </div>
      )}
      {full && (
        <Modal
          title={`选手 ${letter} · ${identityVisible ? entry.model?.name : '匿名成果'}`}
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
