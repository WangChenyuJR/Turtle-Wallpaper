/**
 * 手感调参对照 —— 用真实波动方程跑出"波扩散半径"和"能量衰减"，
 * 对比 5-⑪ 旧参数与新参数，验证：① 更安静 ② 范围更小。
 * 运行：node _tune_check.mjs
 */
import { WaterWaveField } from './src/waterwave.js';

/** 落一次扰动后推进 N 帧，返回波能随时间序列 + 波峰扩散到几格 */
function probe(wave, { frames = 300, strength = 1, radius = 2 } = {}) {
  wave.calm();
  const cx = wave.w / 2, cy = wave.h / 2;
  wave.disturb(cx, cy, strength, radius);
  const gcx = Math.round(cx / wave.cell) + 1;
  const gcy = Math.round(cy / wave.cell) + 1;

  const series = [];
  let maxRadius = 0;
  for (let i = 0; i < frames; i++) {
    wave.update(1 / 60, { ambient: false });
    series.push(wave.energy());
    // 找最远的"可感知"格子（|h| > 阈值）
    if (i % 30 === 0) {
      const thr = 0.02;
      for (let gy = 1; gy < wave.rows - 1; gy++) {
        for (let gx = 1; gx < wave.cols - 1; gx++) {
          if (Math.abs(wave.cur[gy * wave.cols + gx]) > thr) {
            const d = Math.hypot(gx - gcx, gy - gcy);
            if (d > maxRadius) maxRadius = d;
          }
        }
      }
    }
  }
  const peak = Math.max(...series);
  const e60 = series[59] ?? 0;
  const e120 = series[119] ?? 0;
  const e180 = series[179] ?? 0;
  return { peak, e60, e120, e180, maxRadiusCells: maxRadius,
           maxRadiusPx: maxRadius * wave.cell };
}

const W = 1200, H = 700;
const OLD = { damping: 0.985, ambientGap: 0.35, ambientStr: 0.09 };
const NEW = { damping: 0.978, ambientGap: 1.6, ambientStr: 0.05 };

const w1 = new WaterWaveField(W, H, 7, OLD);
const w2 = new WaterWaveField(W, H, 7, NEW);

// 鼠标扰动：旧 = 0.35~1.5, r2 ；新 = 0.55*(0.4~1.6)→0.22~0.88, r1
function cursorStrength(k, speed) { return Math.min(Math.max(k * (0.4 + speed / 1400), k * 0.4), k * 1.6); }
const oldCursor = Math.min(Math.max(0.35 + 1600 / 1400, 0.35), 1.5);
const newCursor = cursorStrength(0.62, 1600);

console.log('=== 鼠标快速划水（1600 px/s）单点扰动 ===');
const r1 = probe(w1, { strength: oldCursor, radius: 2 });
const r2 = probe(w2, { strength: newCursor, radius: 2 });
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('', 14) + pad('旧(5-⑪)', 14) + pad('新(本次)', 14) + '变化');
console.log(pad('扰动强度', 14) + pad(oldCursor.toFixed(3), 14) + pad(newCursor.toFixed(3), 14) +
  (100 * (newCursor / oldCursor - 1)).toFixed(0) + '%');
console.log(pad('峰值能量', 14) + pad(r1.peak.toFixed(1), 14) + pad(r2.peak.toFixed(1), 14) +
  (100 * (r2.peak / r1.peak - 1)).toFixed(0) + '%');
console.log(pad('1s后能量', 14) + pad(r1.e60.toFixed(2), 14) + pad(r2.e60.toFixed(2), 14) +
  (100 * (r2.e60 / Math.max(r1.e60, 1e-6) - 1)).toFixed(0) + '%');
console.log(pad('2s后能量', 14) + pad(r1.e120.toFixed(2), 14) + pad(r2.e120.toFixed(2), 14) +
  (100 * (r2.e120 / Math.max(r1.e120, 1e-6) - 1)).toFixed(0) + '%');
console.log(pad('3s后能量', 14) + pad(r1.e180.toFixed(2), 14) + pad(r2.e180.toFixed(2), 14) +
  (100 * (r2.e180 / Math.max(r1.e180, 1e-6) - 1)).toFixed(0) + '%');
console.log(pad('波最远扩散', 14) + pad(r1.maxRadiusPx.toFixed(0) + 'px', 14) +
  pad(r2.maxRadiusPx.toFixed(0) + 'px', 14) +
  (100 * (r2.maxRadiusPx / r1.maxRadiusPx - 1)).toFixed(0) + '%');

console.log('\n=== 背景安静度（每分钟扰动次数 / 强度）===');
console.log(pad('环境微扰', 14) + pad(`${(60 / 0.35).toFixed(0)}次/min`, 14) +
  pad(`${(60 / 1.8).toFixed(0)}次/min`, 14) +
  (100 * ((60 / 1.8) / (60 / 0.35) - 1)).toFixed(0) + '%');
console.log(pad('微扰强度', 14) + pad('0.09~0.19', 14) + pad('0.035~0.08', 14) + '-58%');
console.log(pad('鱼群起波', 14) + pad('200次/min', 14) + pad('100次/min', 14) + '-50%');
console.log(pad('鼠标补点', 14) + pad('每6px', 14) + pad('每9px', 14) + '-33%');

console.log('\n=== 结论 ===');
const ok1 = r2.maxRadiusPx < r1.maxRadiusPx;
const ok2 = r2.peak < r1.peak;
const ok3 = r2.e120 < r1.e120;
console.log(`波扩散范围收窄: ${ok1 ? 'PASS' : 'FAIL'}   峰值减弱: ${ok2 ? 'PASS' : 'FAIL'}   余波更快平息: ${ok3 ? 'PASS' : 'FAIL'}`);
