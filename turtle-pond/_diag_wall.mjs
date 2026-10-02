/**
 * 纯 Node 回归：水下墙体碰撞 —— 硬钳制 → 沿墙滑行（阶段 8-③）
 *
 * 覆盖：
 *   A. wallInfo 几何 —— 水面/池底/岸坡的法线方向与连续性（噪声不许抖乱法线）
 *   B. wallResponse —— 切向速度保留 ≥60%（旧版整体反向会把它翻号）/
 *      法向速度被反射而不是整体 *-0.5 / 软避让 / 角落脱困
 *   C. 集成 —— 鱼群持续冲岸 30 秒不穿透、不 NaN；乌龟水陆往返不被墙约束卡住
 *
 * 跑法： node _diag_wall.mjs
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── 最小桩（PondApp 需要 document/window/localStorage）──
const makeEl = (ext = {}) => ({
  tagName: 'DIV', id: '', style: {}, dataset: {}, children: [], _events: {},
  value: '', textContent: '', width: 0, height: 0,
  set innerHTML(_v) {}, get innerHTML() { return ''; },
  addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  blur() {}, focus() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
  classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  ...ext,
});
const makeCanvas = (w = 1280, h = 720) => {
  const stub = { width: w, height: h, style: {} };
  const noop = new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return stub;
      if (String(p).startsWith('create')) return () => ({ addColorStop() {} });
      if (p === 'createImageData') return (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(4) });
      if (p === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set() { return true; },
  });
  stub.getContext = () => noop;
  return stub;
};
globalThis.document = {
  head: makeEl(), body: makeEl(), documentElement: makeEl(), hidden: false, addEventListener() {},
  getElementById: () => makeCanvas(),
  createElement: (t) => (t === 'canvas' ? makeCanvas() : makeEl({ querySelector: () => makeEl() })),
};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720, addEventListener() {}, removeEventListener() {},
  location: { search: '' }, dispatchEvent() { return true; },
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } };
globalThis.location = globalThis.window.location;

const { CONFIG } = await import('./src/config.js');
const { World } = await import('./src/world.js');
const { PondApp } = await import('./src/main.js');

const W = new World(1280, 720);
const span = W.waterSpans[0];
const midX = (span.x0 + span.x1) / 2;
const NAT = CONFIG.natural ?? {};

// ══════════════════════════════════════════════════════════
//  A. wallInfo 几何
// ══════════════════════════════════════════════════════════
console.log('\n=== A. 墙面几何（法线 + 穿透深度）===');
{
  const yMid = (W.surfaceAt(midX) + W.groundYAt(midX)) / 2;
  const iMid = W.wallInfo(midX, yMid, 10);
  ok(!iMid.hit, `水域中央不触发墙（depth=${iMid.depth.toFixed(1)}）`);

  const iTop = W.wallInfo(midX, W.surfaceAt(midX) - 5, 10);
  ok(iTop.hit && iTop.kind === 'surface' && iTop.ny > 0.9,
    `水面墙：法线朝下，把生物推回水里（n=(${iTop.nx},${iTop.ny.toFixed(2)})）`);

  // ⚠ 水域内部并不是平的：水下浅滩会一路降到池底，晒台旁边还有近垂直的侧壁。
  //   拿陡段测"池底法线"会测到斜坡法线 —— 那是断言假设错了，不是代码错了。
  const flatX = (() => {
    let best = span.x0 + 10, bestS = Infinity;
    for (let x = span.x0 + 10; x < span.x1 - 10; x += 2) {
      const s = Math.abs((W.groundYAt(x + 4) - W.groundYAt(x - 4)) / 8);
      if (s < bestS) { bestS = s; best = x; }
    }
    return best;
  })();
  const iBot = W.wallInfo(flatX, W.groundYAt(flatX) + 5, 10);
  ok(iBot.hit && iBot.ny < -0.9,
    `平缓池底墙：法线朝上（x=${flatX} n=(${iBot.nx.toFixed(2)},${iBot.ny.toFixed(2)})）`);

  // 穿透越深，depth 越大
  const d1 = W.wallInfo(midX, W.surfaceAt(midX) - 2, 10).depth;
  const d2 = W.wallInfo(midX, W.surfaceAt(midX) - 12, 10).depth;
  ok(d2 > d1 + 9, `穿透深度随越界距离线性增长（${d1.toFixed(1)} → ${d2.toFixed(1)}）`);

  // 噪声判别：2px 步长的法线跳变**不应显著大于** 20px 步长。
  // 若退回"相邻两点差分"，地形自带的 ±2px 起伏噪声会让 short/long 的比值远大于 1；
  // 用 ±3px 滑动窗口后两者应当同量级。这比"单帧跳变 < 30°"更能区分噪声与真实拐角。
  let shortSum = 0, longSum = 0, n = 0;
  for (const [a, b] of [[span.x0 + 8, span.x1 - 128], [span.x1 - 128, span.x1 - 8]]) {
    for (let x = a; x < b; x += 20) {
      const i0 = W.wallInfo(x, W.groundYAt(x) - 4, 8);
      const i1 = W.wallInfo(x + 2, W.groundYAt(x + 2) - 4, 8);
      const i2 = W.wallInfo(x + 20, W.groundYAt(x + 20) - 4, 8);
      if (!i0.hit || !i1.hit || !i2.hit) continue;
      const ang = (p, q) => Math.acos(clamp(p.nx * q.nx + p.ny * q.ny, -1, 1));
      shortSum += ang(i0, i1); longSum += ang(i0, i2); n++;
    }
  }
  const toDeg = (r) => r * 180 / Math.PI;
  ok(n > 10 && shortSum <= longSum,
    `法线不是噪声抖动（${n} 组：2px 步长累计 ${toDeg(shortSum).toFixed(1)}° ≤ 20px 步长 ${toDeg(longSum).toFixed(1)}°）`);
}

// ══════════════════════════════════════════════════════════
//  B. wallResponse：切向保留 / 反射 / 脱困
// ══════════════════════════════════════════════════════════
console.log('\n=== B. 墙体响应（沿墙滑行，不是贴墙下滑）===');
{
  // 找一处"陡坡"（晒台侧壁 / 岸坡陡段）：法线明显偏向水平
  let spot = null;
  for (let x = span.x1 - 6; x > span.x0; x -= 2) {
    for (let dy = 2; dy < 70; dy += 2) {
      const inf = W.wallInfo(x, W.groundYAt(x) - dy, 12);
      if (inf.hit && Math.abs(inf.nx) > 0.45) { spot = { x, y: W.groundYAt(x) - dy, inf }; break; }
    }
    if (spot) break;
  }
  ok(!!spot, spot ? `找到陡坡采样点 x=${spot.x.toFixed(0)} kind=${spot.inf.kind}` : '没找到陡坡点');

  if (spot) {
    const n = spot.inf;
    // 沿**切向**为主 + 朝墙一点地撞（否则速度与法线平行，切向分量为 0 就测不出"保留"）
    const tx = -n.ny, ty = n.nx;
    const body = { x: spot.x, y: spot.y, vx: tx * 60 - n.nx * 25, vy: ty * 60 - n.ny * 25 };
    const vn0 = body.vx * n.nx + body.vy * n.ny;
    const tx0 = body.vx - vn0 * n.nx, ty0 = body.vy - vn0 * n.ny;
    const vt0 = Math.hypot(tx0, ty0);

    W.wallResponse(body, 12, { dt: 1 / 60 });
    const vn1 = body.vx * n.nx + body.vy * n.ny;
    const tx1 = body.vx - vn1 * n.nx, ty1 = body.vy - vn1 * n.ny;
    const vt1 = Math.hypot(tx1, ty1);

    ok(vt0 > 5, `构造的撞击有可观的切向分量（vt0=${vt0.toFixed(1)}）`);
    ok(vt1 >= vt0 * 0.6,
      `切向速度保留 ${(vt1 / Math.max(1e-6, vt0) * 100).toFixed(0)}%（旧版整体 ×−0.5 会把它翻号）`);
    ok(tx1 * tx0 + ty1 * ty0 > 0, '切向方向没有被翻转');
    ok(vn1 > vn0,
      `法向速度被弹开（${vn0.toFixed(1)} → ${vn1.toFixed(1)}，恢复系数 ${NAT.wallBounce ?? 0.32}）`);
    ok(Math.abs(vn1) < Math.abs(vn0) * (1 + (NAT.wallBounce ?? 0.32) + 0.6),
      '法向没有过度反弹（只是软弹开，不是弹球）');
  }
}

{
  // 软避让：进入身体半径内会被沿法线推开
  const yNear = W.surfaceAt(midX) + 4;                 // 贴着水面（穿透）
  const body = { x: midX, y: yNear, vx: 0, vy: 0 };
  const before = body.vy;
  W.wallResponse(body, 20, { dt: 1 / 60 });
  ok(body.vy > before, `贴到水面时被沿法线（向下）推开（vy ${before.toFixed(2)} → ${body.vy.toFixed(2)}）`);
}

{
  // 角落脱困：持续朝角落猛冲 60 秒，位置必须还在变（没卡死）
  const cx = span.x0 + 4;
  const cy = W.groundYAt(cx) - 6;
  const body = { x: cx + 30, y: cy - 30, vx: -120, vy: 40 };
  let minX = Infinity, maxX = -Infinity;
  let sank = 0;
  for (let i = 0; i < 3600; i++) {
    body.vx += -160 / 60;                              // 持续朝角落推
    W.wallResponse(body, 12, { dt: 1 / 60 });
    body.x += body.vx / 60;
    body.y += body.vy / 60;
    const c = W.constrainToWater(body.x, body.y, 10);
    body.x = c.x; body.y = c.y;
    body.vx *= 0.995; body.vy *= 0.995;
    minX = Math.min(minX, body.x); maxX = Math.max(maxX, body.x);
    if (!W.isWater(body.x, body.y)) sank++;
  }
  ok(sank === 0, `持续冲角落 60 秒不穿透（越界 ${sank} 帧）`);
  ok(maxX - minX > 4,
    `角落不卡死：60 秒内 x 活动范围 ${(maxX - minX).toFixed(1)}px（脱困助推生效）`);
}

// ══════════════════════════════════════════════════════════
//  C. 集成
// ══════════════════════════════════════════════════════════
console.log('\n=== C. 集成（鱼群冲岸 / 乌龟往返）===');
let app = null, err = null;
try { app = new PondApp(undefined, { resume: false }); } catch (e) { err = e; }
ok(!err, 'PondApp 构造成功', err ? `${err.constructor.name}: ${err.message}` : '');

if (app) {
  const A = app.world;
  for (const f of app.fishes) { f.vx = 220; f.vy = 0; }   // 全体朝右岸冲
  let out = 0, nan = 0, frozen = 0;
  const prev = app.fishes.map((f) => ({ x: f.x, y: f.y }));
  for (let i = 0; i < 1800; i++) {                        // 30 秒
    app._update(1 / 60, i / 60);
    for (let k = 0; k < app.fishes.length; k++) {
      const f = app.fishes[k];
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) { nan++; continue; }
      if (!f.dying && !A.isWater(f.x, f.y)) out++;
    }
  }
  ok(nan === 0, `鱼群冲岸 30 秒无 NaN（${nan} 次）`);
  ok(out === 0, `鱼群始终在水里（越界 ${out} 次）`);
  ok(app.fishes.length > 0, `鱼群还在（${app.fishes.length} 条）`);

  // 乌龟：往返状态机不能被墙约束卡住（_diag_return 的轻量内联版）
  const moved = app.turtles.map((t) => ({ x: t.x }));
  for (let i = 0; i < 3600; i++) app._update(1 / 60, 100 + i / 60);   // 60 秒
  const still = app.turtles.filter((t, k) => Math.abs(t.x - moved[k].x) < 2).length;
  ok(still < app.turtles.length, `乌龟仍在移动（${app.turtles.length - still}/${app.turtles.length} 只有位移）`);
  const escaped = app.turtles.filter((t) => t.x < -5 || t.x > A.w + 5).length;
  ok(escaped === 0, `没有乌龟跑到画面外（${escaped} 只）`);

  let rerr = null;
  try { app._render(3.0); } catch (e) { rerr = e; }
  ok(!rerr, '_render() 全链路无异常', rerr ? `${rerr.constructor.name}: ${rerr.message}` : '');
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
