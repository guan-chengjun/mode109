// 找到一台 GLB 车辆，把相机移到它斜后方低位特写，验证车头朝向与接地
const wsUrl = process.argv[2];
const shotPath = process.argv[3];
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

const info = await evalJs(`(() => {
  const THREE = window.__THREE__;
  const app = window.__simApp;
  const glbCar = app.traffic.vehicles.find(v => v.isGlb);
  if (!glbCar) return { found: false };
  const p = glbCar.group.position.clone();
  const fwd = glbCar.group.getWorldDirection(new THREE.Vector3());
  // 相机置于车辆后方 14m、高 7m，注视车辆，可看到车尾与行驶方向是否一致
  const camPos = p.clone().addScaledVector(fwd, -14).add(new THREE.Vector3(0, 7, 0));
  const sm = app.sceneManager;
  sm.camera.position.copy(camPos);
  sm.controls.target.copy(p);
  sm.controls.update();
  return {
    found: true,
    pos: p.toArray().map(n => +n.toFixed(2)),
    forward: fwd.toArray().map(n => +n.toFixed(2)),
    // 模板内前大灯节点相对中心的位置，确认车头在本地 +Z
  };
})()`);

// 再单独读取模板前大灯的本地 Z 符号
const lamp = await evalJs(`(() => {
  const THREE = window.__THREE__;
  const tpl = window.__simApp.models.template;
  const lampNode = tpl.getObjectByName('lights');
  if (!lampNode) return null;
  const wp = new THREE.Vector3();
  lampNode.getWorldPosition(wp);
  const box = new THREE.Box3().setFromObject(tpl);
  const c = new THREE.Vector3();
  box.getCenter(c);
  return { lampZ: +(wp.z - c.z).toFixed(2), lampY: +(wp.y).toFixed(2) };
})()`);

await new Promise((r) => setTimeout(r, 600));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ info, lamp }));
ws.close();
