/**
 * 通用数学与工具函数
 */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 限制向量长度 */
export function limit(x, y, max) {
  const m = Math.hypot(x, y);
  if (m > max && m > 0) {
    const s = max / m;
    return { x: x * s, y: y * s };
  }
  return { x, y };
}

/**
 * 确定性伪随机（mulberry32）——同一个 seed 永远得到同一串随机数。
 * 用途：美术外形随机化。把 seed 存进存档，读档后每株植物的
 * 叶形/花瓣/叶片参数完全还原（不是"重新随机一遍"）。
 */
export function seededRandom(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;   // seed=0 时也给个非零初值
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性随机源的范围随机：rng 是 seededRandom 返回的函数 */
export function rngRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
/** 确定性随机源的整数随机（含两端） */
export function rngInt(rng, lo, hi) { return Math.floor(lo + rng() * (hi - lo + 1)); }
/** 确定性随机源的数组挑选 */
export function rngPick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * 生成一组"不规则轮廓"参数：低次谐波振幅递减（大起伏 + 小碎边），
 * 供 blobPath 使用。用 Math.random（或任意 rng 函数）都行。
 * @param {Function} rng 随机函数
 * @param {number} [count] 谐波层数
 * @param {number} [ampLo] 一阶振幅下限（相对半径比例）
 * @param {number} [ampHi] 一阶振幅上限
 * @returns {{amps:number[], phases:number[]}}
 */
export function blobShape(rng, count = 3, ampLo = 0.07, ampHi = 0.16) {
  const amps = [], phases = [];
  for (let h = 0; h < count; h++) {
    amps.push((ampLo + rng() * (ampHi - ampLo)) / (1 + h * 0.55));
    phases.push(rng() * Math.PI * 2);
  }
  return { amps, phases };
}

/**
 * 画一个"不规则圆"闭合路径：半径随角度按谐波起伏，比正圆自然得多。
 * 石头、泥团、气泡、荷叶边缘、花心……凡是"本来画成正圆/椭圆"的
 * 都可以换这个，外观立刻从"几何图形"变成"有机形状"。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} rx 基础横半径
 * @param {number} ry 基础纵半径（=rx 则近似正圆，可压扁）
 * @param {number[]} amps 谐波振幅（第 h 层对应角度频率 h+2）
 * @param {number[]} phases 谐波相位
 * @param {number} [rot] 整体旋转
 * @param {number} [steps] 轮廓采样点数
 */
export function blobPath(ctx, cx, cy, rx, ry, amps, phases, rot = 0, steps = 30) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let k = 1;
    for (let h = 0; h < amps.length; h++) {
      k += amps[h] * Math.sin(t * (h + 2) + phases[h]);
    }
    const px = Math.cos(t) * rx * k;
    const py = Math.sin(t) * ry * k;
    const x = cx + px * cos - py * sin;
    const y = cy + px * sin + py * cos;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 圆角矩形路径 */
export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
