import * as THREE from 'three';
import {
  GRID_N,
  INTERSECTION_HALF,
  LANE_OFFSET,
  gridToWorld,
} from '../config/constants';
import { PathCurve } from './PathCurve';

/** 边类型：路段车道 / 路口内转向连接 */
export type EdgeKind = 'lane' | 'connection';

/** 行驶方向：'E' 东(+X) 'W' 西(-X) 'S' 南(-Z) 'N' 北(+Z) */
export type Heading = 'E' | 'W' | 'S' | 'N';

/** 路口的四个进口方向（来车方向），与行驶方向同枚举 */
export type Approach = Heading;

export interface LaneEdge {
  kind: 'lane';
  id: string;
  /** 道路轴向：沿 X 或沿 Z */
  axis: 'x' | 'z';
  /** 固定索引：axis=x 时为 j（所在横线），axis=z 时为 i（所在纵线） */
  line: number;
  /** 沿行驶方向经过的路口序号（0..GRID_N-1） */
  fromNode: number;
  toNode: number;
  dir: 1 | -1;
  heading: Heading;
  path: PathCurve;
  /** 终点停车线（世界坐标），红灯时车辆在此之前等待 */
  stopLine: THREE.Vector3;
  /** 终点路口索引 [i, j] */
  endIntersection: [number, number];
  /** 进口方向（车辆从哪个方向驶入终点路口） */
  approach: Approach;
}

export interface ConnectionEdge {
  kind: 'connection';
  id: string;
  fromLaneId: string;
  toLaneId: string;
  /** 转向类型 */
  turn: 'left' | 'straight' | 'right';
  /** 进入下一条路段后的行驶方向 */
  heading: Heading;
  path: PathCurve;
}

export type RoadEdge = LaneEdge | ConnectionEdge;

/** 方向向量 */
const HEADING_VECTOR: Record<Heading, THREE.Vector3> = {
  E: new THREE.Vector3(1, 0, 0),
  W: new THREE.Vector3(-1, 0, 0),
  N: new THREE.Vector3(0, 0, 1),
  S: new THREE.Vector3(0, 0, -1),
};

/** 各方向的左转/右转结果 */
const TURN_MAP: Record<Heading, { left: Heading; right: Heading }> = {
  E: { left: 'N', right: 'S' },
  W: { left: 'S', right: 'N' },
  N: { left: 'W', right: 'E' },
  S: { left: 'E', right: 'W' },
};

/**
 * 城市路网：GRID_N × GRID_N 个路口组成的方格网
 * 每条道路双向各一条车道；车辆在 lane 边上行驶，路口内通过 connection 边完成转向。
 */
export class RoadNetwork {
  /** 所有路段车道边，id -> edge */
  readonly lanes = new Map<string, LaneEdge>();
  /** 所有路口连接边，id -> edge */
  readonly connections = new Map<string, ConnectionEdge>();
  /** 每个路口每个进口方向对应的连接边列表 */
  readonly intersectionConnections = new Map<string, ConnectionEdge[]>();
  /** 全部 lane 边列表（随机出生点用） */
  readonly laneList: LaneEdge[] = [];
  /** 路口世界坐标 [i][j] -> Vector3 */
  readonly intersections: THREE.Vector3[][] = [];

  constructor() {
    this.buildIntersections();
    this.buildLanes();
    this.buildConnections();
  }

  /** 路口索引键 */
  static key(i: number, j: number): string {
    return `${i},${j}`;
  }

  private buildIntersections(): void {
    for (let i = 0; i < GRID_N; i++) {
      this.intersections[i] = [];
      for (let j = 0; j < GRID_N; j++) {
        const { x, z } = gridToWorld(i, j);
        this.intersections[i][j] = new THREE.Vector3(x, 0, z);
      }
    }
  }

  /**
   * 生成全部 lane 边。
   * 车道中心偏移规则：
   *  东向(E)/北向(N) 车道位于道路中线左侧（对 +X/+Z 行驶方向而言左侧为 +Z/+X），
   *  西向(W)/南向(S) 车道位于另一侧，保证双向车辆靠右行驶。
   */
  private buildLanes(): void {
    // 横向道路（沿 X 轴）：固定 j，连接 (i,j)-(i+1,j)
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N - 1; i++) {
        const a = this.intersections[i][j];
        const b = this.intersections[i + 1][j];
        this.addLane(`h_${j}_${i}_E`, 'x', j, i, i + 1, 1, 'E', a, b, +LANE_OFFSET, [i + 1, j], 'W');
        this.addLane(`h_${j}_${i}_W`, 'x', j, i + 1, i, -1, 'W', b, a, -LANE_OFFSET, [i, j], 'E');
      }
    }

    // 纵向道路（沿 Z 轴）：固定 i，连接 (i,j)-(i,j+1)
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        const a = this.intersections[i][j];
        const b = this.intersections[i][j + 1];
        // 向北行驶(+Z)，车道中心偏 +X
        this.addLane(`v_${i}_${j}_N`, 'z', i, j, j + 1, 1, 'N', a, b, +LANE_OFFSET, [i, j + 1], 'S');
        // 向南行驶(-Z)，车道中心偏 -X
        this.addLane(`v_${i}_${j}_S`, 'z', i, j + 1, j, -1, 'S', b, a, -LANE_OFFSET, [i, j], 'N');
      }
    }
  }

  private addLane(
    id: string,
    axis: 'x' | 'z',
    line: number,
    fromNode: number,
    toNode: number,
    dir: 1 | -1,
    heading: Heading,
    nodeA: THREE.Vector3,
    nodeB: THREE.Vector3,
    lateral: number,
    endIntersection: [number, number],
    approach: Approach,
  ): void {
    // 路段起止点退到路口正方形边界之外，路口区域交给 connection 边
    const fwd = nodeB.clone().sub(nodeA).normalize();
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x); // 行驶方向的右侧法向（靠右行驶）
    const start = nodeA.clone().addScaledVector(fwd, INTERSECTION_HALF).addScaledVector(side, lateral);
    const end = nodeB.clone().addScaledVector(fwd, -INTERSECTION_HALF).addScaledVector(side, lateral);
    start.y = 0;
    end.y = 0;

    const path = new PathCurve([start, end], 4);
    // 停车线位于路段终点（路口边界处）
    const stopLine = end.clone();

    const edge: LaneEdge = {
      kind: 'lane',
      id,
      axis,
      line,
      fromNode,
      toNode,
      dir,
      heading,
      path,
      stopLine,
      endIntersection,
      approach,
    };
    this.lanes.set(id, edge);
    this.laneList.push(edge);
  }

  /** 生成每个路口每个进口的直行/左转/右转连接边 */
  private buildConnections(): void {
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        const center = this.intersections[i][j];
        const list: ConnectionEdge[] = [];
        for (const approach of ['E', 'W', 'S', 'N'] as Approach[]) {
          const inLane = this.findLaneInto(i, j, approach);
          if (!inLane) continue; // 边界路口没有该方向的来车
          for (const turn of ['left', 'straight', 'right'] as const) {
            const outHeading =
              turn === 'straight' ? approach : TURN_MAP[approach][turn];
            const outLane = this.findLaneOutOf(i, j, outHeading);
            if (!outLane) continue; // 出界方向不存在
            const conn = this.buildConnection(center, inLane, outLane, turn);
            this.connections.set(conn.id, conn);
            list.push(conn);
          }
        }
        this.intersectionConnections.set(RoadNetwork.key(i, j), list);
      }
    }
  }

  /** 找到从 approach 方向驶入路口 (i,j) 的 lane 边 */
  private findLaneInto(i: number, j: number, approach: Approach): LaneEdge | undefined {
    // 车辆从 approach 方向来，意味着它的行驶方向指向路口中心
    switch (approach) {
      case 'W': // 从西边来，向东行驶，终点为 (i,j)
        return i > 0 ? this.lanes.get(`h_${j}_${i - 1}_E`) : undefined;
      case 'E': // 从东边来，向西行驶
        return i < GRID_N - 1 ? this.lanes.get(`h_${j}_${i}_W`) : undefined;
      case 'S': // 从南边来，向北行驶
        return j > 0 ? this.lanes.get(`v_${i}_${j - 1}_N`) : undefined;
      case 'N': // 从北边来，向南行驶
        return j < GRID_N - 1 ? this.lanes.get(`v_${i}_${j}_S`) : undefined;
    }
  }

  /** 找到从路口 (i,j) 沿 heading 方向驶出的 lane 边 */
  private findLaneOutOf(i: number, j: number, heading: Heading): LaneEdge | undefined {
    switch (heading) {
      case 'E':
        return i < GRID_N - 1 ? this.lanes.get(`h_${j}_${i}_E`) : undefined;
      case 'W':
        return i > 0 ? this.lanes.get(`h_${j}_${i - 1}_W`) : undefined;
      case 'N':
        return j < GRID_N - 1 ? this.lanes.get(`v_${i}_${j}_N`) : undefined;
      case 'S':
        return j > 0 ? this.lanes.get(`v_${i}_${j - 1}_S`) : undefined;
    }
  }

  /** 用进/出 lane 的端点构造路口内连接路径 */
  private buildConnection(
    center: THREE.Vector3,
    inLane: LaneEdge,
    outLane: LaneEdge,
    turn: ConnectionEdge['turn'],
  ): ConnectionEdge {
    const start = inLane.path.points[inLane.path.points.length - 1].clone();
    const end = outLane.path.points[0].clone();
    const controls = [start];

    if (turn === 'straight') {
      // 直行：直线穿过路口
      controls.push(end);
    } else {
      // 转弯：以路口中心附近为折点，PathCurve 内部会做圆角
      const corner = center.clone();
      // 折点取进出口车道中心线的交点：用 start/end 各自轴线求交
      if (inLane.axis !== outLane.axis) {
        corner.set(
          inLane.axis === 'x' ? start.x : end.x,
          0,
          inLane.axis === 'x' ? end.z : start.z,
        );
      }
      controls.push(corner, end);
    }

    const id = `${inLane.id}->${outLane.id}`;
    const conn: ConnectionEdge = {
      kind: 'connection',
      id,
      fromLaneId: inLane.id,
      toLaneId: outLane.id,
      turn,
      heading: outLane.heading,
      path: new PathCurve(controls, 1.5),
    };
    return conn;
  }

  /** 获取某条 lane 在终点路口可选择的全部连接边 */
  getOutgoingConnections(laneId: string): ConnectionEdge[] {
    const lane = this.lanes.get(laneId);
    if (!lane) return [];
    const [i, j] = lane.endIntersection;
    const all = this.intersectionConnections.get(RoadNetwork.key(i, j)) ?? [];
    return all.filter((c) => c.fromLaneId === laneId);
  }

  getEdge(id: string): RoadEdge | undefined {
    return this.lanes.get(id) ?? this.connections.get(id);
  }

  getHeadingVector(h: Heading): THREE.Vector3 {
    return HEADING_VECTOR[h];
  }
}
