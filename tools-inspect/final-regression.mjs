// 最终回归：清空后重新生成（验证共享几何未被误释放）、时间流速、全景与路口截图
const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
ws.addEventListener('error', (e) => {
  console.error('WebSocket error:', e.message ?? e.type ?? e);
});
const openTimeout = setTimeout(() => {
  console.error('WebSocket open timeout, readyState=', ws.readyState);
  process.exit(4);
}, 10000);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
clearTimeout(openTimeout);
await send('Runtime.enable');
// 目标由 /json/new?<appUrl> 创建，无需再 Page.navigate（导航会重建 target 使连接失效）
await new Promise((r) => setTimeout(r, 14000));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __evalError: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};
const { writeFileSync } = await import('node:fs');
const shot = async (path) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(s.data, 'base64'));
};

const out = {};
// 清空 -> 新增 12 台（含 GLB），验证几何仍有效
await evalJs(`document.getElementById('btn-clear').click()`);
for (let k = 0; k < 12; k++) await evalJs(`document.getElementById('btn-add').click()`);
await new Promise((r) => setTimeout(r, 1500));
out.afterRespawn = await evalJs(`(() => {
  const vs = window.__simApp.traffic.vehicles;
  return { count: vs.length, glbCount: vs.filter(v => v.isGlb).length, errors: window.__errors || [] };
})()`);

// 时间流速滑杆
await evalJs(`const t=document.getElementById('slider-time'); t.value=3; t.dispatchEvent(new Event('input'));`);
out.timeScale = await evalJs(`window.__simApp.panel.state.timeScale`);
// 高速运行 2s 后确认无异常、车辆仍在移动
const moved = await evalJs(`(async () => {
  const p1 = window.__simApp.traffic.vehicles[0].group.position.clone();
  await new Promise(r => setTimeout(r, 2000));
  const p2 = window.__simApp.traffic.vehicles[0].group.position.clone();
  return +p1.distanceTo(p2).toFixed(2);
})()`);
out.movedAt3x = moved;
out.errorsAfter = await evalJs(`window.__errors || []`);

// 全景截图（默认机位）
await evalJs(`(() => { const s = window.__simApp.sceneManager; s.camera.position.set(150,130,170); s.controls.target.set(0,0,0); s.controls.update(); })()`);
await new Promise((r) => setTimeout(r, 500));
await shot(process.argv[3]);

console.log(JSON.stringify(out, null, 2));
ws.close();
if (out.errorsAfter?.length) process.exit(1);
