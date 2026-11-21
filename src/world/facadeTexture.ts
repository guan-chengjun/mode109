import * as THREE from 'three';

/**
 * 程序化建筑立面纹理
 * 用 Canvas 绘制墙体 + 网格窗，作为 PBR 材质的颜色贴图，
 * 避免引入外部图片资源；不同楼层/窗色生成若干变体随机分配。
 */

const PALETTES: Array<{ wall: string; window: string; windowLit: string }> = [
  { wall: '#b8c2cc', window: '#33475b', windowLit: '#ffe6a3' },
  { wall: '#d8d2c4', window: '#445566', windowLit: '#ffd98a' },
  { wall: '#9fb0bf', window: '#2c3e50', windowLit: '#fff0c0' },
  { wall: '#c9b8a8', window: '#3a4a5a', windowLit: '#ffdf9e' },
  { wall: '#a7b3a5', window: '#2f4252', windowLit: '#ffe2a0' },
  { wall: '#cfd6dd', window: '#3d4f5f', windowLit: '#ffedbb' },
];

const cache = new Map<number, THREE.CanvasTexture>();

/**
 * 生成/取缓存一张立面纹理
 * @param seed 变体编号
 * @param litRatio 亮灯窗户比例（夜间氛围点缀，白天也保持少量暖窗）
 */
export function getFacadeTexture(seed: number, litRatio = 0.12): THREE.CanvasTexture {
  const key = seed * 100 + Math.round(litRatio * 100);
  const hit = cache.get(key);
  if (hit) return hit;

  const palette = PALETTES[seed % PALETTES.length];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // 墙体底色
  ctx.fillStyle = palette.wall;
  ctx.fillRect(0, 0, 256, 256);

  // 轻微噪点，避免纯色塑料感
  for (let n = 0; n < 900; n++) {
    const shade = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.03)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }

  // 窗网格：8 列 × 10 行
  const cols = 8;
  const rows = 10;
  const padX = 14;
  const padY = 12;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (256 - padY * 2) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * cellW + cellW * 0.18;
      const y = padY + r * cellH + cellH * 0.2;
      const w = cellW * 0.64;
      const h = cellH * 0.58;
      ctx.fillStyle = Math.random() < litRatio ? palette.windowLit : palette.window;
      ctx.fillRect(x, y, w, h);
      // 窗框高光
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
