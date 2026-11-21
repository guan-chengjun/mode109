// 诊断 GLB 归一化后的真实包围盒与根朝向，定位侧翻问题
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

// 读取 ModelManager 归一化模板的包围盒、根四元数，以及一台上路 GLB 车的世界姿态
const result = await evalJs(`(() => {
  const THREE = window.__THREE__;
  const app = window.__simApp;
  const mm = app.models;
  const tpl = mm.template;
  const out = { status: mm.status };
  if (tpl) {
    tpl.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tpl);
    const size = new THREE.Vector3();
    box.getSize(size);
    out.templateBox = { min: box.min.toArray().map(n=>+n.toFixed(2)), max: box.max.toArray().map(n=>+n.toFixed(2)), size: size.toArray().map(n=>+n.toFixed(2)) };
    out.templateQuat = tpl.children[0].quaternion.toArray().map(n=>+n.toFixed(3));
    out.templateScale = tpl.children[0].scale.toArray().map(n=>+n.toFixed(3));
  }
  const car = app.traffic.vehicles.find(v => v.isGlb);
  if (car) {
    const g = car.group;
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3();
    box.getSize(size);
    out.carBox = { size: size.toArray().map(n=>+n.toFixed(2)), minY: +box.min.y.toFixed(2) };
    out.carPos = g.position.toArray().map(n=>+n.toFixed(2));
    out.carWorldQuat = g.getWorldQuaternion(new THREE.Quaternion()).toArray().map(n=>+n.toFixed(3));
    const fwd = g.getWorldDirection(new THREE.Vector3());
    out.carForward = fwd.toArray().map(n=>+n.toFixed(3));
  }
  return out;
})()`);

console.log(JSON.stringify(result, null, 2));
ws.close();
