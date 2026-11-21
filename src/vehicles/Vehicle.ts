import * as THREE from 'three';
import { TRAFFIC, VEHICLE } from '../config/constants';
import type { ConnectionEdge, LaneEdge, RoadEdge, RoadNetwork } from '../core/RoadNetwork';
import type { LightState, SignalSystem } from '../traffic/SignalSystem';
import type { VehicleVisual } from './proceduralVehicle';

/** 车辆在当前边上的行驶状态 */
interface EdgeState {
  edge: RoadEdge;
  /** 在当前边路径上的已行驶距离 */
  s: number;
}

/** 前方障碍信息（由 TrafficManager 统一探测后注入） */
export interface ObstacleInfo {
  /** 沿自身路径方向到障碍的弧长距离 */
  distance: number;
  /** 障碍的行驶速度 m/s */
  speed: number;
}

const tmpPos = new THREE.Vector3();
const tmpTan = new THREE.Vector3();

/**
 * 单台车辆：沿路网有向边序列循环行驶
 * 行为：车道保持、IDM 跟车、红灯停车线等待、黄灯择机停车、路口冲突让行
 */
export class Vehicle {
  readonly group: THREE.Group;
  readonly visual: VehicleVisual;
  /** 车辆几何包围尺寸（用于碰撞与探测） */
  readonly halfLength: number;

  private network: RoadNetwork;
  private signals: SignalSystem;

  /** 当前边与下一条边（连接边在进入路口前就选好，保证轨迹连续） */
  private current: EdgeState;
  private next: EdgeState | null = null;

  /** 运动学状态 */
  speed = 0;
  private maxSpeed: number;
  /** 该车是否使用远程 GLB 模型 */
  readonly isGlb: boolean;

  // 复用车灯材质引用（可选：制动时点亮尾灯，远程模型不处理）
  constructor(
    network: RoadNetwork,
    signals: SignalSystem,
    group: THREE.Group,
    visual: VehicleVisual,
    isGlb: boolean,
    spawnEdge: LaneEdge,
    spawnS: number,
  ) {
    this.network = network;
    this.signals = signals;
    this.group = group;
    this.visual = visual;
    this.isGlb = isGlb;
    // 大车更长，包围半长按车型给固定值
    const isLongVehicle = visual.type === 'bus' || visual.type === 'truck';
    this.halfLength = isLongVehicle
      ? VEHICLE.VEHICLE_HALF_LENGTH * 1.8
      : VEHICLE.VEHICLE_HALF_LENGTH;
    this.maxSpeed = VEHICLE.MAX_SPEED * (0.82 + Math.random() * 0.28);
    this.current = { edge: spawnEdge, s: spawnS };
    this.planNextEdge();
    this.updateTransform();
  }

  /** 在当前边终点预先选好下一条边（路口内连接）或随机接上新的路段 */
  private planNextEdge(): void {
    const edge = this.current.edge;
    if (edge.kind === 'lane') {
      // 路段末端：按转向概率选一条路口连接边
      const conns = this.network.getOutgoingConnections(edge.id);
      if (conns.length === 0) {
        // 边界死路：理论上不会到达（选路时已排除），保险起见原地待机
        this.next = null;
        return;
      }
      const conn = this.pickConnection(conns);
      this.next = { edge: conn, s: 0 };
    } else {
      // 连接边末端：进入下一条 lane，继续预排它的路口连接
      const outLane = this.network.lanes.get((edge as ConnectionEdge).toLaneId);
      if (!outLane) {
        this.next = null;
        return;
      }
      this.next = { edge: outLane, s: 0 };
    }
  }

  /** 按配置的转向概率随机选择连接边 */
  private pickConnection(conns: ConnectionEdge[]): ConnectionEdge {
    const r = Math.random();
    const want: ConnectionEdge['turn'] =
      r < TRAFFIC.TURN_CHANCE.LEFT
        ? 'left'
        : r < TRAFFIC.TURN_CHANCE.LEFT + TRAFFIC.TURN_CHANCE.STRAIGHT
          ? 'straight'
          : 'right';
    const preferred = conns.filter((c) => c.turn === want);
    if (preferred.length > 0) return preferred[0];
    // 边界路口缺方向时，退化为任意可用连接（优先直行）
    return conns.find((c) => c.turn === 'straight') ?? conns[0];
  }

  /** 当前世界位置（由 TrafficManager 做空间探测时读取） */
  getPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.current.edge.path.getPositionAt(this.current.s, target);
  }

  /** 当前车头切向 */
  getTangent(target: THREE.Vector3): THREE.Vector3 {
    return this.current.edge.path.getTangentAt(this.current.s, target);
  }

  get currentEdge(): RoadEdge {
    return this.current.edge;
  }

  get currentS(): number {
    return this.current.s;
  }

  /**
   * 每帧仿真推进
   * @param dt 仿真秒（已乘时间流速）
   * @param speedScale 车流速度倍率（影响期望速度）
   * @param obstacle 同车道最近障碍（无则 null）
   * @param intersectionBlocked 路口内是否有冲突车辆（红灯/让行时禁止进入）
   */
  update(
    dt: number,
    speedScale: number,
    obstacle: ObstacleInfo | null,
    intersectionBlocked: boolean,
  ): void {
    // 1. 期望速度：道路限速 × 车流倍率；弯道（连接边）适度减速
    const isTurning = this.current.edge.kind === 'connection';
    const turnFactor = isTurning ? 0.62 : 1;
    const desired = this.maxSpeed * speedScale * turnFactor;

    // 2. 信号灯约束（仅 lane 边接近终点时检查）
    const signalLimit = this.evaluateSignal(intersectionBlocked);

    // 3. IDM 智能跟车模型计算目标速度
    let targetSpeed = desired;
    if (signalLimit !== null) targetSpeed = Math.min(targetSpeed, signalLimit);
    if (obstacle) targetSpeed = Math.min(targetSpeed, this.idm(obstacle, desired));

    // 4. 加减速平滑（限制舒适度，紧急情况用更大减速度）
    const deltaV = targetSpeed - this.speed;
    const maxDeltaUp = VEHICLE.MAX_ACCEL * dt;
    const decel = obstacle && obstacle.distance < VEHICLE.MIN_GAP + 1
      ? VEHICLE.EMERGENCY_DECEL
      : VEHICLE.COMFORT_DECEL;
    const maxDeltaDown = decel * dt;
    this.speed = THREE.MathUtils.clamp(this.speed + THREE.MathUtils.clamp(deltaV, -maxDeltaDown, maxDeltaUp), 0, this.maxSpeed * speedScale * 1.05);

    // 5. 沿路径推进，跨边时无缝切换
    let remaining = this.speed * dt;
    let guard = 0;
    while (remaining > 0 && guard++ < 6) {
      const edge = this.current.edge;
      const leftDist = edge.path.length - this.current.s;
      if (remaining < leftDist) {
        this.current.s += remaining;
        remaining = 0;
      } else {
        remaining -= leftDist;
        if (!this.next) {
          // 无路可走：停在边末端
          this.current.s = edge.path.length;
          this.speed = 0;
          remaining = 0;
          break;
        }
        this.current = this.next;
        this.current.s = Math.min(remaining, this.current.edge.path.length);
        remaining = Math.max(0, remaining - this.current.s);
        this.planNextEdge();
      }
    }

    this.updateTransform();
  }

  /**
   * 信号灯评估，返回该约束下允许的速度（null 表示无约束）
   * 规则：红灯必须在停车线前停下；黄灯若能安全停下则停；已进入路口则不受约束
   */
  private evaluateSignal(intersectionBlocked: boolean): number | null {
    const edge = this.current.edge;
    if (edge.kind !== 'lane') return null; // 路口内不看灯
    const lane = edge as LaneEdge;
    const distToStop = lane.path.length - this.current.s;
    if (distToStop > VEHICLE.SENSOR_DISTANCE) return null;

    const [i, j] = lane.endIntersection;
    const state: LightState = this.signals.getState(i, j, lane.approach);

    if (state === 'green' && !intersectionBlocked) return null;

    if (state === 'yellow') {
      // 估算当前速度下舒适制动所需距离
      const stopDistNeeded = (this.speed * this.speed) / (2 * VEHICLE.COMFORT_DECEL) + 1.5;
      if (distToStop > stopDistNeeded) {
        // 还来得及，择机停车
      } else if (!intersectionBlocked) {
        return null; // 越线距离不足，保持通过
      }
    }

    // red / yellow 需停车，或路口被冲突车辆占用：给出限速曲线（距离越近速度越低）
    if (intersectionBlocked && state === 'green') {
      // 绿灯但路口未清空：在停车线前缓行等待
      return this.approachSpeed(distToStop);
    }
    return this.approachSpeed(distToStop);
  }

  /** 逼近停车点的限速：sqrt(2·a·d)，保证可在停车线前舒适停住 */
  private approachSpeed(distance: number): number {
    const d = Math.max(0, distance - VEHICLE.MIN_GAP * 0.4);
    return Math.sqrt(2 * VEHICLE.COMFORT_DECEL * d);
  }

  /** IDM 跟车：根据前车距离与相对速度求安全速度 */
  private idm(obstacle: ObstacleInfo, desiredSpeed: number): number {
    const v0 = Math.max(desiredSpeed, 0.1);
    const v = this.speed;
    const dv = v - obstacle.speed; // 相对前车的速度（接近为正）
    const sStar =
      VEHICLE.MIN_GAP +
      Math.max(0, v * VEHICLE.CAR_FOLLOW_TIME + (v * dv) / (2 * Math.sqrt(VEHICLE.MAX_ACCEL * VEHICLE.COMFORT_DECEL)));
    const gap = Math.max(0.1, obstacle.distance - this.halfLength);
    const ratio = sStar / gap;
    // IDM 隐式给出减速需求，这里换算为等效限速
    const accel = VEHICLE.MAX_ACCEL * (1 - ratio * ratio);
    if (accel >= 0) return v0; // 跟车无压力，不额外约束
    // 负加速度 -> 允许在一帧内降到的速度
    return Math.max(0, v + accel * 0.5);
  }

  /** 将路径位姿写入 Three.js 对象（位置 + 朝向，车头本地 +Z 对齐切向） */
  private updateTransform(): void {
    this.current.edge.path.getPositionAt(this.current.s, tmpPos);
    this.current.edge.path.getTangentAt(this.current.s, tmpTan);
    this.group.position.copy(tmpPos);
    // lookAt 让本地 +Z 指向行驶方向
    this.group.lookAt(tmpPos.clone().add(tmpTan));
  }
}
