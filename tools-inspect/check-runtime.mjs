// 运行时自检：通过 CDP 连接无头 Chrome，采集页面异常、仿真状态并截图
// 用法: node tools-inspect/check-runtime.mjs <wsDebugUrl> [shotPath]
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

const consoleErrors = [];
const runtimeErrors = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
// 目标由调用方通过 /json/new?<appUrl> 创建，避免 Page.navigate 重建 target

// 等待页面初始化、DRACO 解码与模型加载（软件渲染较慢，等待 18s）
await new Promise((r) => setTimeout(r, 18000));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) return { __evalError: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

const state = await evalJs(`(() => {
  const app = window.__simApp;
  return {
    debug: app ? app.getDebugInfo() : null,
    errors: window.__errors || [],
    hasCanvas: !!document.querySelector('#scene-container canvas'),
    panelVisible: !document.getElementById('panel').hidden,
    loadingHidden: document.getElementById('loading').hidden,
  };
})()`);

// 让相机俯视最近的路口，检查信号灯与车辆细节
await evalJs(`(() => {
  const s = window.__simApp.sceneManager;
  s.camera.position.set(40, 55, 60);
  s.controls.target.set(0, 0, 0);
  s.controls.update();
})()`);
if (shotPath) {
  await new Promise((r) => setTimeout(r, 800));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
}

console.log(JSON.stringify({ consoleErrors, runtimeErrors, state }, null, 2));
ws.close();

const fail =
  consoleErrors.length > 0 ||
  runtimeErrors.length > 0 ||
  (state?.errors?.length ?? 0) > 0 ||
  !state?.hasCanvas;
process.exit(fail ? 1 : 0);
