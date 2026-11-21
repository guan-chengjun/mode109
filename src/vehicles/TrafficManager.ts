import * as THREE from 'three';
import {
  CAR_COLORS,
  CAR_TYPE_WEIGHTS,
  LANE_OFFSET,
  PARKED_CAR_COUNT,
  PARKING_OFFSET,
  TRAFFIC,
  VEHICLE,
  type CarTypeName,
} from '../config/constants';
import type { LaneEdge, RoadNetwork } from '../core/RoadNetwork';
import type { SignalSystem } from '../traffic/SignalSystem';
import { ModelManager } from './ModelManager';
import { buildProceduralVehicle, type VehicleVisual } from './proceduralVehicle';
import { Vehicle, type ObstacleInfo } from './Vehicle';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** 空间网格桶尺寸（米），需大于探测距离以保证相邻桶也被检查 */
const CELL = VEHICLE.SENSOR_DISTANCE + 4;

/**
 * 交通流管理器
 * 负责车辆生命周期、障碍空间探测（均匀网格 + 沿路径前向传感器）、
 * 路口冲突检测，以及在场景中挂载/移除车辆对象。
 */
export class TrafficManager {
  /** 全部活动车辆 */
  readonly vehicles: Vehicle[] = [];
  /** 路边停放车辆（仅装饰，不参与仿真） */
  readonly parked: THREE.Group[] = [];

  private spatial = new Map<string, Vehicle[]>();
  private visualRng = mulberry32(987654321);

  constructor(
    private scene: THREE.Scene,
    private network: RoadNetwork,
    private signals: SignalSystem,
    private modelManager: ModelManager,
  ) {}

  /** 初始批量生成车辆，尽量均匀分布到各路段 */
  populateInitial(count: number): void {
    const lanes = [...this.network.laneList];
    // 打乱后轮流取路段，保证空间分散
    shuffle(lanes, this.visualRng);
    let spawned = 0;
    let guard = 0;
    while (spawned < count && guard++ < count * 8) {
      const lane = lanes[spawned % lanes.length];
      // 每条初始路段放在中后段随机位置，留出车间距
      const s = lane.path.length * (0.15 + this.visualRng() * 0.7);
      if (!this.spawnClear(lane, s)) continue;
      this.spawnVehicle(lane, s);
      spawned++;
    }
  }

  /** 新增一台车辆（面板按钮），返回是否成功（达到容量/无空位则失败） */
  addVehicle(): boolean {
    if (this.vehicles.length >= TRAFFIC.MAX_COUNT) return false;
    // 随机尝试若干路段找空位
    for (let attempt = 0; attempt < 24; attempt++) {
      const lane = this.network.laneList[Math.floor(this.visualRng() * this.network.laneList.length)];
      const s = lane.path.length * (0.05 + this.visualRng() * 0.85);
      if (this.spawnClear(lane, s)) {
        this.spawnVehicle(lane, s);
        return true;
      }
    }
    return false;
  }

  /** 清空全部活动车辆 */
  clearVehicles(): void {
    for (const v of this.vehicles) {
      this.scene.remove(v.group);
      this.disposeVehicleGroup(v.group, v.isGlb);
    }
    this.vehicles.length = 0;
    this.spatial.clear();
  }

  /** 生成路边停放车辆（沿停车带，避开路口） */
  populateParked(builder: (visual: VehicleVisual) => THREE.Group): void {
    const slots: Array<{ pos: THREE.Vector3; angle: number }> = [];
    const spacing = 9;
    for (const lane of this.network.laneList) {
      // 每条 lane 只在其道路一侧的停车带布置，避免重复
      if (lane.heading !== 'E' && lane.heading !== 'N') continue;
      const len = lane.path.length;
      for (let s = spacing; s < len - spacing; s += spacing) {
        if (this.visualRng() > 0.35) continue; // 随机空置
        const p = lane.path.getPositionAt(s, new THREE.Vector3());
        // 向车道外侧（行驶方向右侧）平移到停车带
        const t = lane.path.getTangentAt(s, new THREE.Vector3());
        const right = new THREE.Vector3(t.z, 0, -t.x);
        p.addScaledVector(right, PARKING_OFFSET - LANE_OFFSET);
        p.y = 0;
        // 朝向对齐道路方向（本地 +Z 对齐切向），少量车辆做 180° 反向停放
        const flip = this.visualRng() < 0.2 ? Math.PI : 0;
        const angle = Math.atan2(t.x, t.z) + flip;
        slots.push({ pos: p, angle });
        if (slots.length >= PARKED_CAR_COUNT) break;
      }
      if (slots.length >= PARKED_CAR_COUNT) break;
    }

    for (const slot of slots) {
      const visual = this.randomVisual();
      const g = builder(visual);
      g.position.copy(slot.pos);
      g.rotation.y = slot.angle;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.scene.add(g);
      this.parked.push(g);
    }
  }

  /**
   * 每帧推进全部车辆
   * @param dt 仿真秒
   * @param speedScale 车流速度倍率
   */
  update(dt: number, speedScale: number): void {
    this.rebuildSpatial();
    for (const v of this.vehicles) {
      const obstacle = this.senseAhead(v);
      const blocked = this.isIntersectionBlocked(v);
      v.update(dt, speedScale, obstacle, blocked);
    }
  }

  /** 重建均匀空间网格（每帧重建，车辆规模下开销很小） */
  private rebuildSpatial(): void {
    this.spatial.clear();
    for (const v of this.vehicles) {
      v.getPosition(tmpA);
      const key = this.cellKey(tmpA.x, tmpA.z);
      let bucket = this.spatial.get(key);
      if (!bucket) {
        bucket = [];
        this.spatial.set(key, bucket);
      }
      bucket.push(v);
    }
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /**
   * 前向传感器：沿车辆当前路径向前采样探测距离内的最近车辆
   * 同时校验横向距离，防止相邻车道车辆误触发
   */
  private senseAhead(self: Vehicle): ObstacleInfo | null {
    const edge = self.currentEdge;
    const path = edge.path;
    const probeStep = 3;
    const result: ObstacleInfo = { distance: Infinity, speed: 0 };
    let hit = false;

    for (let d = probeStep; d <= VEHICLE.SENSOR_DISTANCE; d += probeStep) {
      const s = self.currentS + d;
      if (s > path.length) break;
      path.getPositionAt(s, tmpA);
      // 检查当前桶与 8 邻域
      const cx = Math.floor(tmpA.x / CELL);
      const cz = Math.floor(tmpA.z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.spatial.get(`${cx + dx},${cz + dz}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === self) continue;
            other.getPosition(tmpB);
            const lateral = this.lateralDistance(tmpB, tmpA, self);
            if (Math.abs(lateral) > VEHICLE.SENSOR_HALF_WIDTH + other.halfLength * 0.5) continue;
            const arc = this.arcDistance(self, other);
            if (arc !== null && arc < result.distance) {
              result.distance = arc;
              result.speed = other.speed;
              hit = true;
            }
          }
        }
      }
      if (hit) break; // 由近及远采样，找到即可停止
    }

    return hit ? result : null;
  }

  /** 其他车辆相对传感器中心线的横向偏移（沿当前路径切向的法向投影） */
  private lateralDistance(otherPos: THREE.Vector3, probePos: THREE.Vector3, self: Vehicle): number {
    self.getTangent(tmpC);
    const normal = new THREE.Vector3(tmpC.z, 0, -tmpC.x);
    return otherPos.clone().sub(probePos).dot(normal);
  }

  /**
   * 弧长距离：仅当 other 位于 self 的同一条边、且在 self 前方时有效
   * 跨边跟车由路口连接段的低速与冲突检测兜底
   */
  private arcDistance(self: Vehicle, other: Vehicle): number | null {
    if (other.currentEdge.id !== self.currentEdge.id) return null;
    const d = other.currentS - self.currentS;
    return d > 0 ? d - (other.halfLength + self.halfLength) * 0.5 : null;
  }

  /**
   * 路口冲突检测：self 即将进入路口时，若路口内已有车辆则禁止进入
   * 配合信号灯全红清空相位，避免对向/横向车辆在路口内穿插
   */
  private isIntersectionBlocked(self: Vehicle): boolean {
    const edge = self.currentEdge;
    if (edge.kind !== 'lane') return false;
    const lane = edge as LaneEdge;
    const distToStop = lane.path.length - self.currentS;
    if (distToStop > 6) return false; // 距离尚远，无需判断

    const [i, j] = lane.endIntersection;
    const center = this.network.intersections[i][j];
    for (const other of this.vehicles) {
      if (other === self) continue;
      if (other.currentEdge.kind !== 'connection') continue;
      other.getPosition(tmpB);
      // 连接边上的车辆必然位于某路口内，按路口中心距离归属判断
      if (tmpB.distanceTo(center) < 14) return true;
    }
    return false;
  }

  /** 检查出生点周围是否有足够安全空间 */
  private spawnClear(lane: LaneEdge, s: number): boolean {
    lane.path.getPositionAt(s, tmpA);
    for (const v of this.vehicles) {
      v.getPosition(tmpB);
      if (tmpA.distanceTo(tmpB) < VEHICLE.MIN_GAP + 8) return false;
    }
    return true;
  }

  private spawnVehicle(lane: LaneEdge, s: number): void {
    const visual = this.randomVisual();
    // 远程 GLB 仅用于轿车类（车型尺寸与归一化模板匹配），大车仍用程序化模型
    const useGlb =
      this.modelManager.status === 'loaded' &&
      visual.type !== 'bus' &&
      visual.type !== 'truck' &&
      this.visualRng() < 0.6;
    const group = useGlb ? this.modelManager.cloneCar() ?? buildProceduralVehicle(visual) : buildProceduralVehicle(visual);
    this.scene.add(group);
    const vehicle = new Vehicle(this.network, this.signals, group, visual, useGlb, lane, s);
    this.vehicles.push(vehicle);
  }

  /** 随机车型（按权重）+ 随机颜色 */
  private randomVisual(): VehicleVisual {
    const r = this.visualRng();
    let acc = 0;
    let type: CarTypeName = 'sedan';
    for (const [t, w] of CAR_TYPE_WEIGHTS) {
      acc += w;
      if (r <= acc) {
        type = t;
        break;
      }
    }
    const color = CAR_COLORS[Math.floor(this.visualRng() * CAR_COLORS.length)];
    return { type, color };
  }

  /**
   * 移除车辆组
   * 注意：程序化车辆与 GLB 克隆体都使用共享几何/材质（GLB 克隆自统一模板），
   * 资源随页面生命周期统一释放，此处不能 dispose，否则会破坏后续新车。
   */
  private disposeVehicleGroup(_group: THREE.Group, _isGlb: boolean): void {
    // 仅从场景图摘除，GPU 资源保持共享
  }
}

/** 确定性伪随机数生成器，保证车型/颜色分布可复现 */
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

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
