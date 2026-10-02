/**
 * 起波强度分布验证 —— 模拟鱼/龟群的扰动强度与半径，
 * 验证：① 强弱真的按体型拉开 ② 同体型个体不完全相同 ③ 幼体→成年自然增长
 * 运行：node _tune_size.mjs
 */
import { CONFIG } from './src/config.js';

const nat = CONFIG.natural;
const exp = nat.waveSizeExp, jitter = nat.waveSizeJitter;
const fishRef = (CONFIG.fish.minSize + CONFIG.fish.maxSize) / 2;
const turtleRef = CONFIG.turtle.size;

function fishWake(size, idio) {
  const ratio = Math.max(0.25, size / fishRef);
  return {
    s: nat.waveFishStr * 0.13 * Math.pow(ratio, exp) * idio,
    rad: 1 + Math.round(Math.min(1, ratio * 0.7) * 1.6),
  };
}
function turtleWake(size, idio) {
  const ratio = Math.max(0.25, size / turtleRef);
  return {
    s: nat.waveTurtleStr * 2.2 * Math.pow(ratio, exp * 0.8) * idio,
    rad: 2 + Math.round(Math.min(1.4, ratio) * 1.5),
  };
}

const idio = 1.0;   // 先看纯体型效应
console.log('=== 鱼的起波强度 vs 体型（个性因子=1，看纯体型效应）===');
console.log('体型       强度      半径   说明');
for (const [sz, note] of [[2.5, '最小幼鱼(6×0.42)'], [6, '小鱼出生'], [9.5, '中位成年'],
                          [13, '最大成年'], [15, '大型品种(13×1.15)']]) {
  const w = fishWake(sz, idio);
  console.log(`${String(sz).padEnd(10)}${w.s.toFixed(4).padEnd(10)}${String(w.rad).padEnd(7)}${note}`);
}
const fSmall = fishWake(6, 1).s, fBig = fishWake(15, 1).s;
console.log(`→ 最大/最小 强度比 = ${(fBig / fSmall).toFixed(1)}×（旧算法近线性只有 1.5×）`);

console.log('\n=== 龟的起波强度 vs 体型 ===');
console.log('体型       强度      半径   说明');
for (const [sz, note] of [[14, '幼龟(34×0.42)'], [20, '小品种(34×0.6)'],
                          [34, '标准成年'], [49, '大品种(34×1.25×1.15)']]) {
  const w = turtleWake(sz, idio);
  console.log(`${String(sz).padEnd(10)}${w.s.toFixed(4).padEnd(10)}${String(w.rad).padEnd(7)}${note}`);
}
const tSmall = turtleWake(14, 1).s, tBig = turtleWake(49, 1).s;
console.log(`→ 最大/最小 强度比 = ${(tBig / tSmall).toFixed(1)}×`);

console.log('\n=== 同体型个体差异（100 只，体型都=9.5 的鱼）===');
const vals = Array.from({ length: 100 }, () => fishWake(9.5, 1 + (Math.random() * 2 - 1) * jitter).s);
vals.sort((a, b) => a - b);
console.log(`强度范围 ${vals[0].toFixed(4)} ~ ${vals[99].toFixed(4)}，离散度 ${((vals[99] / vals[0] - 1) * 100).toFixed(0)}%`);
console.log(`中位 ${vals[50].toFixed(4)}`);

console.log('\n=== 成长过程中的波（同一条鱼 size 6→13）===');
for (const ratio of [0.42, 0.6, 0.8, 1.0]) {
  const sz = 9.5 * ratio;
  const w = fishWake(sz, 1);
  console.log(`成长 ${(ratio * 100).toFixed(0)}%（体型 ${sz.toFixed(1)}）→ 强度 ${w.s.toFixed(4)}，半径 ${w.rad}`);
}

console.log('\n=== 结论 ===');
console.log(`体型差异已拉开: ${(fBig / fSmall) > 3 ? 'PASS' : 'FAIL'}（鱼 ${(fBig / fSmall).toFixed(1)}×）`);
console.log(`同体型有差异:   ${(vals[99] / vals[0] - 1) > 0.3 ? 'PASS' : 'FAIL'}（±${((vals[99] / vals[0] - 1) * 100 / 2).toFixed(0)}%）`);
console.log(`幼体波更小:     ${fishWake(2.5, 1).s < fishWake(13, 1).s / 3 ? 'PASS' : 'FAIL'}`);
