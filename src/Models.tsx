import { useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Cpu,
  ArrowRight,
  Eye,
  EyeOff,
  Server,
  Cable,
  PlugZap,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
} from 'lucide-react';
import type { ModelConfig, ModelTestResult, Protocol } from './types';
import { api, reportError } from './api';
import { Badge, Modal } from './ui';

type TestState = { pending: boolean; result?: ModelTestResult };

function excerpt(text?: string, max = 48) {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function Models({
  models,
  refresh,
  notify,
}: {
  models: ModelConfig[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [editing, setEditing] = useState<ModelConfig | 'new' | null>(null);
  const [removing, setRemoving] = useState<ModelConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  async function testModel(model: ModelConfig) {
    setTests((prev) => ({ ...prev, [model.id]: { pending: true } }));
    try {
      const result = await api<ModelTestResult>(`/models/${model.id}/test`, {});
      setTests((prev) => ({ ...prev, [model.id]: { pending: false, result } }));
    } catch (e) {
      const result: ModelTestResult = { ok: false, error: reportError(e) };
      setTests((prev) => ({ ...prev, [model.id]: { pending: false, result } }));
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/models/${removing.id}`, {}, 'DELETE');
      await refresh();
      setRemoving(null);
      notify('模型配置已移除');
    } catch (e) {
      notify(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CAST, YOUR CHOICE</div>
          <h1>谁来接受挑战？</h1>
          <p>接入你常用的模型，把选择权握在自己手里。</p>
        </div>
        <button className="button primary" onClick={() => setEditing('new')}>
          <Plus size={18} />
          添加模型
        </button>
      </div>
      <div className="info-strip">
        <KeyRound size={18} />
        <span>API Key 加密保存在服务端，浏览器只显示保存状态。</span>
        <span className="protocol-note">OpenAI / Anthropic 兼容协议</span>
      </div>
      {models.length ? (
        <div className="model-grid">
          {models.map((model, i) => {
            const state = tests[model.id];
            const result = state?.result;
            return (
              <article className="model-card" key={model.id}>
                <div className="model-card-top">
                  <span className={`model-avatar color-${i % 3}`}>
                    <Cpu size={24} />
                  </span>
                  <Badge tone={model.protocol === 'openai' ? 'green' : 'orange'}>
                    {model.protocol === 'openai' ? 'OpenAI' : 'Anthropic'} 协议
                  </Badge>
                </div>
                <h3>{model.name}</h3>
                <code className="model-code">{model.model}</code>
                <div className="model-endpoint">
                  <Server size={14} />
                  <span>{model.baseUrl}</span>
                </div>
                <div className="model-card-foot">
                  <span>
                    <KeyRound size={13} />
                    Key 已保存 · {model.maxTokens.toLocaleString()} tokens
                  </span>
                  <div>
                    <button
                      className="test-button"
                      aria-label={`测试 ${model.name} 连接`}
                      disabled={state?.pending}
                      onClick={() => void testModel(model)}
                    >
                      {state?.pending ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : (
                        <PlugZap size={13} />
                      )}
                      测试
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`编辑 ${model.name}`}
                      onClick={() => setEditing(model)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`移除 ${model.name}`}
                      onClick={() => setRemoving(model)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {result && (
                  <p className={`test-result ${result.ok ? 'ok' : 'fail'}`} role="status">
                    {result.ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
                    <span>
                      {result.ok
                        ? `连接正常 · ${((result.latency ?? 0) / 1000).toFixed(1)}s · 回复「${excerpt(result.reply)}」`
                        : result.error}
                    </span>
                  </p>
                )}
              </article>
            );
          })}
          <button className="add-model-card" onClick={() => setEditing('new')}>
            <Plus size={27} />
            <strong>再邀请一位选手</strong>
            <span>你的模型，你来定义</span>
          </button>
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <Cable size={34} />
          </span>
          <h2>选手席位，虚位以待</h2>
          <p>
            添加至少两个模型，就能开启你的第一场盲评。
            <br />
            官方 API、兼容网关、本地服务都可以。
          </p>
          <button className="button dark" onClick={() => setEditing('new')}>
            添加第一个模型
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {editing && (
        <ModelForm
          model={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
            notify('模型配置已保存');
          }}
        />
      )}
      {removing && (
        <Modal title="移除这个模型配置？" onClose={() => setRemoving(null)}>
          <p className="muted">将移除「{removing.name}」和保存的 Key。已有成果和评分会保留。</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setRemoving(null)}>
              保留
            </button>
            <button className="button primary" disabled={busy} onClick={remove}>
              {busy ? '移除中…' : '确认移除'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ModelForm({
  model,
  onClose,
  onSaved,
}: {
  model?: ModelConfig;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [protocol, setProtocol] = useState<Protocol>(model?.protocol || 'openai');
  const [name, setName] = useState(model?.name || '');
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl || 'https://api.openai.com/v1');
  const [modelId, setModelId] = useState(model?.model || '');
  const [key, setKey] = useState('');
  const [maxTokens, setMaxTokens] = useState(model?.maxTokens || 4096);
  const [tokenParameter, setTokenParameter] = useState(model?.tokenParameter || 'max_tokens');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestState>({ pending: false });
  const canTest = Boolean(baseUrl.trim() && modelId.trim() && (key.trim() || model));
  function changeProtocol(value: Protocol) {
    setProtocol(value);
    setTest({ pending: false });
    if (['https://api.openai.com/v1', 'https://api.anthropic.com'].includes(baseUrl))
      setBaseUrl(value === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com');
  }
  async function runTest() {
    setTest({ pending: true });
    try {
      const result = await api<ModelTestResult>('/models/test', {
        id: model?.id,
        protocol,
        baseUrl,
        model: modelId,
        key: key || undefined,
        maxTokens,
        tokenParameter,
      });
      setTest({ pending: false, result });
    } catch (e) {
      setTest({ pending: false, result: { ok: false, error: reportError(e) } });
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        model ? `/models/${model.id}` : '/models',
        {
          name,
          protocol,
          baseUrl,
          model: modelId,
          key: key || undefined,
          maxTokens,
          tokenParameter,
        },
        model ? 'PUT' : 'POST',
      );
      await onSaved();
    } catch (e) {
      setError(reportError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={model ? '编辑模型' : '邀请一位新选手'} onClose={onClose}>
      <form onSubmit={save} onChange={() => setTest({ pending: false })}>
        <p className="muted modal-description">连接你的 API。评分揭晓前，选手身份由我们保密。</p>
        <label className="field-label">兼容协议</label>
        <div className="segmented">
          {(['openai', 'anthropic'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={protocol === p ? 'active' : ''}
              onClick={() => changeProtocol(p)}
            >
              {p === 'openai' ? 'OpenAI' : 'Anthropic'}
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor="model-name">
          显示名称
        </label>
        <input
          id="model-name"
          required
          maxLength={80}
          placeholder="例如：我的 Claude / 本地 Qwen"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="field-label" htmlFor="base-url">
          Base URL
        </label>
        <input
          id="base-url"
          type="url"
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <small className="field-help">填写服务根地址或 /v1 地址，系统自动补全协议路径。</small>
        <label className="field-label" htmlFor="model-id">
          Model ID
        </label>
        <input
          id="model-id"
          required
          maxLength={150}
          placeholder="服务商提供的准确模型标识"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />
        <label className="field-label" htmlFor="api-key">
          API Key {model && <span className="muted">· 留空保留原 Key</span>}
        </label>
        <div className="password-field">
          <input
            id="api-key"
            autoComplete="new-password"
            type={showKey ? 'text' : 'password'}
            required={!model}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={model ? '已加密保存' : '输入 API Key'}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={showKey ? '隐藏 Key' : '显示 Key'}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="test-box">
          <div className="test-box-head">
            <button
              className="button secondary small"
              type="button"
              disabled={!canTest || test.pending}
              onClick={() => void runTest()}
            >
              {test.pending ? <LoaderCircle className="spin" size={15} /> : <PlugZap size={15} />}
              {test.pending ? '测试中…' : '测试连接'}
            </button>
            <small className="muted">
              {canTest
                ? '发送一次真实请求，检查地址、Key 和模型是否可用。'
                : '填写 Base URL、Model ID 和 API Key 后即可测试。'}
            </small>
          </div>
          {test.result && (
            <p className={`test-result ${test.result.ok ? 'ok' : 'fail'}`} role="status">
              {test.result.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
              <span>
                {test.result.ok
                  ? `连接正常 · ${((test.result.latency ?? 0) / 1000).toFixed(1)}s · 回复「${excerpt(test.result.reply, 80)}」`
                  : test.result.error}
              </span>
            </p>
          )}
        </div>
        <label className="field-label" htmlFor="max-tokens">
          最大输出 Tokens
        </label>
        <input
          id="max-tokens"
          type="number"
          min={256}
          max={1_000_000}
          step={1}
          required
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
        />
        <small className="field-help">
          最高可填 1M（1,000,000），实际值需在服务商支持的输出上限内；过大可能被接口拒绝。
        </small>
        {protocol === 'openai' && (
          <>
            <label className="field-label" htmlFor="token-parameter">
              输出限制参数
            </label>
            <select
              id="token-parameter"
              value={tokenParameter}
              onChange={(e) => setTokenParameter(e.target.value as ModelConfig['tokenParameter'])}
            >
              <option value="max_tokens">max_tokens · 通用兼容接口</option>
              <option value="max_completion_tokens">max_completion_tokens · 部分推理模型</option>
            </select>
            <small className="field-help">按服务商文档选择；不确定时先使用通用参数。</small>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '保存中…' : '保存模型'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
