import * as THREE from 'three';
import { GRID_N } from '../config/constants';
import { RoadNetwork, type Approach } from '../core/RoadNetwork';
import type { LightState, SignalSystem } from './SignalSystem';

/** 单个灯头的三个灯泡材质（通过 emissive 表现亮灭） */
interface SignalHead {
  bulbs: Record<LightState, THREE.MeshStandardMaterial>;
}

const BULB_COLORS: Record<LightState, number> = {
  red: 0xff3030,
  yellow: 0xffc832,
  green: 0x37e06b,
};

/**
 * 信号灯可视化
 * 每个路口的四个进口方向各立一根信号灯杆，灯头面向来车；
 * 灯态由 SignalSystem 驱动，点亮的灯泡提高自发光强度。
 */
export class SignalVisuals {
  private heads = new Map<string, SignalHead>(); // key: 路口键 + 进口方向
  private group = new THREE.Group();

  constructor(
    private network: RoadNetwork,
    private signals: SignalSystem,
  ) {
    this.build();
  }

  get object3d(): THREE.Object3D {
    return this.group;
  }

  private build(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, metalness: 0.7, roughness: 0.45 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x22272e, roughness: 0.7 });

    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        for (const approach of ['E', 'W', 'S', 'N'] as Approach[]) {
          if (!this.hasApproachLane(i, j, approach)) continue;
          const head = this.makeHead(poleMat, housingMat, i, j, approach);
          this.heads.set(`${RoadNetwork.key(i, j)}:${approach}`, head);
        }
      }
    }
  }

  /** 边界路口没有该方向的来车车道，则不立灯 */
  private hasApproachLane(i: number, j: number, approach: Approach): boolean {
    const conns = this.network.intersectionConnections.get(RoadNetwork.key(i, j)) ?? [];
    return conns.some((c) => {
      const lane = this.network.lanes.get(c.fromLaneId);
      return lane?.approach === approach;
    });
  }

  private makeHead(
    poleMat: THREE.MeshStandardMaterial,
    housingMat: THREE.MeshStandardMaterial,
    i: number,
    j: number,
    approach: Approach,
  ): SignalHead {
    const center = this.network.intersections[i][j];
    // 从路口中心指向进口（来车方向的反方向）
    const outward = this.approachOutward(approach);
    // 来车方向的右侧法向（人在来车行进方向看，右手边）
    const right = new THREE.Vector3(outward.z, 0, -outward.x);

    // 灯杆立在停车线外、来车方向右侧路缘
    const polePos = center
      .clone()
      .addScaledVector(outward, 12.5)
      .addScaledVector(right, 4.2);
    polePos.y = 0;

    const root = new THREE.Group();
    root.position.copy(polePos);

    // 竖杆
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.6, 8), poleMat);
    pole.position.y = 2.8;
    pole.castShadow = true;
    root.add(pole);

    // 悬臂：从杆顶伸向车道（来车方向右侧 -> 车道，即 -right 方向）
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.0), poleMat);
    arm.position.set(-right.x * 1.4, 5.5, -right.z * 1.4);
    // 几何体长轴沿本地 Z，将其对齐到水平的 -right 方向
    arm.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-right.x, 0, -right.z).normalize(),
    );
    arm.castShadow = true;
    root.add(arm);

    // 灯箱挂在悬臂末端，面向来车（来车朝向 = -outward）
    const housingCenter = new THREE.Vector3(-right.x * 2.8, 5.0, -right.z * 2.8);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.4), housingMat);
    housing.position.copy(housingCenter);
    // 灯箱本地 +Z 面向来车
    const facing = outward.clone().multiplyScalar(-1);
    housing.lookAt(housingCenter.clone().add(facing));
    housing.castShadow = true;
    root.add(housing);

    const bulbs = {} as Record<LightState, THREE.MeshStandardMaterial>;
    const states: LightState[] = ['red', 'yellow', 'green'];
    states.forEach((state, idx) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x181818,
        emissive: BULB_COLORS[state],
        emissiveIntensity: 0.06,
        roughness: 0.4,
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
      // 沿灯箱本地竖排（红上黄中绿下），并向正面突出一点
      bulb.position
        .copy(housingCenter)
        .add(new THREE.Vector3(0, 0.48 - idx * 0.48, 0))
        .addScaledVector(facing, 0.22);
      root.add(bulb);
      bulbs[state] = mat;
    });

    this.group.add(root);
    return { bulbs };
  }

  /** 进口方向 -> 从路口中心指向该进口的单位向量 */
  private approachOutward(approach: Approach): THREE.Vector3 {
    switch (approach) {
      case 'E':
        return new THREE.Vector3(1, 0, 0);
      case 'W':
        return new THREE.Vector3(-1, 0, 0);
      case 'N':
        return new THREE.Vector3(0, 0, 1);
      case 'S':
        return new THREE.Vector3(0, 0, -1);
    }
  }

  /** 每帧同步灯态到灯泡材质 */
  update(): void {
    for (const [key, head] of this.heads) {
      const [ij, approach] = key.split(':');
      const [i, j] = ij.split(',').map(Number);
      const state = this.signals.getState(i, j, approach as Approach);
      (Object.keys(head.bulbs) as LightState[]).forEach((s) => {
        head.bulbs[s].emissiveIntensity = s === state ? 1.6 : 0.06;
      });
    }
  }
}
