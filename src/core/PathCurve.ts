import * as THREE from 'three';

/**
 * PathCurve：由控制点折线密集采样得到的行驶路径
 * - 内部缓存等弧长表，支持按“已行驶距离”以恒定线速度取点
 * - 直线段直接用控制点，转弯段用二次贝塞尔过渡并细分采样
 */
export class PathCurve {
  /** 采样点列表 */
  readonly points: THREE.Vector3[] = [];
  /** 每个采样点对应的累计弧长 */
  readonly cumLengths: number[] = [];
  /** 总长度 */
  get length(): number {
    return this.cumLengths[this.cumLengths.length - 1] ?? 0;
  }

  /**
   * @param controlPoints 控制点折线
   * @param sampleStep 采样步长（米），越小越平滑
   */
  constructor(controlPoints: THREE.Vector3[], sampleStep = 2) {
    if (controlPoints.length < 2) {
      throw new Error('PathCurve 至少需要 2 个控制点');
    }
    this.build(controlPoints, sampleStep);
  }

  /** 对折线的每个折点用二次贝塞尔做圆角过渡，再统一重采样 */
  private build(controlPoints: THREE.Vector3[], sampleStep: number): void {
    const rounded: THREE.Vector3[] = [];
    const last = controlPoints.length - 1;

    rounded.push(controlPoints[0].clone());
    for (let i = 1; i < last; i++) {
      const prev = controlPoints[i - 1];
      const corner = controlPoints[i];
      const next = controlPoints[i + 1];

      // 圆角半径取相邻段长的 25%，并限制上限，避免半径过大冲出车道
      const d1 = corner.distanceTo(prev);
      const d2 = corner.distanceTo(next);
      const radius = Math.min(d1, d2) * 0.25;

      const t1 = radius / d1;
      const t2 = radius / d2;
      const pIn = corner.clone().lerp(prev, t1); // 进入圆角的切点
      const pOut = corner.clone().lerp(next, t2); // 离开圆角的切点

      // 直线段推进到入切点
      rounded.push(pIn);
      // 二次贝塞尔：控制点为原折点，细分 8 段
      const SEG = 8;
      for (let s = 1; s <= SEG; s++) {
        const t = s / SEG;
        const a = pIn.clone().lerp(corner, t);
        const b = corner.clone().lerp(pOut, t);
        rounded.push(a.lerp(b, t));
      }
    }
    rounded.push(controlPoints[last].clone());

    // 按固定步长重采样，保证相邻采样点间距近似相等
    this.resample(rounded, sampleStep);
  }

  /** 等步长重采样并计算累计弧长 */
  private resample(dense: THREE.Vector3[], sampleStep: number): void {
    this.points.length = 0;
    this.cumLengths.length = 0;
    this.points.push(dense[0].clone());
    this.cumLengths.push(0);

    let total = 0;
    let carry = 0; // 上一段未消费的长度
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i];
      const segLen = a.distanceTo(b);
      if (segLen < 1e-6) continue;
      const dir = b.clone().sub(a);

      let consumed = carry;
      while (consumed + sampleStep <= segLen) {
        consumed += sampleStep;
        const p = a.clone().addScaledVector(dir, consumed / segLen);
        total += sampleStep;
        this.points.push(p);
        this.cumLengths.push(total);
      }
      carry = segLen - consumed;
    }

    // 补上终点
    const tailGap = dense[dense.length - 1].distanceTo(this.points[this.points.length - 1]);
    if (tailGap > 1e-4) {
      this.points.push(dense[dense.length - 1].clone());
      total += tailGap;
      this.cumLengths.push(total);
    }
  }

  /** 二分查找累计长度对应的采样区间 */
  private locate(distance: number): { index: number; t: number } {
    const d = THREE.MathUtils.clamp(distance, 0, this.length);
    let lo = 0;
    let hi = this.cumLengths.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumLengths[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = this.cumLengths[hi] - this.cumLengths[lo];
    const t = span < 1e-9 ? 0 : (d - this.cumLengths[lo]) / span;
    return { index: lo, t };
  }

  /** 取路径上指定距离处的位置 */
  getPositionAt(distance: number, target: THREE.Vector3): THREE.Vector3 {
    const { index, t } = this.locate(distance);
    const a = this.points[index];
    const b = this.points[Math.min(index + 1, this.points.length - 1)];
    return target.copy(a).lerp(b, t);
  }

  /** 取路径上指定距离处的单位切向（车头方向） */
  getTangentAt(distance: number, target: THREE.Vector3): THREE.Vector3 {
    const { index } = this.locate(distance);
    const a = this.points[index];
    const b = this.points[Math.min(index + 1, this.points.length - 1)];
    return target.copy(b).sub(a).normalize();
  }
}
