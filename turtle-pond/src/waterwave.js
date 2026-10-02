/**
 * 水波物理引擎 —— 真实二维波动方程（有限差分法）
 *
 * 为什么不用"同心椭圆圈 + 淡出"？
 *   那种假涟漪的致命伤是：多个波相遇时不会互相干涉。真实的两个水波相遇，
 *   波峰叠波峰会更高、波峰叠波谷会互相抵消。缺了这个，水就"假"。
 *
 * 本模块在一个比像素粗的网格上（默认 7px 一格）逐帧求解离散波动方程：
 *
 *      ∂²h/∂t² = c² ∇²h
 *
 * 离散化后每一步：
 *      h_next[i] = ( 2·h[i] − h_prev[i] + r·(Σ四邻 − 4·h[i]) ) · damping
 *
 * 其中 r = (c·dt/dx)²。damping < 1 让波随时间耗散能量、自然平息
 * （真实水面拍打后会静下来，而不是永远振荡）。
 *
 * 渲染不直接用高度 h，而用**高度梯度**近似水面的局部斜率——
 * 真实水面靠斜率折射光线：面向光源的坡面变亮，背向的变暗。
 * 这就是水波看起来有立体感和"焦散闪光"的原因。
 *
 * 零依赖、纯 Canvas 2D 数据（Float32Array），不依赖 WebGL。
 */

/** 每格代表多少 CSS 像素（越小越精细、越费） */
const CELL = 7;
/** 波速系数（网格单位），越大波传得越快 */
const WAVE_C = 0.5;
/** 阻尼：<1 才会平息。越接近 1 波存续越久 */
const DAMPING = 0.985;
/** 传播系数 r = (c·dt/dx)²，稳定要求 r ≤ 0.5 */
const R = WAVE_C * WAVE_C;

export class WaterWaveField {
  /**
   * @param {number} w 画布宽（CSS px）
   * @param {number} h 画布高（CSS px）
   * @param {number} [cell] 每格像素
   * @param {object} [opts] 手感参数（来自 CONFIG.natural）
   * @param {number} [opts.damping=0.985] 阻尼，越小波越快平息、扩散越近
   * @param {number} [opts.ambientGap=0.35] 环境微扰间隔（秒）；≤0 关闭
   * @param {number} [opts.ambientStr=0.09] 环境微扰基准强度
   */
  constructor(w, h, cell = CELL, opts = {}) {
    this.cell = cell;
    this.damping = opts.damping ?? DAMPING;
    this.ambientGap = opts.ambientGap ?? 0.35;
    this.ambientStr = opts.ambientStr ?? 0.09;
    this.resize(w, h);
    // 环境微扰计时（无操作时水面也不该是完全死水）
    this._ambientT = 0;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.cols = Math.max(4, Math.ceil(w / this.cell) + 2);
    this.rows = Math.max(4, Math.ceil(h / this.cell) + 2);
    const n = this.cols * this.rows;
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
    // 复用的大缓冲：供渲染阶段读取（避免每帧新建）
    this._gradIdx = 0;
  }

  /** 网格坐标 → 数组下标 */
  _idx(gx, gy) {
    return gy * this.cols + gx;
  }

  /** 像素坐标 → 网格坐标（带边界钳制） */
  _toGrid(x, y) {
    const gx = Math.min(this.cols - 2, Math.max(1, Math.round(x / this.cell) + 1));
    const gy = Math.min(this.rows - 2, Math.max(1, Math.round(y / this.cell) + 1));
    return { gx, gy };
  }

  /**
   * 扰动水面 —— 在 (x,y) 处落下一个"软坑"
   * @param {number} x,y 像素坐标
   * @param {number} strength 强度（正值=向下按压，负值=向上顶）
   * @param {number} [radius] 影响半径（网格格数）
   */
  disturb(x, y, strength = 1, radius = 2) {
    const { gx, gy } = this._toGrid(x, y);
    const r = Math.max(1, Math.round(radius));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 1 || ny < 1 || nx > this.cols - 2 || ny > this.rows - 2) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        // 半径衰减：中心强、边缘弱（软坑，而非单格尖刺）
        const falloff = 1 - d / (r + 0.001);
        this.cur[this._idx(nx, ny)] += strength * falloff * falloff;
      }
    }
  }

  /**
   * 沿一条线段连续扰动 —— 供鼠标快速拖动时补插值，
   * 避免"移动太快 → 尾迹断裂成一颗颗孤立的波"。
   */
  disturbLine(x0, y0, x1, y1, strength = 1, radius = 2) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
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
   * @param {{wake:boolean}} [opts] wake=true 时叠加极轻微的环境微扰
   */
  update(dt, opts = {}) {
    const { cols, rows, cur, prev, next } = this;
    // 固定时间步长推进（波动方程对 dt 敏感，直接吃真实 dt 会数值爆炸）
    const steps = 1;
    for (let s = 0; s < steps; s++) {
      for (let y = 1; y < rows - 1; y++) {
        const row = y * cols;
        for (let x = 1; x < cols - 1; x++) {
          const i = row + x;
          const lap = cur[i - 1] + cur[i + 1] + cur[i - cols] + cur[i + cols] - 4 * cur[i];
          let v = (2 * cur[i] - prev[i] + R * lap) * this.damping;
          // 数值安全钳制，防止极端扰动炸开
          if (v > 4) v = 4; else if (v < -4) v = -4;
          next[i] = v;
        }
      }
      // 边界保持静止（0），让波在外边界自然反射/吸收
      prev.set(cur);
      cur.set(next);
    }

    // 环境微扰：偶尔在随机位置落一个极轻的扰动，让静止水面也有呼吸感
    // ambientGap ≤ 0 表示关闭（水面完全平静，只有主动扰动才起波）
    this._ambientT += dt;
    if (opts.ambient !== false && this.ambientGap > 0 && this._ambientT > this.ambientGap) {
      this._ambientT = 0;
      const rx = Math.random() * this.w;
      const ry = Math.random() * this.h;
      // 只有水面区域才扰动（由调用方 world 决定；这里用一个回调）
      if (this.ambientFilter ? this.ambientFilter(rx, ry) : true) {
        this.disturb(rx, ry, this.ambientStr * (0.7 + Math.random() * 0.6), 3);
      }
    }
  }

  /**
   * 取某点的高度梯度（≈水面局部斜率），用于折射明暗着色
   * @returns {{h:number, gx:number, gy:number}} 归一化高度与两个方向的梯度
   */
  sample(x, y) {
    const gx = Math.min(this.cols - 2, Math.max(1, Math.round(x / this.cell) + 1));
    const gy = Math.min(this.rows - 2, Math.max(1, Math.round(y / this.cell) + 1));
    const i = gy * this.cols + gx;
    const hL = this.cur[i - 1], hR = this.cur[i + 1];
    const hU = this.cur[i - this.cols], hD = this.cur[i + this.cols];
    return {
      h: this.cur[i],
      gx: (hR - hL) * 0.5,
      gy: (hD - hU) * 0.5,
    };
  }

  /** 当前水面总能量（测试用：验证波会衰减到 0） */
  energy() {
    let e = 0;
    const n = this.cur.length;
    for (let i = 0; i < n; i++) e += this.cur[i] * this.cur[i];
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
