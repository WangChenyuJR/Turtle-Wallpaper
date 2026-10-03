/**
 * 纯 Node 回归：水下拖拽搅动 + 生物游动尾流 + 环境气泡（阶段 8-⑨）
 *
 * 零渲染：import World 跑固定步长，验证三套新粒子系统在逻辑层自洽 ——
 *   A. 分段搅动 addUnderwaterStirLine：沿线撒粒、带拖动方向、都在水里
 *   B. 游动尾流 addSwimTrail：流痕只出现在身后；慢速不出粒
 *   C. 换气气泡 addBreathBubbles：成串、向上
 *   D. 环境气泡：池底冒 → 上浮 → 到水面"啵"（波场/涟漪有响应）
 *   E. 帧驱动拖拽连续性：按帧步长喂 addWake，拖尾痕不断档
 *   F. 粒子帽 + update 耗时（600 帧均值）
 *
 * 跑法： node _diag_waterfx.mjs
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};

const { CONFIG } = await import('./src/config.js');
const { World } = await import('./src/world.js');

const W = 1920, H = 1080;
const w = new World(W, H);
const midWaterY = (x) => (w.surfaceAt(x) + w.groundYAt(x)) / 2;

// 找一段"深处纯水"的横线做试验场（离水线 > 60px，离池底 > 40px）
function findDeepWater() {
  for (let x = Math.round(W * 0.4); x < W * 0.9; x += 10) {
    if (!w.isWaterColumn(x)) continue;
    const s = w.surfaceAt(x), g = w.groundYAt(x);
    if (g - s > 220) return { x, y: (s + g) / 2 };
  }
  return { x: Math.round(W * 0.6), y: midWaterY(Math.round(W * 0.6)) };
}

console.log('\n=== A. 分段搅动：沿线撒粒 + 拖动方向 ===');
{
  const { x, y } = findDeepWater();
  w.stirBits.length = 0;
  const x0 = x - 60, x1 = x + 60;
  w.addUnderwaterStirLine(x0, y, x1, y, 600);

  const bits = w.stirBits.filter(p => p.kind === 'bubble' || p.kind === 'silt');
  ok(bits.length >= 4, `沿线撒出粒子（${bits.length} ≥ 4）`);

  const xs = bits.map(p => p.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  ok(spread >= 60, `粒子沿拖拽轨迹摊开（跨度 ${spread.toFixed(0)}px ≥ 60）`);

  const meanVx = bits.reduce((s, p) => s + p.vx, 0) / bits.length;
  ok(meanVx > 5, `初速带拖动方向（向右拖 → 平均 vx ${meanVx.toFixed(1)} > 5）`);

  ok(bits.every(p => w.isWater(p.x, p.y)), '所有粒子落点都在水里');

  // 固定步长跑 1 秒：不许钻出水线/池底，不许 NaN
  let bad = 0;
  for (let i = 0; i < 60; i++) {
    w._updateStirBits(1 / 60);
    for (const p of w.stirBits) {
      if (!Number.isFinite(p.x + p.y)) { bad++; continue; }
      if (p.y < w.surfaceAt(p.x)) bad++;
      if (p.y > w.groundYAt(p.x)) bad++;
    }
  }
  ok(bad === 0, `步进 1s 全程守在水体里（越界 ${bad}）`);
}

console.log('\n=== B. 游动尾流：只留身后 ===');
{
  const { x, y } = findDeepWater();
  w.stirBits.length = 0;
  const n = 30;
  for (let i = 0; i < n; i++) w.addSwimTrail(x, y, 80, 0, 10, 'fish');
  const flows = w.stirBits.filter(p => p.kind === 'flow');
  ok(flows.length >= n * 0.9, `流痕生成（${flows.length}/${n}）`);
  ok(flows.every(p => p.x <= x + 2), `流痕全在身后（最大 x 偏移 ${Math.max(...flows.map(p => p.x - x)).toFixed(1)}px）`);
  ok(flows.every(p => Number.isFinite(p.len) && p.len >= 4 && p.life <= p.maxLife), '流痕长度/寿命合法');
  // 长度朝行进方向的反向拉（尾巴在 x 更小处）
  ok(flows.every(p => p.x - Math.cos(p.ang) * p.len <= x + 2), '痕体不越过身位');

  // 慢速/岸上不出粒
  w.stirBits.length = 0;
  w.addSwimTrail(x, y, 3, 0, 10, 'fish');
  w.addSwimTrail(4, H * 0.05, 80, 0, 10, 'fish');   // 岸上
  ok(w.stirBits.length === 0, `慢速或岸上不撒粒（${w.stirBits.length} === 0）`);
}

console.log('\n=== C. 换气气泡 ===');
{
  const { x, y } = findDeepWater();
  w.stirBits.length = 0;
  w.addBreathBubbles(x, y, 30, 1);
  const bs = w.stirBits.filter(p => p.kind === 'bubble');
  ok(bs.length >= 2 && bs.length <= 5, `一串 2~5 粒（${bs.length}）`);
  ok(bs.every(p => p.vy < 0), '全部向上浮');
  ok(bs.every(p => p.r >= 1.3), '换气泡比尾流泡大（r ≥ 1.3）');
}

console.log('\n=== D. 环境气泡：池底冒 → 上浮 → 水面"啵" ===');
{
  w.ambBubbles = [];
  w.ripples.length = 0;
  const e0 = w.wave.energy();
  w._ambBubT = 0;                     // 立刻冒泡
  let steps = 0, sawBubble = false, sawPop = false, sawRipple = false;
  let poppedWithRipple = false;
  for (; steps < 2000; steps++) {
    const before = w.ambBubbles.length;
    w.update(1 / 20);
    if (before > 0) sawBubble = true;
    if (before > 0 && w.ambBubbles.length < before) sawPop = true;
    if (w.ripples.length > 0) sawRipple = true;
    // 第一串冒完后关掉计时器（防持续再冒干扰"全部升完"判定）
    if (sawBubble && !poppedWithRipple) w._ambBubT = 1e9;
    if (before > 0 && w.ambBubbles.length < before && w.ripples.length > 0) poppedWithRipple = true;
    if (sawBubble && sawPop && w.ambBubbles.length === 0) break;
  }
  ok(sawBubble, '池底冒出了气泡');
  ok(sawPop, '气泡升到水面破裂');
  ok(w.ambBubbles.length === 0, `全部升完（剩 ${w.ambBubbles.length}）`);
  ok(w.wave.energy() > e0, '破裂给波场留了扰动（能量增加）');
  ok(sawRipple && poppedWithRipple, '破裂推了微涟漪');
}

console.log('\n=== E. 帧驱动拖拽：拖尾痕连续不断档 ===');
{
  w.wave.calm(); w.wakeTrails.length = 0; w.stirBits.length = 0;
  // 找水线下 12px 的一条横线（在水线 ±34 的拖拽带内）
  let sx = 0, sy = 0;
  outer: for (let x = Math.round(W * 0.35); x < W * 0.9; x += 8) {
    if (w.isWaterColumn(x) && w.groundYAt(x) - w.surfaceAt(x) > 60) {
      sx = x; sy = w.surfaceAt(x) + 12; break outer;
    }
  }
  const ex = sx + Math.round(W * 0.3);
  // 模拟 60fps 帧驱动：每帧走 ~8px（≈480px/s 的慢拖）
  let px = sx;
  for (let x = sx + 8; x <= ex; x += 8) {
    w.addWake(px, sy, x, sy, 480);
    px = x;
  }
  const trails = w.wakeTrails
    .map(t => ({ x0: Math.min(t.x0, t.x1), x1: Math.max(t.x0, t.x1) }))
    .sort((a, b) => a.x0 - b.x0);
  ok(trails.length >= 20, `拖尾痕成串（${trails.length} ≥ 20）`);
  let maxGap = 0;
  for (let i = 1; i < trails.length; i++) {
    maxGap = Math.max(maxGap, trails[i].x0 - trails[i - 1].x1);
  }
  ok(maxGap < 12, `相邻痕无缝衔接（最大空档 ${maxGap.toFixed(1)}px < 12）`);
}

console.log('\n=== F. 粒子帽 + update 耗时 ===');
{
  w.stirBits.length = 0; w.wakeTrails.length = 0;
  const { x, y } = findDeepWater();
  for (let i = 0; i < 400; i++) w.addUnderwaterStirLine(x - 40, y, x + 40, y, 900);
  const cap = CONFIG.natural?.stirCap ?? 320;
  ok(w.stirBits.length <= cap, `粒子池封顶（${w.stirBits.length} ≤ ${cap}）`);

  const t0 = performance.now();
  for (let i = 0; i < 600; i++) w.update(1 / 60);
  const avg = (performance.now() - t0) / 600;
  ok(avg < 2, `update 均耗 ${avg.toFixed(3)}ms < 2ms（粒子 ${w.stirBits.length}）`);
}

console.log(`\n────\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
