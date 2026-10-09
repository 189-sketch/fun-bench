import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { createStore } from '../server/store.mjs';

const mock = createServer(async (req, res) => {
  let text = '';
  for await (const part of req) text += part;
  const body = JSON.parse(text);
  if (body.model.includes('slow')) {
    if (!body.stream) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Non-streaming gateway timeout' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keep-alive\n\n');
    res.write(
      req.url.endsWith('/messages')
        ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"流式成果"}}\n\n'
        : 'data: {"choices":[{"delta":{"content":"流式成果"},"finish_reason":null}]}\n\n',
    );
    await new Promise((resolve) => setTimeout(resolve, 2800));
    if (req.url.endsWith('/messages')) {
      res.write(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"已完成"}}\n\n',
      );
      res.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
      res.end('data: {"type":"message_stop"}\n\n');
    } else {
      res.write('data: {"choices":[{"delta":{"content":"已完成"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.end('data: [DONE]\n\n');
    }
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 650));
  res.setHeader('Content-Type', 'application/json');
  if (body.model.includes('fail')) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: `secret: ${req.headers.authorization}` }));
    return;
  }
  const content =
    '# 访谈分析\n\n真实问题是信息汇总耗时、版本冲突和任务阻塞不可见。\n\n| 问题 | 原文证据 | 优先级 |\n|---|---|---|\n| 汇总耗时 | 每周两小时 | 高 |\n| 版本冲突 | 两个人改同一份内容 | 高 |\n\n建议先支持共享进度摘要和阻塞标记，再验证群聊需求。';
  res.end(
    JSON.stringify(
      req.url.endsWith('/messages')
        ? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content }, finish_reason: 'stop' }] },
    ),
  );
});
mock.listen(4174, '127.0.0.1');
const store = createStore(mkdtempSync(join(tmpdir(), 'fun-bench-e2e-')));
const server = createApp(store).listen(4173, '127.0.0.1');
function stop() {
  server.close();
  mock.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
