import { endpoint } from './domain.mjs';

export const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_CHARS = 16_000_000;

function providerError(message) {
  const error = new Error(message);
  error.name = 'ProviderError';
  return error;
}

export function generationError(error) {
  if (['TimeoutError', 'AbortError'].includes(error.name))
    return '生成超过 30 分钟，连接已结束，请稍后重试';
  if (error.name === 'ProviderError' || error.message?.startsWith('模型配置')) return error.message;
  return '连接中断或无法连接服务，请检查网络和模型配置后重试';
}

async function httpError(response) {
  // Classify known problems without exposing keys or model identities in upstream bodies.
  const detail = (await response.text()).slice(0, 16_000);
  if ([400, 422].includes(response.status)) {
    if (/max[_ ](?:completion[_ ])?tokens/i.test(detail))
      return providerError(
        `服务返回 HTTP ${response.status}：输出 Tokens 参数被拒绝，请按服务商支持的上限和参数配置模型后新建评测`,
      );
    return providerError(
      `服务返回 HTTP ${response.status}：请求参数被拒绝，请检查输出 Tokens 上限、模型 ID 和所选协议`,
    );
  }
  if ([408, 504].includes(response.status))
    return providerError(`服务返回 HTTP ${response.status}：上游网关等待超时，请稍后重试`);
  return providerError(`服务返回 HTTP ${response.status}，请检查模型配置或额度`);
}

async function readStream(response, protocol, append) {
  const decoder = new TextDecoder();
  let buffer = '',
    dataLines = [],
    complete = false,
    stopReason;
  function event() {
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data === '[DONE]') {
      complete = true;
      return;
    }
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      throw providerError('服务返回了无法解析的流式数据，请检查协议兼容性');
    }
    if (value.error || value.type === 'error')
      throw providerError('服务在生成过程中返回错误，请稍后重试或检查服务额度');
    if (protocol === 'openai') {
      const choice = value.choices?.find((c) => c.index === 0) || value.choices?.[0];
      if (typeof choice?.delta?.content === 'string') append(choice.delta.content);
      if (choice?.finish_reason) {
        stopReason = choice.finish_reason;
        complete = true;
      }
    } else {
      if (value.type === 'content_block_start' && value.content_block?.type === 'text')
        append(value.content_block.text || '');
      if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta')
        append(value.delta.text || '');
      if (value.type === 'message_delta') stopReason = value.delta?.stop_reason || stopReason;
      if (value.type === 'message_stop') complete = true;
    }
  }
  function line(text) {
    if (text === '') event();
    else if (text.startsWith('data:')) dataLines.push(text.slice(5).replace(/^ /, ''));
  }
  function consume(text) {
    buffer += text;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      line(buffer.slice(0, end).replace(/\r$/, ''));
      buffer = buffer.slice(end + 1);
    }
    if (buffer.length > MAX_OUTPUT_CHARS) throw providerError('返回内容超出 1600 万字符限制');
  }
  for await (const chunk of response.body) consume(decoder.decode(chunk, { stream: true }));
  consume(decoder.decode());
  if (buffer) line(buffer.replace(/\r$/, ''));
  event();
  if (!complete) throw providerError('服务的流式连接提前结束，成果不完整，请重试');
  return stopReason;
}

export async function generate(model, key, prompt, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const tokenParameter =
    model.protocol === 'openai' && model.tokenParameter === 'max_completion_tokens'
      ? 'max_completion_tokens'
      : 'max_tokens';
  const body = {
    model: model.model,
    messages: [{ role: 'user', content: prompt }],
    [tokenParameter]: model.maxTokens,
    stream: true,
  };
  if (model.protocol === 'openai') headers.Authorization = `Bearer ${key}`;
  else {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  }
  const response = await fetch(endpoint(model.baseUrl, model.protocol), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'error',
    signal: options.signal || AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  if (!response.ok) throw await httpError(response);
  let content = '',
    stopReason;
  function append(text) {
    content += text;
    if (content.length > MAX_OUTPUT_CHARS) throw providerError('返回内容超出 1600 万字符限制');
    options.onProgress?.(content.length);
  }
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    stopReason = await readStream(response, model.protocol, append);
  } else {
    // Some compatible gateways ignore stream=true and return a complete JSON response.
    const data = await response.json();
    const parts = model.protocol === 'openai' ? data.choices?.[0]?.message?.content : data.content;
    append(
      typeof parts === 'string'
        ? parts
        : Array.isArray(parts)
          ? parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join('\n')
          : '',
    );
    stopReason = model.protocol === 'openai' ? data.choices?.[0]?.finish_reason : data.stop_reason;
  }
  if (!content.trim()) throw providerError('服务未返回可展示的文本内容');
  return { content, truncated: ['length', 'max_tokens'].includes(stopReason) };
}
