/**
 * 诊断：生物的"体积碰撞"（阶段 8-⑧：侧视图允许重叠）
 * 运行：node _diag_body.mjs
 *
 * 用户诉求："减小龟龟和鱼的体积碰撞，侧视图他们是可以重叠的"
 * → 侧视剖面没有纵深信息，两只生物屏幕坐标靠近时不该被"实体球"弹开。
 *
 * 现状梳理（本脚本同时也是这个结论的证据）：
 *   · 龟-龟：**位置级硬推开**（每帧直接把 x/y 推开），min = size × bodyGap。
 *            这是画面里肉眼能看出的"体积"，已由 1.1/26 降到 0.42/9。
 *   · 鱼-鱼：只有 Boids 分离**转向力**（软），而且是 `(dx)/d²` 未归一化的写法，
 *            实际力 ≈ 1/d（约 0.05~0.7 px/s²），本来就几乎不把鱼弹开。
 *   · 龟-鱼：互不感知，本来就可以重叠（D 段用源码断言钉住）。
 *
 * 断言：
 *   A. 鱼-鱼是软分离（不瞬移）+ 长跑中确实会重叠 + 不会塌成一坨
 *   B. 龟-龟新参数 2 秒后中心距明显小于旧参数，且仍小于一只龟的身宽
 *   C. 参数防回退
 *   D. fish.js 不感知 turtle / turtle.js 不遍历 fishes（跨类无碰撞）
 */
import { readFileSync } from 'node:fs';
import { World } from './src/world.js';
import { Fish } from './src/fish.js';
import { Turtle } from './src/turtle.js';
import { CONFIG } from './src/config.js';
import { seededRandom } from './src/utils.js';

const DT = 1 / 60;
let pass = 0, fail = 0;
const check = (n, ok, ex = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ex ? '  ' + ex : ''}`); ok ? pass++ : fail++; };

// ── A. 鱼-鱼：软分离、可重叠、不塌成一坨 ───────────────────
console.log('\n=== A. 鱼群：允许重叠（软分离）===');
{
  // A1. 两条鱼重叠出发 → 一帧内不该被"瞬移"分开（软力特征）
  Math.random = seededRandom(20261003);
  const world = new World(1280, 720);
  const f1 = new Fish(world), f2 = new Fish(world);
  for (const f of [f1, f2]) {
    f.x = 640; f.y = 400; f.vx = 10; f.vy = 0;
    f.hunger = 0.1;
  }
  f2.x += 0.5;
  const cur = { active: false, x: 0, y: 0 };
  f1.flock([f1, f2], cur, [], DT, null);
  f2.flock([f1, f2], cur, [], DT, null);
  f1.update(DT); f2.update(DT);
  const jump = Math.hypot(f1.x - 640, f1.y - 400);
  check('重叠的鱼一帧内不会被弹开（软力，位移 < 5px）', jump < 5, `位移 ${jump.toFixed(2)}px`);
  const gap1f = Math.hypot(f1.x - f2.x, f1.y - f2.y);
  check('重叠的鱼一帧后仍几乎重合（< 6px）', gap1f < 6, `${gap1f.toFixed(2)}px`);

  // A2. 8 条鱼长跑：确实会出现"鱼对贴到 12px 内"
  Math.random = seededRandom(20261003);
  const w2 = new World(1280, 720);
  const fishes = [];
  for (let i = 0; i < 8; i++) {
    const f = new Fish(w2);
    f.x = w2.w * (0.30 + (i % 4) * 0.11);
    f.y = w2.waterTop + 70 + Math.floor(i / 4) * 42;
    f.vx = 12; f.vy = 0;
    fishes.push(f);
  }
  let minGap = Infinity, overlapFrames = 0, frames = 0, sumAvg = 0;
  for (let i = 0; i < 60 * 40; i++) {
    for (const f of fishes) f.flock(fishes, cur, [], DT, null);
    for (const f of fishes) f.update(DT);
    let g = Infinity, sum = 0, n = 0;
    for (let a = 0; a < fishes.length; a++) {
      for (let b = a + 1; b < fishes.length; b++) {
        const d = Math.hypot(fishes[a].x - fishes[b].x, fishes[a].y - fishes[b].y);
        if (d < g) g = d;
        sum += d; n++;
      }
    }
    frames++;
    if (g < minGap) minGap = g;
    if (g < 12) overlapFrames++;
    sumAvg += sum / n;
  }
  check('40 秒内出现"两鱼中心距 < 12px"的帧', overlapFrames > 0,
    `重叠帧 ${overlapFrames}/${frames}`);
  check('最小中心距 < 12px（真的能叠上）', minGap < 12, `${minGap.toFixed(1)}px`);
  check('鱼群没有塌成一坨（平均间距仍散开）', sumAvg / frames > 15,
    `平均间距 ${(sumAvg / frames).toFixed(1)}px`);
}

// ── B. 龟-龟：叠在一起不被弹开 ────────────────────────────
// ⚠️ 阶段 8-⑫ 沉底地形下水量翻倍，2 秒长跑里"漫游游开"完全主导中心距，
//    碰撞参数失去区分度（实测新 134.9 / 旧 137.1px）。改测**单帧推力**：
//    一帧内游泳位移 ≤ ~0.7px 不干扰，中心距变化就是 bodyGap/bodyPush 的直接量。
console.log('\n=== B. 乌龟：叠一起不被弹开（旧 1.1/26 → 新 0.42/9，单帧推力）===');
function turtleGapSim(gapK, gapPush, frames = 1) {
  const old = [CONFIG.turtle.bodyGap, CONFIG.turtle.bodyPush];
  CONFIG.turtle.bodyGap = gapK;
  CONFIG.turtle.bodyPush = gapPush;
  Math.random = seededRandom(20261003);

  const world = new World(1280, 720);
  const ts = [new Turtle(world, 0), new Turtle(world, 1)];
  for (const t of ts) {
    t.x = world.w * 0.5;
    t.depth = 0.5; t.depthGoal = 0.5;
    t._syncYFromDepth();
    t.state = 'swim';
    t.stateTime = 0;
    t.decisionTimer = 9999;      // 只跑漫游，不做决策
    t.hunger = 0.1;
    t.reproCooldown = 9999;
  }
  ts[1].x += 0.6;                // 完全重合时法线退化，错开一点点

  const env = { light: 1, isNight: false };
  const cur = { active: false, x: 0, y: 0 };
  for (let i = 0; i < frames; i++) {
    for (const t of ts) t.update(DT, [], cur, ts, env);
  }
  const gap = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);

  CONFIG.turtle.bodyGap = old[0];
  CONFIG.turtle.bodyPush = old[1];
  return gap;
}
{
  const o = turtleGapSim(1.1, 26, 1);
  const n = turtleGapSim(0.42, 9, 1);
  const T = CONFIG.turtle;
  const minSphere = T.size * (T.bodyGap ?? 0.42);        // 新参数的"实体球"半径
  check('旧参数一帧就把叠着的龟弹开（> 18px，实体球特征）', o > 18, `一帧后中心距 ${o.toFixed(1)}px`);
  check('新参数一帧推力温和（< 20px）', n < 20, `${n.toFixed(1)}px`);
  check('新参数一帧分离明显小于旧参数（< 60%）', n < o * 0.6, `新 ${n.toFixed(1)}px / 旧 ${o.toFixed(1)}px`);
  check('新参数分离没超出自己的实体球半径 ×2', n < minSphere * 2,
    `${n.toFixed(1)}px < ${(minSphere * 2).toFixed(1)}px`);
}

// ── C. 参数防回退 ─────────────────────────────────────────
console.log('\n=== C. 参数防回退 ===');
{
  const F = CONFIG.fish, T = CONFIG.turtle;
  check('CONFIG.fish.separation ≤ 12', F.separation <= 12, `${F.separation}`);
  check('CONFIG.fish.separationForce ≤ 1.2', (F.separationForce ?? 1.6) <= 1.2, `${F.separationForce}`);
  check('CONFIG.turtle.bodyGap ≤ 0.5', (T.bodyGap ?? 1.1) <= 0.5, `${T.bodyGap}`);
  check('CONFIG.turtle.bodyPush ≤ 12', (T.bodyPush ?? 26) <= 12, `${T.bodyPush}`);
}

// ── D. 跨类无碰撞（源码断言）─────────────────────────────
console.log('\n=== D. 龟与鱼互不感知（跨类本来就能重叠）===');
{
  const fishSrc = readFileSync(new URL('./src/fish.js', import.meta.url), 'utf8');
  const turtleSrc = readFileSync(new URL('./src/turtle.js', import.meta.url), 'utf8');
  check('fish.js 里没有任何 turtle 字样', !/turtle/i.test(fishSrc));
  check('turtle.js 没有遍历 fishes', !/\bfishes\b/.test(turtleSrc));
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
