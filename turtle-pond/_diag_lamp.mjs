/**
 * 纯 Node 回归：昼夜"跟随系统时间" + 岸边小灯（阶段 6-⑥ / 6-⑦）
 *
 * 不开浏览器、不渲染。用假 canvas 2d 上下文 + mock 的 Date，
 * 验证：
 *   A. 系统时钟 → dayT / 时段 / 光强 / 钟点文本 的换算对不对
 *   B. 光强曲线连续（不跳变）—— 换时间源时画面不会"闪"
 *   C. 时间源切换 / setDayT 临时脱档 / 5 分钟后自动回真实时间
 *   D. 小灯的开关、点击命中判定、渐亮渐灭、昼夜衰减
 *   E. 灯真的画了东西；且**柔光是纯高斯**：
 *      每个径向渐变的 alpha 单调递减、边缘精确归零、色标 ≥20 档
 *      （这正是"高斯模糊"观感的三个必要条件，硬边/色环会被这里抓住）
 *   F. PondApp.ambientLight 合成（灯亮把夜晚下限抬到 0.45）
 *   G. 多盏灯：对称排布 / 高矮差异 / 亮度归一化 / 单盏开关 / 点哪盏亮哪盏
 *
 * 跑法： node _diag_lamp.mjs
 */
import { CONFIG } from './src/config.js';
import { World } from './src/world.js';
import { DayNight, PHASES } from './src/daynight.js';
import { PondLamp } from './src/lamp.js';

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// ── mock 系统时钟（本地时间）────────────────────────────
const RealDate = globalThis.Date;
function setClock(h, m = 0, s = 0) {
  const ms = new RealDate(2026, 9, 2, h, m, s, 0).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  };
  return ms;
}
const restoreClock = () => { globalThis.Date = RealDate; };

// ── 假 canvas 2d 上下文：no-op + 计数 + 记录 fillRect 填充色 + 记录渐变色标 ──
// 记录渐变色标是这一轮的关键：只有拿到每个色标的 alpha，才能断言
// "柔光是单调衰减的高斯、边缘归零"（即真的像被模糊过，而不是硬边同心圆）。
function makeCtx() {
  const calls = { fill: 0, stroke: 0, fillRect: 0, grad: 0, ellipse: 0, arc: 0 };
  const rects = [];
  const grads = [];
  const arcs = [];
  const store = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const stack = [];
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return (...args) => {
        // save/restore 要真的存取状态，否则 lighter 会"泄漏"到后续所有 fillRect
        if (p === 'save') { stack.push({ ...t }); return undefined; }
        if (p === 'restore') { const s = stack.pop(); if (s) Object.assign(t, s); return undefined; }
        if (p in calls) calls[p]++;
        if (p === 'fillRect') rects.push({ fill: t.fillStyle, op: t.globalCompositeOperation, alpha: t.globalAlpha, x: args[0], y: args[1], w: args[2], h: args[3] });
        if (p === 'arc') arcs.push({ x: args[0], y: args[1], r: args[2] });   // 光晕半径就是"光照范围"
        if (String(p).startsWith('create')) {
          calls.grad++;
          const g = {
            kind: p === 'createRadialGradient' ? 'radial' : 'linear',
            stops: [],
            addColorStop(o, c) { this.stops.push({ o, c }); },
          };
          grads.push(g);
          return g;
        }
        if (p === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return { ctx, calls, rects, grads, arcs };
}

/** 从 'rgba(r,g,b,a)' 里取 a */
const alphaOfColor = (c) => {
  const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(String(c));
  return m ? parseFloat(m[1]) : 1;
};

/** 某次绘制里所有径向渐变色标的 alpha 之和（亮度代理量） */
const radialAlphaSum = (c) => c.grads
  .filter((g) => g.kind === 'radial')
  .reduce((s, g) => s + g.stops.reduce((t, x) => t + alphaOfColor(x.c), 0), 0);

const world = new World(1280, 720);
const DAY = 86400;

console.log('\n=== A. 系统时钟 → dayT / 时段 / 光强 / 钟点 ===');
{
  const cases = [
    // [时, 分, 期望 dayT, 期望时段 id, 期望光强, 期望钟点]
    [0,  0,  0.0000, 'night', 0.28, '00:00'],
    [2,  0,  0.0833, 'night', 0.28, '02:00'],
    [5, 40,  0.2361, 'dawn',  0.64, '05:40'],
    [6, 40,  0.2778, 'day',   1.00, '06:40'],
    [12, 0,  0.5000, 'day',   1.00, '12:00'],
    [17, 40, 0.7361, 'dusk',  1.00, '17:40'],
    [18, 40, 0.7778, 'dusk',  0.64, '18:40'],
    [20, 0,  0.8333, 'night', 0.28, '20:00'],
    [23, 45, 0.9896, 'night', 0.28, '23:45'],
  ];
  for (const [h, m, wantT, wantPhase, wantLight, wantClock] of cases) {
    setClock(h, m);
    const dn = new DayNight();
    const t = +dn.dayT.toFixed(4);
    const good = Math.abs(t - wantT) < 0.0016
      && dn.phase.id === wantPhase
      && Math.abs(dn.light - wantLight) <= 0.02
      && dn.clockText === wantClock;
    ok(good, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} → dayT ${t} ${dn.phase.label} light ${dn.light.toFixed(2)} ${dn.clockText}`,
      good ? '' : `期望 dayT ${wantT} / ${wantPhase} / ${wantLight} / ${wantClock}`);
  }
  restoreClock();
}

console.log('\n=== B. 光强曲线连续 + 昼夜边界（不跳变、不闪） ===');
{
  setClock(12, 0);
  const dn = new DayNight();
  let maxJump = 0, at = 0;
  dn.setDayT(0);
  let prev = dn.light;
  for (let i = 1; i <= 2000; i++) {
    const t = i / 2000;
    dn.setDayT(t);
    const v = dn.light;
    const j = Math.abs(v - prev);
    if (j > maxJump) { maxJump = j; at = t; }
    prev = v;
  }
  ok(maxJump < 0.02, `2000 步扫描最大跳变 ${maxJump.toFixed(4)}（@dayT ${at.toFixed(3)}）`);
  // 关键边界
  dn.setDayT(0.5);  ok(near(dn.light, 1, 0.001), '正午 12:00 满亮度');
  dn.setDayT(0.0);  ok(near(dn.light, 0.28, 0.001), '零点最暗 0.28');
  dn.setDayT(0.9);  ok(dn.isNight, '21:36 算夜晚（龟不晒背）');
  dn.setDayT(0.1);  ok(dn.isNight, '02:24 算夜晚');
  dn.setDayT(0.5);  ok(!dn.isNight, '正午不算夜晚');
  dn.setDayT(0.85); ok(dn.isNight, '20:24 算夜晚');
  // 时段全覆盖（0~1 任意点都能判出时段，不会掉进 undefined）
  let bad = 0;
  for (let i = 0; i < 240; i++) { dn.setDayT(i / 240); if (!dn.phase?.id) bad++; }
  ok(bad === 0, '全天 240 个采样点都有明确时段');
  ok(PHASES.length === 4, `时段表 4 段：${PHASES.map((p) => p.label).join('/')}`);
  restoreClock();
}

console.log('\n=== C. 时间源切换 / 手动定时 / 自动回到系统时间 ===');
{
  setClock(10, 0);
  const dn = new DayNight();
  ok(dn.source === 'system', '默认 source = system（跟随电脑时钟）');
  const t0 = dn.dayT;
  ok(near(t0, 10 / 24, 0.001), `10:00 → dayT ${t0.toFixed(3)}`);

  // 切到加速循环：以当前时刻为起点，不跳变
  dn.setSource('cycle');
  ok(dn.source === 'cycle', 'setSource("cycle") 生效');
  ok(near(dn.dayT, t0, 0.002), '切模式画面不跳（dayT 保持）', `dayT ${dn.dayT.toFixed(3)}`);
  for (let i = 0; i < 60; i++) dn.update(1);
  ok(near(dn.dayT, (t0 + 60 / dn.dayLength) % 1, 0.002), `加速模式推进 60s → dayT ${dn.dayT.toFixed(3)}`);

  // 切回系统：立刻回到电脑时间
  dn.setSource('system');
  ok(near(dn.dayT, t0, 0.001), '切回 system 后立刻回到电脑时间');

  // setDayT 临时脱档
  dn.setDayT(0.75);
  ok(near(dn.dayT, 0.75, 0.001), 'setDayT(0.75) 立即生效（看黄昏）');
  for (let i = 0; i < 120; i++) dn.update(1);       // 走 120 秒（未到期）
  ok(near(dn.dayT, 0.75, 0.001), '120 秒内维持手动时刻（不被电脑时间抢回）');
  for (let i = 0; i < 200; i++) dn.update(1);       // 累计 320 秒 > MANUAL_HOLD(300)
  ok(near(dn.dayT, t0, 0.001), '超时后自动回到电脑真实时间', `dayT ${dn.dayT.toFixed(3)}`);

  // timeOffsetHours 相位偏移
  const oldOff = CONFIG.daynight.timeOffsetHours;
  CONFIG.daynight.timeOffsetHours = 2;
  const dn2 = new DayNight();
  ok(near(dn2.dayT, (10 / 24 + 2 / 24), 0.0015), 'timeOffsetHours=+2 → 昼夜整体推迟 2 小时',
    `dayT ${dn2.dayT.toFixed(4)}`);
  CONFIG.daynight.timeOffsetHours = oldOff;
  restoreClock();
}

console.log('\n=== D. 小灯：开关 / 命中 / 渐亮渐灭 / 昼夜衰减 ===');
{
  const lamp = new PondLamp(world);
  const g0 = lamp.geom();
  console.log(`  ${lamp.count} 盏灯：` + lamp.list().map((l) => `x${l.x}(h${l.h})`).join(' / '));
  console.log(`  第 1 盏 baseY=${g0.base.toFixed(0)} 灯罩 y ${g0.shadeTopY.toFixed(0)}~${g0.shadeBotY.toFixed(0)}`);

  ok(lamp.on === false, '默认不亮（手动灯，等用户开）');
  ok(lamp.hitTest(g0.x, g0.bulbY), '点灯罩中心 → 命中');
  ok(lamp.hitTest(g0.x + g0.poleW, g0.base - g0.h * 0.3), '点灯柱 → 命中');
  ok(!lamp.hitTest(g0.x + g0.h * 2, g0.bulbY), '点右边远处 → 不命中（会正常投喂）');
  ok(!lamp.hitTest(g0.x, g0.base + g0.h), '点灯下方地面 → 不命中');

  const before = lamp.toggle();
  ok(before === true, 'toggle() 开灯');
  ok(lamp.toggle() === false, '再 toggle() 关灯');
  lamp.set(true);
  ok(lamp.isOn === true, 'set(true) 开灯');

  // 渐亮：不能一帧到顶，也不能一直不亮
  const lamp2 = new PondLamp(world);
  lamp2.set(true);
  lamp2.update(1 / 60);
  ok(lamp2.glow > 0.02 && lamp2.glow < 0.9, `首帧 glow=${lamp2.glow.toFixed(3)}（有过渡，不硬切）`);
  for (let i = 0; i < 90; i++) lamp2.update(1 / 60);
  ok(lamp2.glow > 0.95, `1.5 秒后 glow=${lamp2.glow.toFixed(3)}（亮到位）`);
  lamp2.set(false);
  for (let i = 0; i < 90; i++) lamp2.update(1 / 60);
  ok(lamp2.glow < 0.05, `关灯 1.5 秒后 glow=${lamp2.glow.toFixed(3)}（灭干净）`);

  // 昼夜衰减：夜里满强度，白天只剩 dayGlow 那一点
  lamp2.set(true);
  for (let i = 0; i < 120; i++) lamp2.update(1 / 60);
  const dg = CONFIG.lamp.dayGlow;
  const atNight = lamp2.intensityAt(0.28), atNoon = lamp2.intensityAt(1);
  const wantNight = (dg + (1 - dg) * (1 - 0.28)) * (CONFIG.lamp.brightness ?? 1);
  ok(near(atNight, wantNight, 0.03), `夜里强度 ${atNight.toFixed(2)}（期望 ${wantNight.toFixed(2)}）`);
  ok(near(atNoon, dg, 0.02), `白天保留 ${atNoon.toFixed(2)}（=dayGlow，白天开灯也看得见）`);
  ok(atNight > atNoon, '夜里比白天亮（物理上对）');
}

console.log('\n=== E. 小灯渲染：高斯柔光 / 关灯不画 / 白天更弱 ===');
{
  const lamp = new PondLamp(world);
  const c1 = makeCtx();
  lamp.set(false);
  lamp.glow = 0;
  lamp.drawBody(c1.ctx, 1);
  ok(c1.calls.fill > 10 && c1.calls.grad >= 3, `${lamp.count} 盏灯体都画出来了：fill=${c1.calls.fill} 渐变=${c1.calls.grad}`);
  ok(c1.calls.stroke >= 3, '灯罩有金属描边');
  ok(c1.calls.ellipse >= 4, '底座/投影用了椭圆');

  const c2 = makeCtx();
  lamp.drawGlow(c2.ctx, 1, 12.3);
  ok(c2.calls.fillRect === 0 && c2.calls.grad === 0, '关灯时 drawGlow 什么都不画（零开销）');

  // 开灯（夜间）
  lamp.set(true);
  for (let i = 0; i < 120; i++) lamp.update(1 / 60);
  const night = makeCtx();
  lamp.drawGlow(night.ctx, 0.28, 12.3);
  ok(night.calls.grad >= lamp.count * 4, `每盏 4 层柔光 → 共 ${night.calls.grad} 个渐变`);
  ok(night.calls.fillRect >= lamp.count * 10, `水面倒影用多条横条画出（${night.calls.fillRect} 条）`);
  const lit = night.rects.filter((r) => r.op === 'lighter');
  ok(lit.length === night.calls.fillRect && lit.length > 0, '倒影全部走 lighter 叠加（是加光，不是涂色）');

  // ★ 高斯校验：单调递减 + 边缘精确归零 + 色标够密 ← "模糊感"的三个必要条件
  const radials = night.grads.filter((g) => g.kind === 'radial');
  ok(radials.length === night.calls.grad - lamp.count,
    `${radials.length} 个径向渐变（另 ${lamp.count} 个是倒影的横向软边线性渐变）`);
  let mono = true, edgeZero = true, minStops = 1e9;
  for (const g of radials) {
    const as = g.stops.map((s) => alphaOfColor(s.c));
    minStops = Math.min(minStops, as.length);
    for (let i = 1; i < as.length; i++) if (as[i] > as[i - 1] + 1e-9) mono = false;
    if (as[as.length - 1] > 1e-9) edgeZero = false;
  }
  ok(mono, '所有柔光渐变的 alpha 单调递减（纯高斯，没有回弹色环）');
  ok(edgeZero, '边缘 alpha 精确为 0（最外圈不会留一圈硬边）');
  ok(minStops >= 20, `色标至少 ${minStops} 档（够密才看不出色带）`);
  const a0 = radials[0].stops.map((s) => alphaOfColor(s.c));
  const midRatio = a0[Math.floor(a0.length / 2)] / a0[0];
  ok(midRatio > 0.10 && midRatio < 0.55,
    `半径一半处仍有中心亮度的 ${(midRatio * 100).toFixed(0)}%（光斑是"糊开"的，不是点状）`);

  // ★ 光照范围：最外层柔光半径 + 多盏铺开后的总覆盖宽度
  const maxR = Math.max(...night.arcs.map((a) => a.r));
  const h0 = lamp.first.h;
  ok(maxR >= h0 * 6, `单盏柔光半径 ${maxR.toFixed(0)}px = 灯高的 ${(maxR / h0).toFixed(1)} 倍`);
  ok(maxR > Math.min(world.w * 0.46, Math.max(150, h0 * 4.6)),
    `比早期的光晕半径（${Math.min(world.w * 0.46, Math.max(150, h0 * 4.6)).toFixed(0)}px）明显更大`);
  const reach = lamp.list().map((l) => l.x);
  const span = (Math.max(...reach) + maxR) - (Math.min(...reach) - maxR);
  ok(span > world.w * 1.3,
    `${lamp.count} 盏横向铺开覆盖 ${span.toFixed(0)}px（画面宽 ${world.w}px 的 ${(span / world.w).toFixed(1)} 倍，整条岸线都罩住）`);

  // 白天开灯也画，但更弱
  const day = makeCtx();
  lamp.drawGlow(day.ctx, 1, 12.3);
  ok(day.calls.grad === night.calls.grad, '白天结构一致（照画不误）');
  const sn = radialAlphaSum(night), sd = radialAlphaSum(day);
  const dg = CONFIG.lamp.dayGlow;
  const want = (dg + (1 - dg) * 0) / (dg + (1 - dg) * (1 - 0.28));   // atten(1)/atten(0.28)
  ok(sd < sn, `白天光晕比夜里弱（${sd.toFixed(2)} < ${sn.toFixed(2)}）`);
  ok(near(sd / sn, want, 0.02), `白天/夜里 亮度比 ${(sd / sn).toFixed(3)}（期望 ${want.toFixed(3)}）`);

  // 灯体绘制不应抛异常（含 resize 后 h 变小的情况）
  const small = new World(480, 320);
  const lamp3 = new PondLamp(small);
  let err = null;
  try { lamp3.drawBody(c1.ctx, 1); lamp3.drawGlow(c1.ctx, 1, 3); } catch (e) { err = e; }
  ok(!err, '小窗口（480x320）下绘制不抛异常', err ? String(err.message) : `h=${lamp3.h.toFixed(1)}`);
}

console.log('\n=== F. PondApp.ambientLight：灯亮把夜晚下限抬到 0.45 ===');
{
  globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
  const { PondApp } = await import('./src/main.js');
  const app = Object.create(PondApp.prototype);      // 跳过构造函数（不需要 DOM）
  app.daynight = new DayNight();
  app.lamp = new PondLamp(world);

  // 深夜：灯灭 = 0.28，灯亮 = lift(0.45)
  app.daynight.setDayT(0.95);
  app.lamp.set(false); app.lamp.glow = 0;
  const darkOff = app.ambientLight;
  app.lamp.set(true); app.lamp.glow = 1;
  const darkOn = app.ambientLight;
  ok(near(darkOff, 0.28, 0.01), `深夜关灯 ambient=${darkOff.toFixed(2)}`);
  ok(near(darkOn, CONFIG.lamp.lift, 0.01), `深夜开灯 ambient=${darkOn.toFixed(2)}（=lift，夜色罩随之变淡）`);

  // 白天：灯不改变亮度（不能把大白天再提亮）
  app.daynight.setDayT(0.5);
  ok(near(app.ambientLight, 1, 0.01), `正午开灯 ambient=${app.ambientLight.toFixed(2)}（不上溢）`);

  // 关灯渐变：glow 0.5 时取中间值
  app.daynight.setDayT(0.95);
  app.lamp.glow = 0.5;
  const mid = app.ambientLight;
  ok(mid > 0.28 && mid < CONFIG.lamp.lift, `渐亮途中 ambient=${mid.toFixed(2)}（平滑过渡）`);

  // 昼夜色罩随补光变淡（同一时刻，罩子 alpha 更低）
  const dn = app.daynight;
  const cA = makeCtx(), cB = makeCtx();
  dn.drawOverlay(cA.ctx, world, 0.28);
  dn.drawOverlay(cB.ctx, world, 0.45);
  const aOf = (rr) => parseFloat(String(rr[0]?.fill ?? 'rgba(0,0,0,0)').split(',')[3] ?? 0);
  ok(aOf(cB.rects) < aOf(cA.rects), `开灯后夜色罩 alpha ${aOf(cB.rects).toFixed(3)} < 关灯 ${aOf(cA.rects).toFixed(3)}`);

  // 正午不画罩
  dn.setDayT(0.5);
  const cC = makeCtx();
  dn.drawOverlay(cC.ctx, world, 1);
  ok(cC.calls.fillRect === 0, '正午不铺色罩（省性能）');
}

console.log('\n=== G. 多盏灯：排布 / 归一化 / 单盏开关 / 点哪盏亮哪盏 ===');
{
  const cfg = CONFIG.lamp;
  const keep = { count: cfg.count, xRatio: cfg.xRatio, spread: cfg.spread, positions: cfg.positions };

  cfg.count = 3; cfg.xRatio = 0.5; cfg.spread = 0.33; cfg.positions = null;
  const lamp = new PondLamp(world);
  ok(lamp.count === 3, 'count=3 → 布 3 盏');
  const xs = lamp.fixtures.map((f) => +f.xRatio.toFixed(3));
  ok(near(xs[0], 0.17, 0.01) && near(xs[1], 0.50, 0.01) && near(xs[2], 0.83, 0.01),
    `围绕中心对称铺开：${xs.join(' / ')}`);
  const hs = lamp.fixtures.map((f) => Math.round(f.h));
  ok(new Set(hs).size > 1, `高矮各不相同（不是复制粘贴）：${hs.join('/')}px`);
  ok(near(lamp.norm, 1 / (1 + 0.32 * 2), 1e-6), `3 盏的亮度归一化系数 ${lamp.norm.toFixed(3)}`);

  // positions 长度和 count 对不上 → 忽略，回落到对称排布（不能悄悄少画几盏）
  cfg.positions = [0.1, 0.9];
  const pFallback = new PondLamp(world);
  ok(pFallback.count === 3 && near(pFallback.fixtures[0].xRatio, 0.17, 0.01),
    `positions 长度≠count → 忽略（仍是 3 盏对称：${pFallback.fixtures.map((f) => f.xRatio.toFixed(2)).join('/')}）`);
  // positions 长度对得上 → 按指定摆位
  cfg.positions = [0.2, 0.5, 0.8];
  const pExact = new PondLamp(world);
  ok(pExact.fixtures.map((f) => +f.xRatio.toFixed(2)).join(',') === '0.2,0.5,0.8',
    'positions 长度=count → 按指定摆位');
  cfg.positions = null;

  // 单盏开关
  const g = new PondLamp(world);
  g.set(false);
  ok(g.litCount === 0 && g.isOn === false, '全部熄灭');
  g.toggleAt(1);
  ok(g.litCount === 1 && g.fixtures[1].on && !g.fixtures[0].on, '只开中间那盏（点哪盏亮哪盏）');
  ok(g.isOn === true, '有任意一盏亮 → 整组算"开着"');
  ok(g.states().join(',') === 'false,true,false', `states() 供存档：${g.states().join(',')}`);
  g.toggle();
  ok(g.litCount === 0, '有亮的再 toggle → 一起灭');
  g.toggle();
  ok(g.litCount === 3, '全灭时 toggle → 一起亮');
  for (let i = 0; i < 3; i++) {
    const gi = g.fixtures[i].geom();
    ok(g.hitIndex(gi.x, gi.bulbY) === i, `点第 ${i + 1} 盏的灯罩 → 命中第 ${i + 1} 盏`);
  }
  ok(g.hitIndex(-50, 10) === -1 && !g.hitTest(-50, 10), '点画面外 → 不命中（这次点击会正常投喂）');
  ok(g.hitIndex(g.fixtures[1].x + g.fixtures[1].h * 3, g.fixtures[1].geom().bulbY) === -1, '点两盏之间 → 不误伤');

  // 归一化真的在起作用：多盏时单盏更弱，但覆盖范围更大
  cfg.count = 1;
  const solo = new PondLamp(world); solo.set(true); solo.glow = 1;
  const cS = makeCtx(); solo.drawGlow(cS.ctx, 0.28, 5);
  cfg.count = 3;
  const trio = new PondLamp(world); trio.set(true); trio.glow = 1;
  const cT = makeCtx(); trio.drawGlow(cT.ctx, 0.28, 5);
  const peakOf = (c) => Math.max(...c.grads.filter((x) => x.kind === 'radial')
    .map((x) => alphaOfColor(x.stops[0].c)));
  ok(peakOf(cT) < peakOf(cS), `多盏时单盏峰值更低（${peakOf(cT).toFixed(3)} < ${peakOf(cS).toFixed(3)}），不会糊成一片白`);
  ok(cT.calls.fillRect > cS.calls.fillRect * 2, `但覆盖面明显更广（倒影条数 ${cS.calls.fillRect} → ${cT.calls.fillRect}）`);
  ok(cT.calls.grad === cS.calls.grad * 3, `渐变开销随盏数线性增长（${cS.calls.grad} → ${cT.calls.grad}）`);

  // 改数量后重建：沿用总开关状态，不发散
  cfg.count = 3;
  const r = new PondLamp(world);
  r.set(true);
  cfg.count = 5;
  r.rebuild();
  ok(r.count === 5 && r.litCount === 5, `3 盏改 5 盏 → 新灯沿用"亮着"（${r.litCount}/5）`);
  cfg.count = 1;
  r.rebuild();
  ok(r.count === 1 && r.litCount === 1, '改回 1 盏状态也对');

  Object.assign(cfg, keep);
  // 确认配置已还原（后面的 F 段依赖默认盏数）
  ok(CONFIG.lamp.count === keep.count, `配置已还原：count=${keep.count}`);
}

console.log('\n=== H. 天空：不画日月圆盘，只留光线（阶段 6-⑨）===');
{
  const keep = { ...CONFIG.daynight };
  // 正午：太阳高悬。日轮半径 r = min(22, bankY*0.14)，先算出"该有多大"
  const sunR = Math.min(22, world.bankY * 0.14);
  const nearR = (c, r) => c.arcs.filter((a) => Math.abs(a.r - r) < Math.max(2, r * 0.12)).length;

  setClock(12, 0);
  const dnNoon = new DayNight();
  dnNoon.setDayT(0.5);
  const c1 = makeCtx();
  dnNoon.drawSky(c1.ctx, world);
  ok(nearR(c1, sunR) === 0, `默认不画日轮（半径 ${sunR.toFixed(0)}px 的实心圆 0 个）`);
  ok(c1.grads.some((g) => g.kind === 'radial'), '但仍有太阳辉光的径向渐变 —— 光还在，只是没有圆盘');
  ok(c1.arcs.length > 0, '有 arc 绘制（辉光/霞光），天空不是一片死色');

  // 打开开关 → 日轮回来
  CONFIG.daynight.showSunDisc = true;
  const c2 = makeCtx();
  dnNoon.drawSky(c2.ctx, world);
  ok(nearR(c2, sunR) >= 1, `showSunDisc=true 时日轮画出来了（半径 ${sunR.toFixed(0)}px）`);
  CONFIG.daynight.showSunDisc = false;

  // 夜景：默认不画月轮（半径 r = min(26, bankY*0.16)）
  const moonR = Math.min(26, world.bankY * 0.16);
  setClock(22, 0);
  const dnNight = new DayNight();
  const c3 = makeCtx();
  dnNight.drawSky(c3.ctx, world);
  ok(nearR(c3, moonR) === 0, `夜里默认也不画月轮（半径 ${moonR.toFixed(0)}px 的实心圆 0 个）`);
  ok(c3.arcs.length > 30, `星星照旧（${c3.arcs.length} 个 arc）`);
  CONFIG.daynight.showMoonDisc = true;
  const c4 = makeCtx();
  dnNight.drawSky(c4.ctx, world);
  ok(nearR(c4, moonR) >= 1, 'showMoonDisc=true 时月轮回来了');
  CONFIG.daynight.showMoonDisc = false;

  // 地平线霞光：日出/日落最浓，正午最淡
  const glow = (h, m) => {
    setClock(h, m);
    const d = new DayNight();
    const c = makeCtx();
    d.drawSky(c.ctx, world);
    return radialAlphaSum(c);
  };
  const dawn = glow(5, 30), noon = glow(12, 0), dusk = glow(18, 30);
  ok(dawn > noon && dusk > noon,
    `霞光随太阳高度变化：日出 ${dawn.toFixed(2)} / 正午 ${noon.toFixed(2)} / 日落 ${dusk.toFixed(2)}`);
  CONFIG.daynight.horizonGlow = false;
  const off = glow(5, 30);
  ok(off < dawn, `关掉地平线霞光后总量下降（${dawn.toFixed(2)} → ${off.toFixed(2)}）`);
  Object.assign(CONFIG.daynight, keep);
  ok(CONFIG.daynight.horizonGlow === keep.horizonGlow, '配置已还原');
}

restoreClock();
console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
