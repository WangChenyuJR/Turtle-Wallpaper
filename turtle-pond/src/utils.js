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
