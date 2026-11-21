import * as THREE from 'three';
import {
  BLOCK_SPACING,
  GRID_N,
  PEDESTRIAN,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
} from '../config/constants';
import { PathCurve } from '../core/PathCurve';

/** 单个行人的运行时数据 */
interface Pedestrian {
  group: THREE.Group;
  path: PathCurve;
  s: number;
  speed: number;
  dir: 1 | -1;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
}

const SKIN_COLORS = [0xf0c8a0, 0xd9a066, 0xb5794b, 0x8d5a3b];
const SHIRT_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1];

/**
 * 行人系统
 * 在每个街区四周的人行道上生成环形路径，行人沿路径缓慢往复走动，
 * 低多边形人形 + 程序化四肢摆动，不与车辆发生交互（纯环境点缀）。
 */
export class PedestrianSystem {
  readonly group = new THREE.Group();
  private peds: Pedestrian[] = [];
  private rng = mulberry32(424242);

  constructor() {}

  init(): void {
    const halfSpan = ((GRID_N - 1) * BLOCK_SPACING) / 2;
    const ringOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.5;

    // 为每个街区生成一条环绕人行道的闭合路径
    const rings: PathCurve[] = [];
    for (let bi = 0; bi < GRID_N - 1; bi++) {
      for (let bj = 0; bj < GRID_N - 1; bj++) {
        const cx = (bi + 0.5) * BLOCK_SPACING - halfSpan;
        const cz = (bj + 0.5) * BLOCK_SPACING - halfSpan;
        const r = BLOCK_SPACING / 2 - ringOffset;
        const pts = [
          new THREE.Vector3(cx - r, 0, cz - r),
          new THREE.Vector3(cx + r, 0, cz - r),
          new THREE.Vector3(cx + r, 0, cz + r),
          new THREE.Vector3(cx - r, 0, cz + r),
          new THREE.Vector3(cx - r, 0, cz - r), // 闭合
        ];
        rings.push(new PathCurve(pts, 2));
      }
    }

    for (let k = 0; k < PEDESTRIAN.COUNT; k++) {
      const path = rings[Math.floor(this.rng() * rings.length)];
      const ped = this.buildPedestrian(path);
      this.peds.push(ped);
      this.group.add(ped.group);
    }
  }

  private buildPedestrian(path: PathCurve): Pedestrian {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: SKIN_COLORS[Math.floor(this.rng() * SKIN_COLORS.length)], roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: SHIRT_COLORS[Math.floor(this.rng() * SHIRT_COLORS.length)], roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.9 });

    // 躯干
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8), shirt);
    body.position.y = 1.05;
    body.castShadow = true;
    g.add(body);
    // 头
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), skin);
    head.position.y = 1.52;
    head.castShadow = true;
    g.add(head);
    // 四肢：用枢轴 Group 包裹，旋转中心落在肩部/髋部，避免摆动时肢体错位
    const limbGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.55, 6);
    const makeLimb = (x: number, pivotY: number, mat: THREE.Material): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, pivotY, 0);
      const mesh = new THREE.Mesh(limbGeo, mat);
      mesh.position.y = -0.275; // 几何体挂在枢轴下方，绕枢轴（肩/髋）摆动
      mesh.castShadow = true;
      pivot.add(mesh);
      g.add(pivot);
      return pivot;
    };
    const armL = makeLimb(-0.24, 1.32, skin);
    const armR = makeLimb(0.24, 1.32, skin);
    const legL = makeLimb(-0.09, 0.82, pants);
    const legR = makeLimb(0.09, 0.82, pants);

    const dir: 1 | -1 = this.rng() > 0.5 ? 1 : -1;
    const ped: Pedestrian = {
      group: g,
      path,
      s: this.rng() * path.length,
      speed: PEDESTRIAN.SPEED * (0.75 + this.rng() * 0.5),
      dir,
      legL,
      legR,
      armL,
      armR,
    };
    this.placeOnPath(ped);
    return ped;
  }

  /** 每帧更新：沿环道行走，到头换向，并驱动步态 */
  update(dt: number, walkPhase: { t: number }): void {
    const pos = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (const ped of this.peds) {
      ped.s += ped.speed * ped.dir * dt;
      // 端点换向
      if (ped.s >= ped.path.length) {
        ped.s = ped.path.length;
        ped.dir = -1;
      } else if (ped.s <= 0) {
        ped.s = 0;
        ped.dir = 1;
      }
      this.placeOnPath(ped, pos, tan);

      // 步态：四肢正弦摆动，频率与步速挂钩
      const swing = Math.sin(walkPhase.t * ped.speed * 5.5) * 0.55;
      ped.legL.rotation.x = swing;
      ped.legR.rotation.x = -swing;
      ped.armL.rotation.x = -swing;
      ped.armR.rotation.x = swing;
    }
  }

  private placeOnPath(ped: Pedestrian, outPos?: THREE.Vector3, outTan?: THREE.Vector3): void {
    const pos = outPos ?? new THREE.Vector3();
    const tan = outTan ?? new THREE.Vector3();
    ped.path.getPositionAt(ped.s, pos);
    ped.path.getTangentAt(ped.s, tan);
    if (ped.dir < 0) tan.multiplyScalar(-1);
    ped.group.position.copy(pos);
    ped.group.lookAt(pos.clone().add(tan));
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
