import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileText,
  FlaskConical,
  HelpCircle,
  Layers3,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trophy,
  Users,
  WandSparkles,
} from 'lucide-react';
import type { BenchSummary, ModelConfig } from './types';
import { api, reportError } from './api';
import { AGENT_PROMPT } from './import';
import { Badge, Loading, Logo, Modal, MysteryArt, Toast } from './ui';
import Models from './Models';
import Create from './Create';
import Review from './Review';

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [benches, setBenches] = useState<BenchSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  const clearToast = useCallback(() => setToast(''), []);
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([
        api<ModelConfig[]>('/models'),
        api<BenchSummary[]>('/benches'),
      ]);
      setModels(m);
      setBenches(b);
      setLoadError('');
      setLoaded(true);
    } catch (e) {
      setLoadError(reportError(e));
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const pop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', pop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', pop);
    };
  }, [refresh]);
  function navigate(to: string) {
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
    void refresh();
  }
  async function demo() {
    try {
      const { id } = await api<{ id: string }>('/demo', {});
      navigate(`/bench/${id}`);
    } catch (e) {
      notify(reportError(e));
    }
  }
  const review = /^\/(bench|play)\/([^/]+)$/.exec(path);
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <button className="logo-button" aria-label="Fun Bench 首页" onClick={() => navigate('/')}>
            <Logo />
          </button>
          <nav aria-label="主导航">
            <button className={path === '/' ? 'active' : ''} onClick={() => navigate('/')}>
              <FlaskConical size={16} />
              我的评测
            </button>
            <button
              className={path === '/models' ? 'active' : ''}
              onClick={() => navigate('/models')}
            >
              <Settings2 size={16} />
              模型设置<span className="nav-count">{models.length}</span>
            </button>
          </nav>
          <div className="header-right">
            <button className="help-button" onClick={() => setHelp(true)}>
              <HelpCircle size={17} />
              <span>怎么玩</span>
            </button>
            <button className="button dark header-create" onClick={() => navigate('/new')}>
              <Plus size={16} />
              新建评测
            </button>
          </div>
        </div>
      </header>
      <main className={`main-container ${review ? 'review-container' : ''}`}>
        {loadError && (
          <div className="error-banner" role="alert">
            {loadError}
            <button className="text-button" onClick={() => void refresh()}>
              重试连接
            </button>
          </div>
        )}
        {!loaded ? (
          <Loading />
        ) : review ? (
          <Review
            key={review[2]}
            reference={review[2]}
            shared={review[1] === 'play'}
            navigate={navigate}
            notify={notify}
            onSubmitted={refresh}
          />
        ) : path === '/models' ? (
          <Models models={models} refresh={refresh} notify={notify} />
        ) : path === '/new' ? (
          <Create models={models} navigate={navigate} notify={notify} />
        ) : (
          <Home
            benches={benches}
            models={models.length}
            navigate={navigate}
            demo={demo}
            help={() => setHelp(true)}
          />
        )}
      </main>
      <footer className="site-footer">
        <Logo small />
        <span>真实任务，匿名答案，你的判断。</span>
        <button onClick={() => setHelp(true)}>
          保持好奇，保持一点神秘感
          <ArrowUpRight size={13} />
        </button>
      </footer>
      {toast && <Toast message={toast} onClose={clearToast} />}
      {help && (
        <Modal title="答案先说话，名字晚点见。" wide onClose={() => setHelp(false)}>
          <p className="muted">把你真实的工作，变成一场属于自己的模型盲评。</p>
          <div className="how-steps">
            {[
              {
                icon: Copy,
                title: '01 / 让 Agent 出题',
                text: '复制下方提示词，交给熟悉你的 Agent，获得自包含的测试题和评分标准。',
              },
              {
                icon: Users,
                title: '02 / 指定模型参赛',
                text: '回到这里导入题目，选择你配置的模型，逐题测试，一题接一题。',
              },
              {
                icon: Trophy,
                title: '03 / 打分，然后揭晓',
                text: '体验匿名成果，用整体档位打分，点“继续测试下一个”进入下一题。提交后，看看谁更懂你的工作。',
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon size={22} />
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <label className="field-label" htmlFor="agent-prompt">
            复制给你自己的 Agent
          </label>
          <textarea id="agent-prompt" className="prompt-copy" readOnly value={AGENT_PROMPT} />
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(AGENT_PROMPT);
                  notify('出题提示词已复制');
                } catch {
                  notify('请选中文本并手动复制');
                }
              }}
            >
              <Copy size={16} />
              复制提示词
            </button>
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                navigate('/new');
              }}
            >
              我有题目了
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Home({
  benches,
  models,
  navigate,
  demo,
  help,
}: {
  benches: BenchSummary[];
  models: number;
  navigate: (p: string) => void;
  demo: () => Promise<void>;
  help: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const rated = benches.filter((b) => b.revealed).length;
  const filtered = benches.filter(
    (b) =>
      (filter === 'all' || (filter === 'rated' ? b.revealed : !b.revealed)) &&
      b.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="live-dot" />A LITTLE MYSTERY. A BETTER BENCHMARK.
          </div>
          <h1>
            别看名字。
            <br />
            看看谁
            <span className="underline-word">
              真的懂你
              <svg viewBox="0 0 300 16" preserveAspectRatio="none">
                <path d="M3 10Q120 0 296 7M20 15Q180 3 275 12" />
              </svg>
            </span>
            。
          </h1>
          <p>
            用你的真实任务，考考你选的 AI。
            <br />
            匿名体验，凭实力打分，最后揭晓神秘选手。
          </p>
          <div className="hero-actions">
            <button className="button primary large" onClick={() => navigate('/new')}>
              <Plus size={18} />
              开启我的评测
              <ArrowRight size={17} />
            </button>
            <button
              className="button ghost"
              disabled={demoBusy}
              onClick={async () => {
                setDemoBusy(true);
                await demo();
                setDemoBusy(false);
              }}
            >
              <Sparkles size={17} />
              {demoBusy ? '准备中…' : '先玩一场演示'}
            </button>
          </div>
          <div className="hero-footnote">
            <span className="tiny-avatars">
              <i>A</i>
              <i>B</i>
              <i>?</i>
            </span>
            <span>模型由你选。谁是谁，打完分再说。</span>
          </div>
        </div>
        <MysteryArt />
      </section>
      <section className="journey-strip" aria-label="评测流程">
        <button onClick={help}>
          <span className="journey-number">01</span>
          <div>
            <strong>让 Agent 出题</strong>
            <small>从真实工作里，找到好问题</small>
          </div>
          <Copy size={19} />
        </button>
        <ChevronRight size={16} />
        <button onClick={() => navigate('/new')}>
          <span className="journey-number">02</span>
          <div>
            <strong>邀请模型开场</strong>
            <small>同一份题目，各自交出答案</small>
          </div>
          <Users size={19} />
        </button>
        <ChevronRight size={16} />
        <button
          onClick={() => {
            document.getElementById('my-benches')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <span className="journey-number">03</span>
          <div>
            <strong>先打分，再揭晓</strong>
            <small>把品牌放一边，相信你的判断</small>
          </div>
          <WandSparkles size={19} />
        </button>
      </section>
      <section className="bench-section" id="my-benches">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR LITTLE EXPERIMENTS</div>
            <h2>
              我的评测<span>{benches.length}</span>
            </h2>
          </div>
          <div className="workspace-stats">
            <span>
              <Layers3 size={15} />
              {models} 个模型
            </span>
            <span>
              <Trophy size={15} />
              {rated} 场已揭晓
            </span>
          </div>
        </div>
        <div className="list-toolbar">
          <div className="filter-tabs">
            {[
              ['all', '全部评测'],
              ['pending', '待评分'],
              ['rated', '已揭晓'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
                {value === 'pending' && benches.some((b) => !b.revealed) && (
                  <span className="tab-dot" />
                )}
              </button>
            ))}
          </div>
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索评测"
              placeholder="找一场评测…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {filtered.length ? (
          <div className="bench-grid">
            {filtered.map((bench, i) => (
              <button
                className="bench-card"
                key={bench.id}
                onClick={() => navigate(`/bench/${bench.id}`)}
              >
                <div className="bench-card-top">
                  <span className={`bench-symbol color-${i % 3}`}>
                    {bench.revealed ? <Trophy size={24} /> : <FlaskConical size={24} />}
                  </span>
                  <Badge
                    tone={
                      bench.revealed ? 'green' : bench.status === 'running' ? 'orange' : 'neutral'
                    }
                  >
                    {bench.revealed ? '已揭晓' : bench.status === 'running' ? '生成中' : '等你打分'}
                  </Badge>
                </div>
                <h3>{bench.title}</h3>
                <div className="bench-meta">
                  <span>{bench.taskCount} 道题</span>
                  <i />
                  <span>{bench.modelCount} 位选手</span>
                  {bench.demo && <Badge>演示</Badge>}
                </div>
                <div className="bench-card-foot">
                  <span>
                    {new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
                      new Date(bench.createdAt),
                    )}
                  </span>
                  <strong>
                    {bench.revealed ? '查看结果' : '进入盲评'}
                    <ArrowUpRight size={16} />
                  </strong>
                </div>
              </button>
            ))}
            <button className="new-bench-card" onClick={() => navigate('/new')}>
              <Plus size={25} />
              <strong>下一个问题，交给你。</strong>
              <span>用真实任务开启一场新评测</span>
            </button>
          </div>
        ) : benches.length ? (
          <div className="empty-state small-empty">
            <Search size={30} />
            <h3>这里还没有匹配的评测</h3>
            <p>试试其他关键词，或切换筛选条件。</p>
            <button
              className="text-button"
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
            >
              查看全部
            </button>
          </div>
        ) : (
          <div className="first-bench">
            <div className="first-bench-art">
              <FileText size={29} />
              <span>?</span>
              <Check size={22} />
            </div>
            <div>
              <h3>你的第一个真问题，就是最好的起点。</h3>
              <p>导入 Agent 为你准备的题目，看看哪个模型更适合你的工作。</p>
            </div>
            <button className="button secondary" onClick={() => navigate('/new')}>
              创建第一场评测
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </section>
      <div className="bottom-note">
        <span>BUILT FOR YOUR REAL WORLD</span>
        <p>没有标准答案的模型榜单，有属于你的判断。</p>
        <button onClick={help}>
          获取出题提示词
          <ArrowUpRight size={14} />
        </button>
      </div>
    </>
  );
}
