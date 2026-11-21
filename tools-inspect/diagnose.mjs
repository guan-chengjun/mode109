// 网络与动态行为诊断：在页面真实环境里测试 GLB 可达性、采样信号灯状态与车辆运动
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
await new Promise((r) => setTimeout(r, 6000));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    return { __evalError: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  }
  return r.result.value;
};

// 1. 页面环境内直接 fetch GLB，判断是网络问题还是加载器问题
const fetchTest = await evalJs(`(async () => {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/ferrari.glb');
    const buf = await r.arrayBuffer();
    return { ok: r.ok, status: r.status, bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`);

// 2. 采样 6 秒内车辆位置，确认确实在运动；同时统计车辆速度分布
const movement = await evalJs(`(async () => {
  const app = window.__simApp;
  const snap = () => app.traffic.vehicles.slice(0, 5).map(v => {
    const p = v.group.position; // 直接读取已同步的渲染位置
    return [+p.x.toFixed(2), +p.z.toFixed(2), +v.speed.toFixed(2)];
  });
  const before = snap();
  await new Promise(r => setTimeout(r, 6000));
  const after = snap();
  const speeds = app.traffic.vehicles.map(v => +v.speed.toFixed(2));
  const stopped = speeds.filter(s => s < 0.1).length;
  return { before, after, total: speeds.length, stopped, minSpeed: Math.min(...speeds), maxSpeed: Math.max(...speeds) };
})()`);

// 3. 信号灯状态采样：连续读取中心路口四个进口灯态，确认会变化
const signalTest = await evalJs(`(async () => {
  const app = window.__simApp;
  const read = () => {
    const sys = app.signals;
    return ['E','W','S','N'].map(a => sys.getState(1, 1, a));
  };
  const samples = [read()];
  for (let k = 0; k < 4; k++) {
    await new Promise(r => setTimeout(r, 4200));
    samples.push(read());
  }
  return samples;
})()`);

// 4. 车辆当前所在边类型统计（确认会进入 connection 边完成转向）
const edgeKinds = await evalJs(`(() => {
  const kinds = {};
  for (const v of window.__simApp.traffic.vehicles) kinds[v.currentEdge.kind] = (kinds[v.currentEdge.kind] || 0) + 1;
  return kinds;
})()`);

console.log(JSON.stringify({ fetchTest, movement, signalTest, edgeKinds }, null, 2));
ws.close();
