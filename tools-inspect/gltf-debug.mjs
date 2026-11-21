// 直接在页面里用 GLTFLoader 加载 GLB，捕获真实报错
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
await new Promise((r) => setTimeout(r, 4000));

const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

const result = await evalJs(`(async () => {
  try {
    const mod = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new mod.GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/ferrari.glb',
        resolve,
        undefined,
        reject,
      );
    });
    return { ok: true, meshes: gltf.scene.children.length, name: gltf.scene.children[0]?.name };
  } catch (e) {
    return { ok: false, name: e?.name, message: e?.message, stack: String(e?.stack).split('\\n').slice(0, 4) };
  }
})()`);

console.log(JSON.stringify(result, null, 2));
ws.close();
