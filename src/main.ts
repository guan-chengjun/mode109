import './styles.css';
import * as THREE from 'three';
import { SimulationApp } from './core/SimulationApp';

// 纯前端入口：页面打开即初始化仿真，无登录、无路由、无弹窗
const container = document.getElementById('scene-container');
if (!container) {
  throw new Error('缺少 #scene-container 挂载节点');
}

const app = new SimulationApp();
app
  .start(container)
  .catch((err) => {
    console.error('仿真启动失败：', err);
    const text = document.getElementById('loading-text');
    if (text) text.textContent = '场景初始化失败，请查看控制台日志。';
  });

// 开发环境下挂到 window，便于控制台/无头浏览器自检
if (import.meta.env.DEV) {
  (window as unknown as { __simApp: SimulationApp; __THREE__: typeof THREE }).__simApp = app;
  (window as unknown as { __THREE__: typeof THREE }).__THREE__ = THREE;
}

// 捕获运行时错误并挂到 window，供自动化自检读取
window.addEventListener('error', (e) => {
  const bucket = ((window as unknown as { __errors: string[] }).__errors ??= []);
  bucket.push(String(e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  const bucket = ((window as unknown as { __errors: string[] }).__errors ??= []);
  bucket.push('Promise: ' + String(e.reason));
});
