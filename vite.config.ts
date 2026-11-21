import { defineConfig } from 'vite';

// 纯前端 Vite 配置：无需后端，dev 打开即进入仿真场景
export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
