// 面板交互自检：暂停/继续、新增车辆、清空车辆、滑杆
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
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5174/' });
await new Promise((r) => setTimeout(r, 12000));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __evalError: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

const results = {};

// 初始状态
results.initial = await evalJs(`window.__simApp.getDebugInfo()`);

// 1. 暂停
await evalJs(`document.getElementById('btn-toggle').click()`);
results.afterPause = await evalJs(`({ paused: window.__simApp.getDebugInfo().paused, btnText: document.getElementById('btn-toggle').textContent })`);
// 暂停时位置应不变
const posFrozen = await evalJs(`(async () => {
  const p1 = window.__simApp.traffic.vehicles[0].group.position.clone();
  await new Promise(r => setTimeout(r, 1500));
  const p2 = window.__simApp.traffic.vehicles[0].group.position.clone();
  return p1.distanceTo(p2);
})()`);
results.moveWhilePaused = posFrozen;

// 继续
await evalJs(`document.getElementById('btn-toggle').click()`);
results.afterResume = await evalJs(`window.__simApp.getDebugInfo().paused`);

// 2. 新增车辆（连点 5 次）
await evalJs(`for (let k=0;k<5;k++) document.getElementById('btn-add').click()`);
results.afterAdd = await evalJs(`({ count: window.__simApp.traffic.vehicles.length, panel: document.getElementById('stat-vehicles').textContent })`);

// 3. 速度滑杆
await evalJs(`const s=document.getElementById('slider-speed'); s.value=1.8; s.dispatchEvent(new Event('input')); window.__simApp.panel.state.speedScale`);
results.speedScale = await evalJs(`window.__simApp.panel.state.speedScale`);

// 4. 清空车辆
await evalJs(`document.getElementById('btn-clear').click()`);
results.afterClear = await evalJs(`({ count: window.__simApp.traffic.vehicles.length, panel: document.getElementById('stat-vehicles').textContent })`);

console.log(JSON.stringify(results, null, 2));
ws.close();
