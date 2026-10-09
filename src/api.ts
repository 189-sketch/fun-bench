export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: '服务响应异常，请确认后台正在运行' }));
  if (!response.ok) throw new Error(data.error || '请求失败，请重试');
  return data;
}

export function reportError(error: unknown) {
  console.error('[Fun Bench]', error instanceof Error ? error.message : 'Unknown error');
  return error instanceof Error ? error.message : '操作失败，请重试';
}
