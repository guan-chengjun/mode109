import * as THREE from 'three';
import { CAR_TYPES, type CarTypeName } from '../config/constants';

/** 车辆外观描述：车型 + 车身颜色（远程 GLB 模型仅颜色无法重涂时忽略颜色） */
export interface VehicleVisual {
  type: CarTypeName;
  color: number;
}

const materialCache = new Map<number, THREE.MeshStandardMaterial>();

function bodyMaterial(color: number): THREE.MeshStandardMaterial {
  let m = materialCache.get(color);
  if (!m) {
    // PBR 车身：金属漆质感
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.6,
      roughness: 0.35,
    });
    materialCache.set(color, m);
  }
  return m;
}

/** 共享材质：玻璃、轮胎、车灯等与车身颜色无关，全局复用减少 draw call */
const shared = {
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x1f2d3d,
    metalness: 0.1,
    roughness: 0.08,
    transparent: true,
    opacity: 0.75,
  }),
  tire: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.05 }),
  hub: new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.85, roughness: 0.3 }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xffe9a8,
    emissiveIntensity: 0.9,
  }),
  taillight: new THREE.MeshStandardMaterial({
    color: 0x8b1a1a,
    emissive: 0xff2222,
    emissiveIntensity: 0.7,
  }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.8 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 四轮：车轮轴沿 X 方向，车头朝 +Z */
function addWheels(group: THREE.Group, width: number, length: number, radius = 0.36): void {
  const tireGeo = new THREE.CylinderGeometry(radius, radius, 0.3, 14);
  tireGeo.rotateZ(Math.PI / 2); // 圆柱默认轴向 Y，转到 X
  const hubGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.32, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const x = width / 2 + 0.02;
  const z = length / 2 - radius - 0.25;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(tireGeo, shared.tire);
      wheel.position.set(sx * x, radius, sz * z);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, shared.hub);
      wheel.add(hub);
      group.add(wheel);
    }
  }
}

/** 轿车/SUV/微型车通用结构：底盘车身 + 座舱玻璃 + 车灯 */
function buildPassengerCar(type: CarTypeName, color: number): THREE.Group {
  const { width: w, length: l, height: h } = CAR_TYPES[type];
  const g = new THREE.Group();
  const paint = bodyMaterial(color);

  const lowerH = h * 0.55;
  g.add(box(w, lowerH, l, paint, 0, lowerH / 2 + 0.25, 0));

  // 座舱：略窄于车身，位置偏后（车头在 +Z，引擎舱在前）
  const cabinW = w * 0.82;
  const cabinH = h * 0.42;
  const cabinL = l * 0.46;
  const cabin = box(cabinW, cabinH, cabinL, shared.glass, 0, lowerH + 0.25 + cabinH / 2, -l * 0.06);
  g.add(cabin);
  // 车顶与车身同色的薄壳
  g.add(box(cabinW * 0.96, 0.08, cabinL * 0.9, paint, 0, lowerH + 0.25 + cabinH + 0.02, -l * 0.06));

  // 前后车灯
  const lightW = w * 0.22;
  g.add(box(lightW, 0.16, 0.08, shared.headlight, -w * 0.27, h * 0.55, l / 2 + 0.02));
  g.add(box(lightW, 0.16, 0.08, shared.headlight, w * 0.27, h * 0.55, l / 2 + 0.02));
  g.add(box(lightW, 0.14, 0.08, shared.taillight, -w * 0.27, h * 0.55, -l / 2 - 0.02));
  g.add(box(lightW, 0.14, 0.08, shared.taillight, w * 0.27, h * 0.55, -l / 2 - 0.02));

  addWheels(g, w, l, type === 'suv' ? 0.42 : 0.36);
  return g;
}

/** 公交车：长厢体 + 连续侧窗 + 双车门 */
function buildBus(color: number): THREE.Group {
  const { width: w, length: l, height: h } = CAR_TYPES.bus;
  const g = new THREE.Group();
  const paint = bodyMaterial(color);
  g.add(box(w, h * 0.9, l, paint, 0, h * 0.45 + 0.2, 0));

  // 侧窗带（两侧深色长条）
  const sideWindow = box(0.06, h * 0.28, l * 0.82, shared.glass);
  sideWindow.position.set(w / 2 + 0.01, h * 0.62, 0);
  g.add(sideWindow);
  const sideWindow2 = sideWindow.clone();
  sideWindow2.position.x = -w / 2 - 0.01;
  g.add(sideWindow2);
  // 前挡风玻璃
  g.add(box(w * 0.86, h * 0.3, 0.06, shared.glass, 0, h * 0.62, l / 2 + 0.02));
  // 目的地显示屏
  g.add(box(w * 0.5, 0.16, 0.07, shared.headlight, 0, h * 0.86, l / 2 + 0.03));
  g.add(box(w * 0.3, 0.14, 0.08, shared.taillight, 0, h * 0.4, -l / 2 - 0.02));

  addWheels(g, w, l, 0.5);
  return g;
}

/** 货车：驾驶室 + 货箱 */
function buildTruck(color: number): THREE.Group {
  const { width: w, length: l, height: h } = CAR_TYPES.truck;
  const g = new THREE.Group();
  const paint = bodyMaterial(color);

  // 货箱（车尾在 -Z）
  const cargoL = l * 0.62;
  g.add(box(w, h * 0.85, cargoL, shared.dark, 0, h * 0.42 + 0.2, -l * 0.16));
  // 驾驶室（车头在 +Z）
  const cabL = l * 0.3;
  g.add(box(w, h * 0.7, cabL, paint, 0, h * 0.35 + 0.2, l / 2 - cabL / 2));
  g.add(box(w * 0.8, h * 0.3, 0.06, shared.glass, 0, h * 0.62, l / 2 + 0.02));
  g.add(box(w * 0.25, 0.14, 0.08, shared.headlight, -w * 0.25, h * 0.35, l / 2 + 0.03));
  g.add(box(w * 0.25, 0.14, 0.08, shared.headlight, w * 0.25, h * 0.35, l / 2 + 0.03));

  addWheels(g, w, l, 0.48);
  return g;
}

/**
 * 构建程序化车辆（本地 +Z 为车头，模型底部位于 y=0）
 * 加载远程 GLB 失败时的兜底方案，同时也是公交车/货车等车型的唯一来源。
 */
export function buildProceduralVehicle(visual: VehicleVisual): THREE.Group {
  let group: THREE.Group;
  switch (visual.type) {
    case 'bus':
      group = buildBus(visual.color);
      break;
    case 'truck':
      group = buildTruck(visual.color);
      break;
    default:
      group = buildPassengerCar(visual.type, visual.color);
  }
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}
