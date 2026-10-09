import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generate, generationError } from '../server/providers.mjs';

async function upstream(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;

test('both protocols decode fragmented UTF-8 SSE, ignore thinking and ping, track progress and truncation', async (t) => {
  for (const protocol of ['openai', 'anthropic']) {
    const baseUrl = await upstream(t, async (req, res) => {
      let request = '';
      for await (const chunk of req) request += chunk;
      assert.equal(JSON.parse(request).stream, true);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const text =
        protocol === 'openai'
          ? event({ choices: [{ index: 0, delta: { content: '中文🎉' }, finish_reason: null }] }) +
            event({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }) +
            'data: [DONE]\r\n\r\n'
          : event({ type: 'ping' }) +
            event({ type: 'content_block_start', content_block: { type: 'text', text: '中' } }) +
            event({
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 'secret reasoning' },
            }) +
            event({ type: 'content_block_delta', delta: { type: 'text_delta', text: '文🎉' } }) +
            event({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }) +
            event({ type: 'message_stop' });
      const bytes = Buffer.from(text);
      const split = bytes.indexOf(Buffer.from('中')) + 1;
      res.write(bytes.subarray(0, split));
      await new Promise((resolve) => setTimeout(resolve, 10));
      res.write(bytes.subarray(split, split + 2));
      res.end(bytes.subarray(split + 2));
    });
    const progress = [];
    const result = await generate(
      { protocol, baseUrl, model: 'mock', maxTokens: 1_000_000 },
      'test-key',
      'test',
      { onProgress: (size) => progress.push(size) },
    );
    assert.deepEqual(result, { content: '中文🎉', truncated: true });
    assert.equal(progress.at(-1), result.content.length);
  }
});

test('stream errors, malformed events and incomplete connections never become successful partial artifacts', async (t) => {
  for (const end of [
    '',
    event({ type: 'error', error: { message: 'secret key and model' } }),
    'data: not-json\n\n',
  ]) {
    const baseUrl = await upstream(t, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(event({ choices: [{ delta: { content: 'partial' } }] }) + end);
    });
    await assert.rejects(
      generate({ protocol: 'openai', baseUrl, model: 'mock', maxTokens: 4096 }, 'test-key', 'test'),
      (error) => error.name === 'ProviderError' && !generationError(error).includes('secret'),
    );
  }
});

test('token parameter rejection is actionable without exposing upstream secrets', async (t) => {
  const baseUrl = await upstream(t, (_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'max_tokens exceeds model limit: secret-model, key=private-secret' },
      }),
    );
  });
  await assert.rejects(
    generate(
      { protocol: 'anthropic', baseUrl, model: 'mock', maxTokens: 1_000_000 },
      'test-key',
      'test',
    ),
    (error) => {
      const message = generationError(error);
      assert.match(message, /输出 Tokens 参数被拒绝/);
      assert.doesNotMatch(message, /secret/);
      return true;
    },
  );
});

test('abort remains effective while consuming a stream, with a clear timeout message', async (t) => {
  const baseUrl = await upstream(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting\n\n');
  });
  await assert.rejects(
    generate({ protocol: 'openai', baseUrl, model: 'mock', maxTokens: 4096 }, 'test-key', 'test', {
      signal: AbortSignal.timeout(50),
    }),
    (error) => /30 分钟/.test(generationError(error)),
  );
});
