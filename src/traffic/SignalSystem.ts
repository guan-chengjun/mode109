import { GRID_N, SIGNAL_CYCLE } from '../config/constants';
import type { Approach } from '../core/RoadNetwork';

/** 信号灯灯态 */
export type LightState = 'green' | 'yellow' | 'red';

/** 放行相位：horizontal = 东西向通行，vertical = 南北向通行 */
type Phase = 'horizontal' | 'vertical';

interface Controller {
  phase: Phase;
  /** 当前相位内已经过的时间（秒） */
  timer: number;
  /** 周期时长缓存 */
  green: number;
  yellow: number;
  allRed: number;
}

const PHASE_GREEN: number = SIGNAL_CYCLE.GREEN;
const PHASE_YELLOW: number = SIGNAL_CYCLE.YELLOW;
const PHASE_ALL_RED: number = SIGNAL_CYCLE.ALL_RED;

/**
 * 信号灯系统
 * 每个路口一个控制器，两相位固定配时：
 *   水平向绿 -> 水平向黄 -> 全红清空 -> 垂直向绿 -> 垂直向黄 -> 全红清空 -> 循环
 * 各路口加入确定性相位差，避免全城同时变灯造成步调一致的拥堵。
 */
export class SignalSystem {
  private controllers: Controller[][] = [];

  constructor(seed = 20261122) {
    let s = seed;
    const rand = () => {
      // 确定性 LCG 伪随机，保证每次启动灯态一致、可复现
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const total = 2 * (PHASE_GREEN + PHASE_YELLOW + PHASE_ALL_RED);
    for (let i = 0; i < GRID_N; i++) {
      this.controllers[i] = [];
      for (let j = 0; j < GRID_N; j++) {
        const phase: Phase = (i + j) % 2 === 0 ? 'horizontal' : 'vertical';
        this.controllers[i][j] = {
          phase,
          // 随机相位差（整周期内），打散同步节奏
          timer: Math.floor(rand() * total),
          green: PHASE_GREEN,
          yellow: PHASE_YELLOW,
          allRed: PHASE_ALL_RED,
        };
      }
    }
  }

  /** 推进所有路口信号配时，dt 为仿真秒 */
  update(dt: number): void {
    const phaseLen = PHASE_GREEN + PHASE_YELLOW + PHASE_ALL_RED;
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        const c = this.controllers[i][j];
        c.timer += dt;
        if (c.timer >= phaseLen) {
          c.timer -= phaseLen;
          c.phase = c.phase === 'horizontal' ? 'vertical' : 'horizontal';
        }
      }
    }
  }

  /** 查询某路口某进口方向当前灯态 */
  getState(i: number, j: number, approach: Approach): LightState {
    const c = this.controllers[i][j];
    // 水平相位放行 E/W 进口；垂直相位放行 N/S 进口
    const approachIsHorizontal = approach === 'E' || approach === 'W';
    const phaseMatches =
      (c.phase === 'horizontal' && approachIsHorizontal) ||
      (c.phase === 'vertical' && !approachIsHorizontal);

    if (!phaseMatches) return 'red';
    if (c.timer < c.green) return 'green';
    if (c.timer < c.green + c.yellow) return 'yellow';
    return 'red'; // 全红清空相位
  }

  /** 供可视化使用：获取路口当前相位（水平/垂直）与相位内计时 */
  getControllerInfo(i: number, j: number): { phase: Phase; timer: number } {
    const c = this.controllers[i][j];
    return { phase: c.phase, timer: c.timer };
  }
}
