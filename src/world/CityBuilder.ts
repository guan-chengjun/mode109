import * as THREE from 'three';
import {
  BLOCK_SPACING,
  GRID_N,
  LANE_OFFSET,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  gridToWorld,
} from '../config/constants';
import type { RoadNetwork } from '../core/RoadNetwork';
import { getFacadeTexture } from './facadeTexture';

/** 确定性伪随机，保证城市布局每次启动一致 */
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

/**
 * 城市构建器
 * 负责静态场景：地面、道路与人行道、车道线、街区建筑、绿化带、
 * 路灯、树木、长椅、垃圾桶。重复物体使用 InstancedMesh 控制 draw call。
 */
export class CityBuilder {
  readonly group = new THREE.Group();
  private rng = mulberry32(20261122);

  constructor(private network: RoadNetwork) {}

  build(): void {
    this.buildGround();
    this.buildRoadsAndSidewalks();
    this.buildLaneMarkings();
    this.buildBlocksAndBuildings();
    this.buildStreetFurniture();
  }

  /** 大地基底：略大于城区的浅绿灰色平面，接收阴影 */
  private buildGround(): void {
    const span = GRID_N * BLOCK_SPACING;
    const geo = new THREE.PlaneGeometry(span * 2.2, span * 2.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8bfa0, roughness: 0.95 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /**
   * 道路与人行道
   * 道路用独立平面条带（路口处为正方形），人行道沿道路两侧铺设，
   * 街区内部地块抬高为草皮，形成清晰的路缘层次。
   */
  private buildRoadsAndSidewalks(): void {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.92 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.85 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x8fbf7e, roughness: 0.95 });

    const span = (GRID_N - 1) * BLOCK_SPACING;
    const halfSpan = span / 2;
    const segLen = BLOCK_SPACING - ROAD_WIDTH; // 两路口之间的路段净长
    const roadGeoH = new THREE.PlaneGeometry(segLen, ROAD_WIDTH);
    const roadGeoV = new THREE.PlaneGeometry(ROAD_WIDTH, segLen);
    const intersectionGeo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_WIDTH);
    const swGeoH = new THREE.PlaneGeometry(segLen, SIDEWALK_WIDTH);
    const swGeoV = new THREE.PlaneGeometry(SIDEWALK_WIDTH, segLen);

    const addPlane = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, y = 0.01) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.group.add(m);
    };

    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        const { x, z } = gridToWorld(i, j);
        // 路口正方形路面
        addPlane(intersectionGeo, roadMat, x, z);
      }
    }

    // 路段：横线道路（固定 j）与纵线道路（固定 i）
    for (let k = 0; k < GRID_N; k++) {
      const line = k * BLOCK_SPACING - halfSpan;
      for (let s = 0; s < GRID_N - 1; s++) {
        const mid = (s + 0.5) * BLOCK_SPACING - halfSpan;
        // 横线（沿 X）
        addPlane(roadGeoH, roadMat, mid, line);
        addPlane(swGeoH, sidewalkMat, mid, line + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2, 0.015);
        addPlane(swGeoH, sidewalkMat, mid, line - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2, 0.015);
        // 纵线（沿 Z）
        addPlane(roadGeoV, roadMat, line, mid);
        addPlane(swGeoV, sidewalkMat, line + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2, mid, 0.015);
        addPlane(swGeoV, sidewalkMat, line - ROAD_WIDTH / 2 - SIDEWALK_WIDTH / 2, mid, 0.015);
      }
    }

    // 街区草皮地块（(GRID_N-1)^2 个），略微抬高模拟路缘
    const blockSize = BLOCK_SPACING - ROAD_WIDTH - SIDEWALK_WIDTH * 2;
    const blockGeo = new THREE.PlaneGeometry(blockSize, blockSize);
    for (let bi = 0; bi < GRID_N - 1; bi++) {
      for (let bj = 0; bj < GRID_N - 1; bj++) {
        const cx = (bi + 0.5) * BLOCK_SPACING - halfSpan;
        const cz = (bj + 0.5) * BLOCK_SPACING - halfSpan;
        addPlane(blockGeo, grassMat, cx, cz, 0.02);
      }
    }
  }

  /**
   * 车道线：道路中心双黄虚线 + 车道边缘白实线 + 路口停止线
   * 全部用细长 Box 合并为少量 InstancedMesh
   */
  private buildLaneMarkings(): void {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c546, roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.7 });
    const dashLen = 4;
    const dashGap = 4;
    const segLen = BLOCK_SPACING - ROAD_WIDTH;

    // 预估实例数量后用矩阵数组收集
    const yellowMatrices: THREE.Matrix4[] = [];
    const whiteMatrices: THREE.Matrix4[] = [];
    const stopMatrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();

    for (let k = 0; k < GRID_N; k++) {
      const line = k * BLOCK_SPACING - ((GRID_N - 1) * BLOCK_SPACING) / 2;
      for (let s = 0; s < GRID_N - 1; s++) {
        const mid = (s + 0.5) * BLOCK_SPACING - ((GRID_N - 1) * BLOCK_SPACING) / 2;
        // 横向道路（沿 X）：中心双黄虚线
        for (let d = -segLen / 2 + 1; d < segLen / 2 - 1; d += dashLen + dashGap) {
          for (const off of [-0.18, 0.18]) {
            m.compose(new THREE.Vector3(mid + d, 0.03, line + off), q, new THREE.Vector3(dashLen, 0.02, 0.14));
            yellowMatrices.push(m.clone());
          }
        }
        // 车道边缘白实线（停车带与行驶车道分界）
        for (const off of [LANE_OFFSET + 1.6, -(LANE_OFFSET + 1.6)]) {
          m.compose(new THREE.Vector3(mid, 0.03, line + off), q, new THREE.Vector3(segLen, 0.02, 0.12));
          whiteMatrices.push(m.clone());
        }
        // 纵向道路（沿 Z）：旋转 90°
        const q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        for (let d = -segLen / 2 + 1; d < segLen / 2 - 1; d += dashLen + dashGap) {
          for (const off of [-0.18, 0.18]) {
            m.compose(new THREE.Vector3(line + off, 0.03, mid + d), q90, new THREE.Vector3(dashLen, 0.02, 0.14));
            yellowMatrices.push(m.clone());
          }
        }
        for (const off of [LANE_OFFSET + 1.6, -(LANE_OFFSET + 1.6)]) {
          m.compose(new THREE.Vector3(line + off, 0.03, mid), q90, new THREE.Vector3(segLen, 0.02, 0.12));
          whiteMatrices.push(m.clone());
        }
      }
    }

    // 停止线：每条 lane 终点路口边界处一条宽白线
    for (const lane of this.network.laneList) {
      const p = lane.stopLine;
      const t = lane.path.getTangentAt(lane.path.length - 0.01, new THREE.Vector3());
      const angle = Math.atan2(t.x, t.z);
      const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      m.compose(p.clone().setY(0.035), qq, new THREE.Vector3(3.4, 0.02, 0.35));
      stopMatrices.push(m.clone());
    }

    this.group.add(this.makeInstanced(new THREE.BoxGeometry(1, 1, 1), yellow, yellowMatrices));
    this.group.add(this.makeInstanced(new THREE.BoxGeometry(1, 1, 1), white, whiteMatrices));
    this.group.add(this.makeInstanced(new THREE.BoxGeometry(1, 1, 1), white, stopMatrices));
  }

  /** 街区建筑：每个地块 2~4 个体块组合，高度错落，立面使用程序化窗纹理 */
  private buildBlocksAndBuildings(): void {
    const halfSpan = ((GRID_N - 1) * BLOCK_SPACING) / 2;
    const blockSize = BLOCK_SPACING - ROAD_WIDTH - SIDEWALK_WIDTH * 2;

    for (let bi = 0; bi < GRID_N - 1; bi++) {
      for (let bj = 0; bj < GRID_N - 1; bj++) {
        const cx = (bi + 0.5) * BLOCK_SPACING - halfSpan;
        const cz = (bj + 0.5) * BLOCK_SPACING - halfSpan;
        // 每块地切 2×2 小地块，随机留空作绿地/庭院
        const sub = blockSize / 2;
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            if (this.rng() < 0.18) continue;
            const px = cx + (a - 0.5) * sub;
            const pz = cz + (b - 0.5) * sub;
            this.buildBuilding(px, pz, sub * (0.72 + this.rng() * 0.2));
          }
        }
      }
    }
  }

  private buildBuilding(cx: number, cz: number, footprint: number): void {
    const w = footprint * (0.7 + this.rng() * 0.25);
    const d = footprint * (0.7 + this.rng() * 0.25);
    // 高度分级：低层裙房 + 可选高层塔楼
    const highRise = this.rng() < 0.35;
    const h1 = 8 + this.rng() * 12;
    const h2 = highRise ? h1 + 14 + this.rng() * 26 : 0;

    const seed = Math.floor(this.rng() * 6);
    const facade = this.facadeMaterial(seed);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.9 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h1, d), [
      facade, facade, roofMat, roofMat, facade, facade,
    ]);
    base.position.set(cx, h1 / 2 + 0.05, cz);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    if (h2 > 0) {
      const w2 = w * 0.62;
      const d2 = d * 0.62;
      const facade2 = this.facadeMaterial((seed + 2) % 6);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, d2), [
        facade2, facade2, roofMat, roofMat, facade2, facade2,
      ]);
      tower.position.set(cx + w * 0.08, h1 + h2 / 2, cz - d * 0.06);
      tower.castShadow = true;
      tower.receiveShadow = true;
      this.group.add(tower);
      // 屋顶机房小体块
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w2 * 0.4, 2.2, d2 * 0.4), roofMat);
      cap.position.set(tower.position.x, h1 + h2 + 1.1, tower.position.z);
      cap.castShadow = true;
      this.group.add(cap);
    }
  }

  private facadeMaterial(seed: number): THREE.MeshStandardMaterial {
    // 纹理随楼高重复；这里用固定重复，视觉上窗户密度稳定
    const tex = getFacadeTexture(seed);
    return new THREE.MeshStandardMaterial({
      map: tex,
      metalness: 0.12,
      roughness: 0.78,
    });
  }

  /** 路灯、树木、长椅、垃圾桶：沿人行道等距布置，全部实例化 */
  private buildStreetFurniture(): void {
    const halfSpan = ((GRID_N - 1) * BLOCK_SPACING) / 2;
    const segLen = BLOCK_SPACING - ROAD_WIDTH;
    const furnitureOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.45;

    // 收集实例矩阵
    const lamps: THREE.Matrix4[] = [];
    const trees: THREE.Matrix4[] = [];
    const benches: THREE.Matrix4[] = [];
    const bins: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();

    const push = (arr: THREE.Matrix4[], x: number, z: number, rotY: number, scale: number) => {
      const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      m.compose(new THREE.Vector3(x, 0, z), qq, new THREE.Vector3(scale, scale, scale));
      arr.push(m.clone());
    };

    for (let k = 0; k < GRID_N; k++) {
      const line = k * BLOCK_SPACING - halfSpan;
      for (let s = 0; s < GRID_N - 1; s++) {
        const mid = (s + 0.5) * BLOCK_SPACING - halfSpan;
        // 横向道路两侧
        for (const side of [-1, 1]) {
          for (let d = -segLen / 2 + 12; d <= segLen / 2 - 12; d += 24) {
            const x = mid + d;
            const z = line + side * furnitureOffset;
            push(lamps, x, z, 0, 1);
            if (this.rng() < 0.75) push(trees, x, line + side * (furnitureOffset + 2.2), 0, 0.85 + this.rng() * 0.4);
            if (this.rng() < 0.4) push(benches, x - 5, z + side * 1.2, side > 0 ? 0 : Math.PI, 1);
            if (this.rng() < 0.3) push(bins, x + 5, z - side * 1.0, 0, 1);
          }
        }
        // 纵向道路两侧
        for (const side of [-1, 1]) {
          for (let d = -segLen / 2 + 12; d <= segLen / 2 - 12; d += 24) {
            const x = line + side * furnitureOffset;
            const z = mid + d;
            push(lamps, x, z, Math.PI / 2, 1);
            if (this.rng() < 0.75) push(trees, line + side * (furnitureOffset + 2.2), z, 0, 0.85 + this.rng() * 0.4);
            if (this.rng() < 0.4) push(benches, x - side * 1.2, z + 5, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
            if (this.rng() < 0.3) push(bins, x + side * 1.0, z - 5, 0, 1);
          }
        }
      }
    }

    // 路灯 = 灯杆 + 灯头（两个实例化网格组合）
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444c56, metalness: 0.7, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cc,
      emissive: 0xffe9a8,
      emissiveIntensity: 0.55,
    });
    const lampPoles = this.makeInstanced(new THREE.CylinderGeometry(0.09, 0.13, 5, 6), poleMat, lamps);
    this.group.add(lampPoles);
    const lampHeads = this.makeInstanced(new THREE.SphereGeometry(0.28, 8, 6), lampMat, lamps, new THREE.Vector3(0, 5, 0));
    this.group.add(lampHeads);

    // 树木：树干 + 树冠
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x4e8f43, roughness: 0.85 });
    this.group.add(this.makeInstanced(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6), trunkMat, trees, new THREE.Vector3(0, 1.1, 0)));
    this.group.add(this.makeInstanced(new THREE.IcosahedronGeometry(1.5, 0), crownMat, trees, new THREE.Vector3(0, 3.1, 0)));

    // 长椅
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
    this.group.add(this.makeInstanced(new THREE.BoxGeometry(2.2, 0.5, 0.7), benchMat, benches, new THREE.Vector3(0, 0.45, 0)));
    // 垃圾桶
    const binMat = new THREE.MeshStandardMaterial({ color: 0x55606b, metalness: 0.5, roughness: 0.5 });
    this.group.add(this.makeInstanced(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 8), binMat, bins, new THREE.Vector3(0, 0.45, 0)));
  }

  /** 构造 InstancedMesh；offset 为实例局部位置偏移（如树冠在树干上方） */
  private makeInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrices: THREE.Matrix4[],
    offset = new THREE.Vector3(),
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(matrices.length, 1));
    matrices.forEach((base, idx) => {
      if (offset.lengthSq() > 0) {
        const t = new THREE.Vector3();
        const qq = new THREE.Quaternion();
        const s = new THREE.Vector3();
        base.decompose(t, qq, s);
        t.add(offset);
        const composed = new THREE.Matrix4().compose(t, qq, s);
        mesh.setMatrixAt(idx, composed);
      } else {
        mesh.setMatrixAt(idx, base);
      }
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // 城市尺度统一参与视锥剔除代价更高，关闭更稳
    return mesh;
  }
}
