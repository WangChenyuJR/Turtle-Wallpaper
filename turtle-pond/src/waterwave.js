/**
 * 水波物理引擎 —— 一维水面高度场（侧视剖面，阶段 8-④）
 *
 * 为什么从 2D 网格改成 1D？
 *   侧视剖面下，"水"是画面里的一条水平带，它真正的自由度只有**沿 x 的高度**。
 *   原来的 2D 网格（CELL=7，1920×1080 ≈ 42k 格/帧）会从扰动点向四面八方扩成同心环 ——
 *   那是**俯视**水面才有的现象。放在侧视图上就是"一圈圈往外推的环"，
 *   而且改不掉：2D 波动方程从点源出发的解本来就是径向外扩，这是数学性质不是调参问题。
 *   改成沿 x 的一维高度场后，波**只能沿水平传播**，物理上不可能成环，
 *   天然就是"拖拽 / 传播"的手感；每帧开销也从 42k 格降到 ~480 格（两个数量级）。
 *
 * 离散一维波动方程（有限差分）：
 *      h_next[i] = ( 2·h[i] − h_prev[i] + r·(h[i−1] − 2·h[i] + h[i+1]) ) · damping
 *   其中 r = (c·dt/dx)²，稳定要求 r ≤ 0.5。damping < 1 让波耗散、自然平息。
 *
 * 兼容性：
 *   `disturb(x, y, ...)` / `sample(x, y)` 仍接受 y 参数，但**1D 场里 y 不参与定位**
 *   （深度的影响由调用方折算进 strength），这样 fish/main 等调用处不必改签名。
 */

/** 每格代表多少 CSS 像素（只沿 x；1D 下取小一点也很便宜） */
const CELL = 4;
/** 波速系数（网格单位），越大波传得越快 */
const WAVE_C = 0.5;
/** 阻尼：<1 才会平息。越接近 1 波存续越久 */
const DAMPING = 0.985;
/** 传播系数 r = (c·dt/dx)²，稳定要求 r ≤ 0.5 */
const R = WAVE_C * WAVE_C;

export class WaterWaveField {
  /**
   * @param {number} w 画布宽（CSS px）
   * @param {number} h 画布高（CSS px）—— 1D 场不切分 y，仅记录备用
   * @param {number} [cell] 沿 x 每格像素
   * @param {object} [opts] 手感参数（来自 CONFIG.natural）
   * @param {number} [opts.damping=0.985] 阻尼，越小波越快平息、传播越短
   * @param {number} [opts.ambientGap=0.35] 环境微扰间隔（秒）；≤0 关闭
   * @param {number} [opts.ambientStr=0.09] 环境微扰基准强度
   */
  constructor(w, h, cell = CELL, opts = {}) {
    this.cell = cell;
    this.damping = opts.damping ?? DAMPING;
    this.ambientGap = opts.ambientGap ?? 0.35;
    this.ambientStr = opts.ambientStr ?? 0.09;
    /** 维度标记：1 = 一维水面高度场 */
    this.dim = 1;
    /** 由调用方设置：`(x) => bool`，只有返回 true 的列才允许环境微扰 */
    this.ambientFilter = null;
    this.resize(w, h);
    // 环境微扰计时（无操作时水面也不该是完全死水）
    this._ambientT = 0;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.cols = Math.max(4, Math.ceil(w / this.cell) + 2);
    this.rows = 1;                        // 兼容旧读法：1D 场只有一行
    const n = this.cols;
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
  }

  /** 像素 x → 网格列（带边界钳制） */
  _col(x) {
    return Math.min(this.cols - 2, Math.max(1, Math.round(x / this.cell) + 1));
  }

  /**
   * 扰动水面 —— 在 x 处落下一个"软坑"
   * @param {number} x 像素坐标（唯一定位依据）
   * @param {number} y 仅作签名兼容，1D 场不使用
   * @param {number} strength 强度（正值=向下按压，负值=向上顶）
   * @param {number} [radius] 影响半径（格数）
   */
  disturb(x, y, strength = 1, radius = 2) {
    const c = this._col(x);
    const r = Math.max(1, Math.round(radius));
    for (let d = -r; d <= r; d++) {
      const i = c + d;
      if (i < 1 || i > this.cols - 2) continue;
      // 半径衰减：中心强、边缘弱（软坑，而非单格尖刺）
      const falloff = 1 - Math.abs(d) / (r + 0.001);
      this.cur[i] += strength * falloff * falloff;
    }
  }

  /**
   * 沿一条线段连续扰动 —— 供鼠标快速拖动 / 生物游动时补插值，
   * 避免"移动太快 → 尾迹断裂成一颗颗孤立的波"。
   */
  disturbLine(x0, y0, x1, y1, strength = 1, radius = 2) {
    const dist = Math.abs(x1 - x0);
    // 按半格步长补点，保证不断线
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.6)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disturb(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, strength, radius);
    }
  }

  /**
   * 推进一帧波动方程
   * @param {number} dt 秒
   * @param {{ambient?:boolean}} [opts] ambient=false 时不做环境微扰
   */
  update(dt, opts = {}) {
    const { cols, cur, prev, next } = this;
    // 固定时间步长推进（波动方程对 dt 敏感，直接吃真实 dt 会数值爆炸）
    for (let x = 1; x < cols - 1; x++) {
      const lap = cur[x - 1] + cur[x + 1] - 2 * cur[x];
      let v = (2 * cur[x] - prev[x] + R * lap) * this.damping;
      // 数值安全钳制，防止极端扰动炸开
      if (v > 4) v = 4; else if (v < -4) v = -4;
      next[x] = v;
    }
    prev.set(cur);
    cur.set(next);
    // 两端轻微吸收：真实水面在岸边就碎了，不该在池壁之间永远来回弹
    cur[1] *= 0.985;
    cur[cols - 2] *= 0.985;

    // 环境微扰：偶尔在随机位置落一个极轻的扰动，让静止水面也有呼吸感
    // ambientGap ≤ 0 表示关闭（水面完全平静，只有主动扰动才起波）
    this._ambientT += dt;
    if (opts.ambient !== false && this.ambientGap > 0 && this._ambientT > this.ambientGap) {
      this._ambientT = 0;
      const rx = Math.random() * this.w;
      // 只有水面区域才扰动（由调用方 world 决定）
      if (!this.ambientFilter || this.ambientFilter(rx)) {
        this.disturb(rx, 0, this.ambientStr * (0.7 + Math.random() * 0.6), 3);
      }
    }
  }

  /** 某 x 处的水面高度（网格单位，约 ±0.5 量级）—— 岸边浮物跟随用 */
  heightAt(x) {
    return this.cur[this._col(x)];
  }

  /** 某 x 处的水面斜率（网格单位 / 格） */
  slopeAt(x) {
    const c = this._col(x);
    return (this.cur[c + 1] - this.cur[c - 1]) * 0.5;
  }

  /**
   * 取某点的高度与梯度 —— 兼容旧接口。
   * 1D 场里竖直方向没有自由度，`gy` 恒为 0。
   * @returns {{h:number, gx:number, gy:number}}
   */
  sample(x, y) {
    const c = this._col(x);
    return {
      h: this.cur[c],
      gx: (this.cur[c + 1] - this.cur[c - 1]) * 0.5,
      gy: 0,
    };
  }

  /** 当前水面总能量（测试用：验证波会衰减到 0、且不在 y 方向扩散） */
  energy() {
    let e = 0;
    for (let i = 0; i < this.cols; i++) e += this.cur[i] * this.cur[i];
    return e;
  }

  /** 平滑地清空水面（切换场景/重置时用） */
  calm() {
    this.cur.fill(0);
    this.prev.fill(0);
    this.next.fill(0);
  }
}

export const WATER_WAVE_CONST = { CELL, WAVE_C, DAMPING, R };
