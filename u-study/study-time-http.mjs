// The local server authenticates the request before dispatching this namespace.
async function input(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > 16384) throw Object.assign(new Error('学习时长请求过大。'), { status: 413 });
    chunks.push(chunk);
  }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('学习时长请求格式无效。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('学习时长请求格式无效。');
  return data;
}

export async function handleStudyTimeRequest(req, res, pathname, controller, send) {
  const route = pathname.slice('/api/study-time'.length);
  if (req.method === 'GET' && route === '/state') { send(res, 200, await controller.state()); return; }
  if (req.method === 'GET' && route === '/diagnostics') { send(res, 200, await controller.diagnostics()); return; }
  if (req.method !== 'POST') { send(res, 405, { error: '不支持此请求方法。' }); return; }
  const data = await input(req);
  if (route === '/window') { send(res, 200, await controller.connect()); return; }
  if (route === '/catalog') { send(res, 200, await controller.loadCatalog(data)); return; }
  if (route === '/progress') { send(res, 200, await controller.refreshProgress(data)); return; }
  if (route === '/tasks') { send(res, 202, { task: await controller.start(data) }); return; }
  const match = route.match(/^\/tasks\/([\w-]{1,100})\/(pause|resume|stop)$/);
  if (match) { send(res, 200, { task: await controller.control(match[1], match[2]) }); return; }
  send(res, 404, { error: '学习时长接口不存在。' });
}
