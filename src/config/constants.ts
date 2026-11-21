/**
 * 全局仿真配置
 * 所有可调参数集中在此处，便于后续扩展与调参。
 * 世界坐标约定：X 轴向东，Z 轴向北，Y 轴向上；车辆本地 +Z 为车头方向。
 */

/** 路网规模：N×N 个路口（N-1 个街区） */
export const GRID_N = 4;
/** 相邻路口中心间距（世界单位，1 单位 ≈ 1 米） */
export const BLOCK_SPACING = 90;
/** 单条道路总宽度（含双向车道与两侧停车带） */
export const ROAD_WIDTH = 20;
/** 行驶车道中心线相对道路中线的横向偏移（双向各一条车道） */
export const LANE_OFFSET = 4.5;
/** 路边停车带中心线横向偏移 */
export const PARKING_OFFSET = 8.2;
/** 人行道宽度 */
export const SIDEWALK_WIDTH = 6;

/** 路口（交叉口正方形区域）半边长，进入该区域即视为在路口内 */
export const INTERSECTION_HALF = ROAD_WIDTH / 2;

/** 网格坐标 -> 世界坐标（路口 i/j 从 0 开始，整体居中于原点） */
export function gridToWorld(i: number, j: number): { x: number; z: number } {
  const offset = ((GRID_N - 1) * BLOCK_SPACING) / 2;
  return { x: i * BLOCK_SPACING - offset, z: j * BLOCK_SPACING - offset };
}

/** 信号灯周期（秒，仿真时间） */
export const SIGNAL_CYCLE = {
  GREEN: 14,
  YELLOW: 3,
  ALL_RED: 1.5, // 全红清空相位，防止上一相位车辆滞留路口
} as const;

/** 车辆动力学参数 */
export const VEHICLE = {
  MAX_SPEED: 14, // 最高速度 m/s（约 50 km/h）
  MAX_ACCEL: 3.2, // 最大加速度 m/s²
  COMFORT_DECEL: 4.5, // 舒适减速度 m/s²
  EMERGENCY_DECEL: 9, // 紧急制动减速度 m/s²
  MIN_GAP: 2.2, // 跟车最小静止间距 m
  CAR_FOLLOW_TIME: 1.1, // 期望跟车时距 s
  SENSOR_DISTANCE: 26, // 前方障碍探测距离 m
  SENSOR_HALF_WIDTH: 1.6, // 探测通道半宽 m（略小于车道，避免误判相邻车道）
  VEHICLE_HALF_LENGTH: 2.3, // 车辆包围盒半长（碰撞判定用）
} as const;

/** 初始车辆数与容量上限 */
export const TRAFFIC = {
  INITIAL_COUNT: 26,
  MAX_COUNT: 80,
  /** 路口转向概率：左转 / 直行 / 右转 */
  TURN_CHANCE: { LEFT: 0.14, STRAIGHT: 0.7, RIGHT: 0.16 },
} as const;

/** 行人参数 */
export const PEDESTRIAN = {
  COUNT: 16,
  SPEED: 0.9,
} as const;

/** 路边停放车辆数 */
export const PARKED_CAR_COUNT = 24;

/** 远程 GLB 模型（jsDelivr CDN，CORS 开放；加载失败/超时自动降级为程序化几何） */
export const REMOTE_MODELS = {
  /**
   * Ferrari.glb 来自 three.js 官方示例仓库（MIT），
   * 通过 jsDelivr 镜像分发，原始文件为 FBX Z-up，加载后需朝向修正（见 model-loader.ts）。
   */
  CAR: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/ferrari.glb',
  /** 加载超时时间 ms */
  TIMEOUT_MS: 10000,
} as const;

/** 程序化车辆配色（PBR 车身色） */
export const CAR_COLORS = [
  0xc0392b, // 红
  0x2c3e50, // 深灰蓝
  0xecf0f1, // 白
  0x2980b9, // 蓝
  0xf39c12, // 橙
  0x7f8c8d, // 银灰
  0x27ae60, // 绿
  0x8e44ad, // 紫
  0xf1c40f, // 黄（出租车）
  0x34495e, // 炭黑
] as const;

/** 程序化车型尺寸（宽、长、高） */
export const CAR_TYPES = {
  sedan: { width: 1.9, length: 4.4, height: 1.45 },
  suv: { width: 2.0, length: 4.8, height: 1.75 },
  compact: { width: 1.75, length: 3.8, height: 1.4 },
  bus: { width: 2.5, length: 10.5, height: 3.0 },
  truck: { width: 2.4, length: 8.5, height: 3.2 },
} as const;
export type CarTypeName = keyof typeof CAR_TYPES;

/** 各车型生成权重（轿车为主，公交/货车少量点缀） */
export const CAR_TYPE_WEIGHTS: ReadonlyArray<readonly [CarTypeName, number]> = [
  ['sedan', 0.46],
  ['compact', 0.24],
  ['suv', 0.18],
  ['truck', 0.07],
  ['bus', 0.05],
];

/** 雾效与天空 */
export const SCENE = {
  FOG_COLOR: 0xcfe3f2,
  FOG_NEAR: 180,
  FOG_FAR: 520,
  SKY_TOP: 0x8fb9e8,
  SKY_BOTTOM: 0xdcecf7,
} as const;
