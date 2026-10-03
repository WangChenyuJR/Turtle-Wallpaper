/**
 * 荷叶侧视化诊断（阶段 8-①）—— 纯 Node，不开浏览器
 *
 * 设计要点：
 *   · **不 import world.js** —— 地形正在被另一个会话改，这里用自造的假 world，
 *     只实现 plants 需要的接口。于是这份断言不会被地形改动带崩，可以当稳定回归用。
 *   · 假 ctx 实现**完整 2D 变换矩阵**（translate/rotate/scale 真实累乘）+ 真状态栈，
 *     所以记录下来的每个路径顶点都是**世界坐标** —— 才能断言"花瓣朝上张开"
 *     "花梗有多高""茎垂到池底"这类空间关系。
 *   · 局部几何（叶片压扁/上翘）另用"零变换 ctx"单独跑 `_leafPath` 取局部坐标。
 *
 * 跑法：node _diag_plants.mjs
 */

import { PLANT_SPECIES, Plant, PlantField } from './src/plants.js';
import { CONFIG } from './src/config.js';

let PASS = 0, FAIL = 0;
const FAILS = [];
function ok(name, cond, extra = '') {
  if (cond) { PASS++; return; }
  FAIL++;
  FAILS.push(`${name}${extra ? '  → ' + extra : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ══════════════════════════════════════════════════════════
//  假 world
// ══════════════════════════════════════════════════════════
function makeWorld(opts = {}) {
  const W = opts.w ?? 1200, H = opts.h ?? 900;
  const waterY = opts.waterY ?? Math.round(H * 0.34);
  const bedY = opts.bedY ?? Math.round(H * 0.82);
  return {
    w: W, h: H, waterY, bedY,
    waterSpans: opts.waterSpans ?? [{ x0: Math.round(W * 0.2), x1: Math.round(W * 0.8) }],
    landZones: opts.landZones ?? [],
    surfaceAt: (x) => waterY + Math.sin(x * 0.013) * 2,
    groundYAt: (x) => (opts.flat ? opts.flat(x) : bedY + Math.sin(x * 0.02) * 8),
  };
}

// ══════════════════════════════════════════════════════════
//  假 ctx —— 真变换矩阵 + 真状态栈 + 路径记录（世界坐标）
// ══════════════════════════════════════════════════════════
function makeCtx() {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack = [];
  const st = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '' };
  const r = { pts: [], quads: [], fills: 0, strokes: 0, ellipses: [], arcs: [], grads: 0, gradStops: [] };

  const mul = (n) => {
    m = {
      a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
    };
  };
  const tx = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  const push = (op, x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { r.pts.push({ op: 'NaN' }); return; }
    r.pts.push({ op, x, y, alpha: st.globalAlpha, strokeStyle: st.strokeStyle, lw: st.lineWidth });
  };

  const ctx = {
    // ── 变换 ──
    save() { stack.push({ m: { ...m }, st: { ...st } }); },
    restore() { const s = stack.pop(); if (s) { m = s.m; Object.assign(st, s.st); } },
    translate(x, y) { mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    rotate(a) { const co = Math.cos(a), si = Math.sin(a); mul({ a: co, b: si, c: -si, d: co, e: 0, f: 0 }); },
    scale(x, y = x) { mul({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); },
    setTransform() {}, resetTransform() {},

    // ── 路径 ──
    beginPath() { r.pts.push({ op: 'begin' }); },
    moveTo(x, y) { const p = tx(x, y); push('moveTo', p.x, p.y); },
    lineTo(x, y) { const p = tx(x, y); push('lineTo', p.x, p.y); },
    quadraticCurveTo(cx, cy, x, y) {
      const c = tx(cx, cy), e = tx(x, y);
      r.quads.push({ cp: c, end: e, alpha: st.globalAlpha });
      push('quad', e.x, e.y);
    },
    bezierCurveTo(a, b, c, d, x, y) { const e = tx(x, y); push('bezier', e.x, e.y); },
    arc(x, y, rad) { const p = tx(x, y); r.arcs.push({ x: p.x, y: p.y, r: rad }); push('arc', p.x, p.y); },
    ellipse(x, y, rx, ry) { const p = tx(x, y); r.ellipses.push({ x: p.x, y: p.y, rx, ry, alpha: st.globalAlpha }); },
    closePath() {}, clip() {},
    fill() { r.fills++; }, stroke() { r.strokes++; },
    fillRect() {}, strokeRect() {}, drawImage() {}, putImageData() {}, fillText() {}, strokeText() {},
    createLinearGradient() { r.grads++; return { addColorStop: (p, c) => r.gradStops.push({ p, c }) }; },
    createRadialGradient() { r.grads++; return { addColorStop() {} }; },
    createPattern() { return null; },
    measureText() { return { width: 10 }; },
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap', 'lineJoin',
                   'globalCompositeOperation', 'font', 'textAlign', 'textBaseline',
                   'shadowBlur', 'shadowColor', 'imageSmoothingEnabled']) {
    Object.defineProperty(ctx, k, { get: () => st[k], set: (v) => { st[k] = v; }, enumerable: true });
  }
  ctx._rec = r;
  return ctx;
}

const ptsOf = (c, op) => c._rec.pts.filter(p => (op ? p.op === op : true) && Number.isFinite(p.y));

// ══════════════════════════════════════════════════════════
//  1) 叶片几何：扁平 + 远端上翘（用零变换 ctx 取**局部**坐标）
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  let liftWorks = 0, asymWorks = 0, boxOk = 0;
  const N = 30;

  for (let i = 0; i < N; i++) {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    const r = p.size;
    p._squash = 0.26;

    // ① 关掉上翘 → 纯压扁
    p._rimLift = 0;
    const flat = makeCtx();
    p._leafPath(flat, r);
    const yF = ptsOf(flat, 'lineTo').map(q => q.y);

    // ② 打开上翘
    p._rimLift = r * 0.14;
    const lifted = makeCtx();
    p._leafPath(lifted, r);
    const yL = ptsOf(lifted, 'lineTo').map(q => q.y);
    const xs = ptsOf(lifted, 'lineTo').map(q => q.x);

    const minF = Math.min(...yF), minL = Math.min(...yL);
    const maxL = Math.max(...yL);
    const maxAbsX = Math.max(...xs.map(Math.abs));

    // 压扁：整片叶子的纵向半高远小于半径
    if (Math.max(Math.abs(minL), Math.abs(maxL)) <= r * 0.55) boxOk++;
    // 上翘：远端被抬得更高（y 更负）
    if (Math.abs(minL) > Math.abs(minF) * 1.15 && Math.abs(minL) > Math.abs(minF) + 1.5) liftWorks++;
    // 上翘带来不对称：远端比近端更"远"
    if (Math.abs(minL) > Math.abs(maxL) * 1.15) asymWorks++;

    ok(`叶片[${i}] 横向不超界（|x| ≤ 1.6r，含谐波 + 椭圆化最坏情况）`,
      maxAbsX <= r * 1.6, `|x|max=${maxAbsX.toFixed(1)} r=${r.toFixed(1)}`);
    ok(`叶片[${i}] 路径顶点足够（≥40）`, yL.length >= 40, `${yL.length}`);
  }

  ok(`叶片 压扁达标 ${boxOk}/${N}（|y| ≤ 0.55r，旧版 0.58 压扁会到 0.64r）`, boxOk === N, `${boxOk}/${N}`);
  // 上翘/不对称都受"逐株随机波浪边"影响：某株远端恰好落在凹处时幅度偏小，允许 10% 波动
  // （旧版没有 lift → 这两个计数恒为 0，所以放宽后依然能区分新旧）
  ok(`叶片 远端上翘生效 ≥${Math.ceil(N * 0.9)}/${N}（开上翘后 yMin 明显更负）`,
    liftWorks >= Math.ceil(N * 0.9), `${liftWorks}/${N}`);
  ok(`叶片 上下不对称 ≥${Math.ceil(N * 0.9)}/${N}（|远端| > |近端| × 1.15 = 翘边而非对称椭圆）`,
    asymWorks >= Math.ceil(N * 0.9), `${asymWorks}/${N}`);
}

// ══════════════════════════════════════════════════════════
//  2) _rimLiftAt：只在远端生效、单调、端点精确
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
  p._rimLift = 5;
  ok('上翘 近端(syRaw>0) 恒为 0', p._rimLiftAt(10, 30) === 0 && p._rimLiftAt(0.1, 30) === 0);
  ok('上翘 叶心一线为 0', p._rimLiftAt(0, 30) === 0);
  ok('上翘 最远端 ≈ 全量（±5%）', near(p._rimLiftAt(-30 * 1.08, 30), 5, 0.25),
    `实际 ${p._rimLiftAt(-30 * 1.08, 30).toFixed(2)}`);
  const a = p._rimLiftAt(-5, 30), b = p._rimLiftAt(-15, 30), c = p._rimLiftAt(-25, 30);
  ok('上翘 单调递增（越远抬得越多）', a < b && b < c, `${a.toFixed(2)} < ${b.toFixed(2)} < ${c.toFixed(2)}`);
  ok('上翘 中点落在 (0, 全量) 之间', p._rimLiftAt(-16.2, 30) > 0 && p._rimLiftAt(-16.2, 30) < 5);
  ok('上翘 未设置时为 0（防御）', (() => {
    const q = Object.create(Plant.prototype); q.shape = p.shape; return q._rimLiftAt(-20, 30) === 0;
  })());
}

// ══════════════════════════════════════════════════════════
//  3) 根茎：从叶心垂到**池底**（世界坐标）
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  let checked = 0, widths = [];
  for (let i = 0; i < 25; i++) {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p.hasFlower = false;
    const c = makeCtx();
    p.draw(c, 3.2);

    const gY = W.groundYAt(p.x);
    // 单独跑 `_drawStem`：起点直接落在 moveTo，终点落在 quadraticCurveTo
    const sc = makeCtx();
    p._drawStem(sc, p.x, p.y, 3.2);
    const start = sc._rec.pts.find(q => q.op === 'moveTo');
    const seg = sc._rec.quads[0];
    if (!start || !seg) { ok(`根茎[${i}] 存在下垂的茎`, false, '未产生茎'); continue; }

    ok(`根茎[${i}] 起点就在叶心（±0.5px）`, near(start.x, p.x, 0.5) && near(start.y, p.y, 0.5),
      `起点(${start.x.toFixed(1)},${start.y.toFixed(1)}) 叶心(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    ok(`根茎[${i}] 终点落在池底`, near(seg.end.y, gY, 1.5),
      `终点 ${seg.end.y.toFixed(1)} vs groundYAt ${gY.toFixed(1)}`);
    ok(`根茎[${i}] 长度 ≥ 水深的 50%`, (gY - p.y) >= (W.bedY - W.waterY) * 0.5,
      `${(gY - p.y).toFixed(0)}px / 水深 ${W.bedY - W.waterY}px`);
    checked++;
  }
  ok('根茎 抽样数量达标', checked >= 20, `${checked}/25`);

  const c2 = makeCtx();
  const p2 = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
  p2.hasFlower = false;
  p2.draw(c2, 1);
  ok('根茎 用渐变做深度衰减（≥3 色标）', c2._rec.gradStops.length >= 3, `${c2._rec.gradStops.length} 条`);

  // 浅水（茎长 < 6px）不画茎
  const shallow = makeWorld({ flat: () => W.waterY + 3, bedY: W.waterY + 3 });
  const p3 = new Plant(shallow, PLANT_SPECIES.lilypad, 'surface');
  p3.hasFlower = false;
  const c3 = makeCtx();
  p3._drawStem(c3, p3.x, p3.y, 1);
  ok('浅水 不画根茎（避免一根短桩）', c3._rec.strokes === 0 && c3._rec.quads.length === 0,
    `strokes=${c3._rec.strokes} quads=${c3._rec.quads.length}`);
}

// ══════════════════════════════════════════════════════════
//  4) 花：直立花梗 + 侧向张开的扇形花冠（世界坐标）
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  const mk = (spId) => {
    const p = new Plant(W, PLANT_SPECIES[spId], 'surface');
    p.hasFlower = true;
    const c = makeCtx();
    p.draw(c, 2.0);
    const all = ptsOf(c).filter(q => q.op !== 'begin' && q.op !== 'NaN');
    const ys = all.map(q => q.y), xs = all.map(q => q.x);
    return {
      p, c,
      topY: Math.min(...ys), bottomY: Math.max(...ys),
      spreadX: Math.max(...xs) - Math.min(...xs),
    };
  };
  const lily = mk('lilypad');
  const lotus = mk('lotus');

  // 花梗高度 = 花托 → 梗顶（向上那条 quadraticCurveTo）。比"整体包围盒"精确得多：
  // 包围盒会把花瓣张开的长度也算进去（约 +0.67r），容易误判。
  const stemH = (o) => {
    const q = o.c._rec.quads.find(v => v.end.y < o.p.y - 1);
    return q ? o.p.y - q.end.y : -1;
  };
  const lH = stemH(lily), oH = stemH(lotus);

  ok('花 睡莲花梗存在', lH > 0, `实测 ${lH.toFixed(1)}`);
  ok('花 荷花花梗存在', oH > 0, `实测 ${oH.toFixed(1)}`);
  ok('花 睡莲花梗 ≈ 0.5r（矮，贴着叶面开）', near(lH, lily.p.size * 0.5, lily.p.size * 0.18 + 2),
    `实测 ${lH.toFixed(1)}px / 期望≈${(lily.p.size * 0.5).toFixed(1)}px`);
  ok('花 荷花花梗 ≈ 1.25r（高，挺出水面）', near(oH, lotus.p.size * 1.25, lotus.p.size * 0.2 + 2),
    `实测 ${oH.toFixed(1)}px / 期望≈${(lotus.p.size * 1.25).toFixed(1)}px`);
  ok('花 荷花明显比睡莲高（侧视一眼可辨）', oH > lH * 1.6, `荷 ${oH.toFixed(0)}px vs 睡 ${lH.toFixed(0)}px`);

  const lilyH = lily.p.y - lily.topY;
  ok('花 花冠侧向张开（横向铺开 ≥ 抬高 × 0.8，而不是绕圈）',
    lily.spreadX >= lilyH * 0.8, `spreadX=${lily.spreadX.toFixed(1)} 抬高=${lilyH.toFixed(1)}`);
  ok('花 整个花冠在叶心之上（不埋进叶子里）', lily.topY < lily.p.y - 1,
    `topY=${lily.topY.toFixed(1)} 叶心=${lily.p.y.toFixed(1)}`);
  ok('花 花瓣真的画了（fill 计数 ≥ 5）', lily.c._rec.fills >= 5, `fills=${lily.c._rec.fills}`);
  ok('花 花蕊画了（arc ≥ 4）', lily.c._rec.arcs.length >= 4, `arc=${lily.c._rec.arcs.length}`);
}

// ══════════════════════════════════════════════════════════
//  5) 叶脉已从"360° 放射"改成"水平浅扇形"
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  let veinOk = 0, angOk = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p._squash = 0.26;
    p._rimLift = p.size * 0.14;
    const c = makeCtx();
    p._drawSideVeins(c, p.size);            // 只跑叶脉，避免混入叶轮廓
    const segs = ptsOf(c, 'lineTo');
    if (segs.length >= 3 && segs.length <= 5) veinOk++;
    // 每条脉的倾角都在 ±30° 内（水平浅扇形）
    const allFlat = segs.every(s => Math.abs(Math.atan2(s.y, s.x || 1e-6)) <= 0.56);
    if (allFlat) angOk++;
  }
  ok(`叶脉 条数收敛到 3~5 条 ${veinOk}/${N}（旧版是 7~12 条）`, veinOk === N, `${veinOk}/${N}`);
  ok(`叶脉 全部落在 ±32° 的水平扇形内 ${angOk}/${N}`, angOk === N, `${angOk}/${N}`);
}

// ══════════════════════════════════════════════════════════
//  6) 无花分支 + update 不抛错
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
  p.hasFlower = false;
  const c = makeCtx();
  p.draw(c, 1.0);
  ok('无花 时仍然画了叶片（fill ≥ 1）', c._rec.fills >= 1, `fills=${c._rec.fills}`);
  ok('无花 时整体绘制调用非空', c._rec.pts.length > 10 && c._rec.strokes >= 1,
    `pts=${c._rec.pts.length} strokes=${c._rec.strokes}`);
  ok('绘制无 NaN 坐标', !c._rec.pts.some(q => q.op === 'NaN'));

  let threw = null;
  try { for (let i = 0; i < 30; i++) p.update(1 / 60, i * 0.016, []); } catch (e) { threw = e; }
  ok('update 不抛错（空 mover 列表）', !threw, threw ? String(threw.message) : '');
}

// ══════════════════════════════════════════════════════════
//  7) 整片荷塘：浮叶都贴在水线上 + 存档形状可复现
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  const field = new PlantField(W, { lilypad: 12, lotus: 6, reed: 8, eelgrass: 10 });
  const surface = field.plants.filter(x => x.kind === 'surface');
  let bad = 0;
  for (const p of surface) {
    const d = p.y - W.surfaceAt(p.x);
    if (d < -2 || d > 9) bad++;
  }
  ok('18 株浮叶全部贴在水线上（-2 ~ +9px）', bad === 0, `越界 ${bad} 株`);
  ok('浮叶数量正确（18）', surface.length === 18, `${surface.length}`);

  const c = makeCtx();
  let threw = null;
  try { field.drawLayer(c, 1.0, 'surface'); } catch (e) { threw = e; }
  ok('drawLayer(surface) 不抛错', !threw, threw ? String(threw.message) : '');
  ok('drawLayer 真的画了东西', c._rec.fills > 10, `fills=${c._rec.fills}`);

  const p0 = surface[0];
  const snap = JSON.stringify(p0.shape);
  p0.reseed(p0.seed);
  ok('reseed 之后形状完全复现（存档一致性）', JSON.stringify(p0.shape) === snap);

  // 全部植物（含岸边/沉水）整层绘制都不抛错
  for (const kind of ['bank', 'submerged']) {
    const cc = makeCtx();
    let e2 = null;
    try { field.drawLayer(cc, 1.0, kind); } catch (e) { e2 = e; }
    ok(`drawLayer(${kind}) 不抛错`, !e2, e2 ? String(e2.message) : '');
  }
}

// ══════════════════════════════════════════════════════════
//  8) 侧视站得住：**叶片本身**扁而横（不含根茎 —— 根茎会垂到池底，不能算进包围盒）
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  let flat = 0;
  const N = 15;
  for (let i = 0; i < N; i++) {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p._squash = 0.26;
    p._rimLift = p.size * 0.14;
    const c = makeCtx();
    c.save(); c.translate(p.x, p.y);
    p._leafPath(c, p.size);
    p._drawSideVeins(c, p.size);
    c.restore();
    const xs = ptsOf(c).map(q => q.x), ys = ptsOf(c).map(q => q.y);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    // 横向铺开应该是纵向厚度的 2.2 倍以上
    // （旧版 0.58 压扁 + 无翘边时约 2.09，所以这个阈值仍能区分新旧）
    if (bw >= bh * 2.2) flat++;
  }
  ok(`叶片"扁而横" ${flat}/${N}（宽 ≥ 厚 × 2.2）`, flat === N, `${flat}/${N}`);
}

// ══════════════════════════════════════════════════════════
//  9) 浮叶被生物推开：必须"同一水层"才算碰到 + 纵向不许跳（阶段 8-⑧）
//     用户："龟龟和魚魚遇到荷叶杆会改变运动状态，这个可以改一下，因为侧视图
//            他们不一定撞到杆了，只是从后面正常经过，即使撞到了也不要突然在
//            Z 轴上快速移动。"
//     侧视剖面里"从后面经过"= 生物在水面以下较深处游过，屏幕投影虽然重叠，
//     但不在同一水层，不该有任何作用。这就是可测版本。
// ══════════════════════════════════════════════════════════
{
  const W = makeWorld();
  const srf = W.surfaceAt(W.w * 0.5);
  const band = CONFIG.plants?.leafTouchBand ?? 14;
  const offY = CONFIG.plants?.leafOffY ?? 3;

  // ① 生物在荷叶**下方很深处**经过（从"后面"经过）→ 完全推不动它
  {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p.x = W.w * 0.5; p.y = srf + 2;
    for (let i = 0; i < 120; i++) p.update(1 / 60, i * 0.016, [{ x: p.x, y: srf + 200, size: 34 }]);
    ok('生物在荷叶下方 200px 经过 → 浮叶纹丝不动',
      Math.abs(p.ox) < 0.01 && Math.abs(p.oy) < 0.01,
      `ox=${p.ox.toFixed(3)} oy=${p.oy.toFixed(3)}`);
  }

  // ② 生物贴着水面从旁边挤过 → 被**横向**推开，纵向几乎不动
  {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p.x = W.w * 0.5; p.y = srf + 2;
    for (let i = 0; i < 120; i++) p.update(1 / 60, i * 0.016, [{ x: p.x - 10, y: srf + 2, size: 34 }]);
    ok('生物贴水面挤过 → 浮叶被横向推开（还在互动）', Math.abs(p.ox) > 1, `ox=${p.ox.toFixed(2)}`);
    ok(`同一过程纵向漂移 ≤${offY}px（浮叶不会"跳起来"）`, Math.abs(p.oy) <= offY + 0.01,
      `oy=${p.oy.toFixed(2)}`);
  }

  // ③ 极端：8 只生物在同一层往同一个方向猛挤 → 纵向仍被限幅
  {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p.x = W.w * 0.5; p.y = srf + 2;
    const mob = [];
    for (let k = 0; k < 8; k++) mob.push({ x: p.x + (k - 4) * 5, y: srf - 5, size: 34 });
    for (let i = 0; i < 600; i++) p.update(1 / 60, i * 0.016, mob);
    ok(`8 只生物同层猛挤 10 秒 → 纵向仍被限死在 ${offY}px 内`, Math.abs(p.oy) <= offY + 0.01,
      `oy=${p.oy.toFixed(2)}`);
    const offX = CONFIG.plants?.leafOff ?? 22;
    ok(`横向漂移也被限幅在 ${offX}px 内`, Math.abs(p.ox) <= offX + 0.01, `ox=${p.ox.toFixed(2)}`);
  }

  // ④ 判定阈值本身：band 之外的深度一律不算接触（防以后有人把 band 调大回去）
  {
    const p = new Plant(W, PLANT_SPECIES.lilypad, 'surface');
    p.x = W.w * 0.5; p.y = srf + 2;
    const justOutside = srf + band + 20 + 10;      // 比 band + 半个身位再深一点
    for (let i = 0; i < 120; i++) p.update(1 / 60, i * 0.016, [{ x: p.x, y: justOutside, size: 34 }]);
    ok(`离水线 ${(band + 30).toFixed(0)}px 的生物不算接触（band=${band}）`,
      Math.abs(p.ox) < 0.01, `ox=${p.ox.toFixed(3)}`);
  }
}

// ══════════════════════════════════════════════════════════
console.log('\n──────────────────────────────────────────');
console.log(`荷叶侧视化诊断：通过 ${PASS} / 失败 ${FAIL}`);
if (FAIL) {
  console.log('\n失败项：');
  for (const f of FAILS.slice(0, 20)) console.log('  ✗ ' + f);
  if (FAILS.length > 20) console.log(`  … 另有 ${FAILS.length - 20} 项`);
} else {
  console.log('✓ 全部通过');
}
console.log('──────────────────────────────────────────\n');
process.exit(FAIL ? 1 : 0);
