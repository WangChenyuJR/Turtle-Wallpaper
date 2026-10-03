/**
 * 纯 Node 回归：一维水面波场 + 拖尾痕迹 + 水下搅动（阶段 8-④）
 *
 * 覆盖：
 *   A. 波场引擎本身 —— 一维性 / 能量衰减 / 波前只沿 x 传播 / 每帧成本
 *   B. World 层 —— 拖尾痕迹的生命周期与上限 / 深水改走水下搅动 /
 *      搅动粒子不越出水体 / 溅射不再是同心椭圆环
 *   C. 集成 —— 鼠标分层（水面拖拽 vs 水下搅动）+ 生物起波随深度衰减
 *
 * 跑法： node _diag_wave.mjs
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

// ══════════════════════════════════════════════════════════
//  桩：假 canvas 2d（记录调用；ellipse 单独计数，用来抓"同心环"）
// ══════════════════════════════════════════════════════════
function makeCtx(canvasRef) {
  const calls = {
    fill: 0, stroke: 0, fillRect: 0, fillText: 0, drawImage: 0,
    grad: 0, clip: 0, arc: 0, ellipse: 0, lineTo: 0, quadraticCurveTo: 0,
  };
  const store = {
    canvas: canvasRef, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, filter: 'none',
  };
  // save/restore 必须真的存取状态栈，否则 'lighter' 会永久泄漏（历史踩坑）
  const stack = [];
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return (...args) => {
        if (p === 'save') { stack.push({ ...t }); return undefined; }
        if (p === 'restore') { const s = stack.pop(); if (s) Object.assign(t, s); return undefined; }
        if (p in calls) calls[p]++;
        if (p === 'createImageData') {
          const w = args[0] | 0, h = args[1] | 0;
          return { width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) };
        }
        if (String(p).startsWith('create')) { calls.grad++; return { addColorStop() {} }; }
        if (p === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return { ctx, calls };
}

function makeCanvas(w = 1280, h = 720) {
  const stub = { width: w, height: h, style: {} };
  const c = makeCtx(stub);
  stub.getContext = () => c.ctx;
  stub._calls = c.calls;
  return stub;
}

const makeEl = (ext = {}) => {
  const cls = new Set();
  return {
    tagName: 'DIV', id: '', style: {}, dataset: {}, children: [], _events: {},
    value: '', textContent: '', width: 0, height: 0,
    set innerHTML(_v) {}, get innerHTML() { return ''; },
    addEventListener(t, fn) { this._events[t] = fn; },
    removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    blur() {}, focus() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c), toggle: (c) => (cls.has(c) ? cls.delete(c) : cls.add(c)),
    },
    ...ext,
  };
};

const pondCanvas = makeCanvas();
const stubMap = {
  '.cp-name': makeEl(), '.cp-close': makeEl(), '.cp-tags': makeEl(), '.cp-status': makeEl(),
  '.cp-info': makeEl(), '.cp-views figure.cp-ref': makeEl({ querySelector: () => null }),
  '.cp-cv-top': makeCanvas(120, 120), '.cp-cv-side': makeCanvas(120, 120),
};

globalThis.document = {
  head: makeEl(), body: makeEl(), documentElement: makeEl(),
  hidden: false, addEventListener() {},
  getElementById: (id) => (id === 'pond' ? pondCanvas : makeEl()),
  createElement: (t) => {
    if (t === 'canvas') return makeCanvas();
    // 未命中要返回空 el，不能返回 null（面板会直接 addEventListener）
    return makeEl({ querySelector: (sel) => stubMap[sel] ?? makeEl() });
  },
};

const winEvents = {};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720,
  addEventListener(t, fn) { winEvents[t] = fn; },
  removeEventListener() {},
  location: { search: '' },
  dispatchEvent(e) { const h = winEvents[e.type]; if (h) h(e); return true; },
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
const { WaterWaveField } = await import('./src/waterwave.js');
const { World } = await import('./src/world.js');
const { PondApp } = await import('./src/main.js');

// ══════════════════════════════════════════════════════════
//  A. 波场引擎：一维性 / 衰减 / 传播方向
// ══════════════════════════════════════════════════════════
console.log('\n=== A. 一维水面波场 ===');
const wave = new WaterWaveField(1920, 1080, 4, { ambientGap: 0 });

ok(wave.dim === 1, `波场是一维的（dim=${wave.dim}）`);
ok(wave.rows === 1, `没有 y 方向的行（rows=${wave.rows}）`);
ok(wave.cur.length === wave.cols,
  `场长度 = 列数 ${wave.cols}，不是 cols×rows（2D 版是 ${wave.cols}×1080/7≈${Math.round(wave.cols * 1080 / 7)}）`);
ok(wave.cols < 600, `1920 宽只需 ${wave.cols} 格/帧（旧 2D 版约 42k 格）`);

{
  wave.calm();
  wave.disturb(900, 0, 1.5, 3);
  const e0 = wave.energy();
  ok(e0 > 0, `扰动产生波能 E=${e0.toFixed(3)}`);
  for (let i = 0; i < 600; i++) wave.update(1 / 60, { ambient: false });
  const e1 = wave.energy();
  ok(e1 < e0 * 0.02, `10 秒后衰减到 ${(e1 / e0 * 100).toFixed(2)}%（阻尼 + 两端吸收未失效）`);
}

{
  // 同一 x、不同深度必须读到同一高度 —— 这是"池底的鱼不会在水面画环"的数学保证
  wave.calm();
  wave.disturb(700, 0, 2, 2);
  wave.update(1 / 60, { ambient: false });
  const hShallow = wave.sample(700, 20).h;
  const hDeep = wave.sample(700, 1000).h;
  const hDeeper = wave.sample(700, 10000).h;
  ok(hShallow === hDeep && hDeep === hDeeper,
    `同一 x 无论深浅读到同一高度 h=${hShallow.toFixed(5)}（旧 2D 版会各读各的）`);
  ok(wave.sample(700, 500).gy === 0, '竖直梯度恒为 0（竖直方向没有自由度）');
}

{
  // 波前必须沿 x 向外推进
  wave.calm();
  wave.disturb(960, 0, 3, 2);
  const i0 = wave._col(960);
  const frontR = () => { let f = -1; for (let i = 1; i < wave.cols - 1; i++) if (Math.abs(wave.cur[i]) > 0.004) f = i; return f; };
  const frontL = () => { for (let i = 1; i < wave.cols - 1; i++) if (Math.abs(wave.cur[i]) > 0.004) return i; return -1; };
  const r0 = frontR(), l0 = frontL();
  for (let k = 0; k < 90; k++) wave.update(1 / 60, { ambient: false });
  const r1 = frontR(), l1 = frontL();
  ok(r1 > r0 && l1 < l0, `波前沿水面双向推进：右 ${r0}→${r1}，左 ${l0}→${l1}`);
  ok(r1 > i0 && l1 < i0, '波确实从扰动点向两侧铺开（沿 x 传播，不是以点为中心的环）');
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 600; i++) wave.update(1 / 60, { ambient: false });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // ⚠️ 这是**墙上时钟**断言，必然随系统负载抖动 —— 曾经在"一次连跑 11 个诊断"时偶发 FAIL
  //    （实测 12 次单独跑 0 次失败，批量跑却挂过 1 次）。所以只当**性能冒烟**用：
  //    阈值放到 3000ms（正常 ~10ms，差 300 倍才报），用来抓"波场突然慢了两个数量级"，
  //    而不是量实际性能。真要测性能请单独跑、并用多轮中位数。
  ok(ms < 3000, `600 帧推进 ${ms.toFixed(1)}ms（${(ms / 600).toFixed(3)}ms/帧）[性能冒烟，非基准]`);
}

// ══════════════════════════════════════════════════════════
//  B. World：拖尾 / 搅动 / 溅射
// ══════════════════════════════════════════════════════════
const W = new World(1280, 720);
const midX = (W.waterSpans[0].x0 + W.waterSpans[0].x1) / 2;
// 注意：world.isWater 的上边界是 `y > surfaceAt + 3`（严格大于），
// 所以取 +6 才是"水面附近但仍然算在水里"。
const srfY = (x) => W.surfaceAt(x) + 6;
const NAT = CONFIG.natural ?? {};

console.log('\n=== B. 拖尾痕迹（留在身后 · 拉长变淡）===');
{
  W.wave.calm();
  W.wakeTrails.length = 0;
  W.addWake(midX - 30, srfY(midX - 30), midX + 30, srfY(midX + 30), 600);
  ok(W.wave.energy() > 0, '水面拖拽写进了波场');
  ok(W.wakeTrails.length === 1, `留下 1 条拖尾痕迹（n=${W.wakeTrails.length}）`);
  const wt = W.wakeTrails[0];
  ok(wt.dir === 1 && wt.x1 > wt.x0, `向右移动 → 痕迹方向 dir=${wt.dir}`);

  const x0a = wt.x0;
  for (let i = 0; i < 30; i++) W._updateWakes(1 / 60);
  ok(wt.x0 < x0a - 2, `痕迹向**身后**拉长：x0 ${x0a.toFixed(0)} → ${wt.x0.toFixed(0)}`);
  ok(W.wakeTrails.length === 1, '0.5 秒后痕迹仍在（寿命未到）');

  const lifeLen = CONFIG.natural?.wakeLifeCursor ?? 1.5;
  for (let i = 0; i < Math.ceil(lifeLen * 60) + 20; i++) W._updateWakes(1 / 60);
  ok(W.wakeTrails.length === 0, `${lifeLen}s 后痕迹自动淡出移除（无泄漏）`);
}

{
  // 反向移动 → 往另一头拉长
  W.wakeTrails.length = 0;
  W.addWake(midX + 30, srfY(midX + 30), midX - 30, srfY(midX - 30), 600);
  const wt = W.wakeTrails[0];
  const x1a = wt.x1;
  for (let i = 0; i < 30; i++) W._updateWakes(1 / 60);
  ok(wt.dir === -1 && wt.x1 > x1a + 2,
    `向左移动 → 痕迹向右后方拉长：x1 ${x1a.toFixed(0)} → ${wt.x1.toFixed(0)}`);
}

{
  W.wakeTrails.length = 0;
  for (let i = 0; i < 200; i++) W._pushWake(i * 3, i * 3 + 24, 0.5, false);
  const cap = CONFIG.natural?.wakeCap ?? 90;
  ok(W.wakeTrails.length <= cap, `痕迹数量被上限约束（${W.wakeTrails.length} ≤ ${cap}，防内存增长）`);
  W.wakeTrails.length = 0;
  W._pushWake(100, 100.5, 0.5, false);
  ok(W.wakeTrails.length === 0, '过短的位移不留痕（避免一粒粒孤立的小点）');
}

console.log('\n=== B2. 深水改走水下搅动（不再荡出水面的环）===');
const deepY = Math.min(W.groundYAt(midX) - 12, W.surfaceAt(midX) + 170);
{
  W.wave.calm(); W.wakeTrails.length = 0; W.stirBits.length = 0;
  W.addWake(midX - 20, deepY, midX + 20, deepY, 600);
  ok(W.stirBits.length > 0, `深水拖动翻起粒子（${W.stirBits.length} 个气泡/泥沙）`);
  ok(W.wakeTrails.length === 0, '深水**不留下**水面拖尾痕迹');
  const eDeep = W.wave.energy();

  W.wave.calm(); W.wakeTrails.length = 0; W.stirBits.length = 0;
  W.addWake(midX - 20, srfY(midX), midX + 20, srfY(midX), 600);
  const eSurf = W.wave.energy();
  ok(eSurf > eDeep * 20,
    `同样的拖动，水面扰动远强于深水（${eSurf.toFixed(3)} vs ${eDeep.toFixed(4)}）`);
}

{
  W.stirBits.length = 0;
  W.addUnderwaterStir(midX, deepY, 1.5);
  const n0 = W.stirBits.length;
  let outside = 0;
  for (let i = 0; i < 240; i++) {
    W._updateStirBits(1 / 60);
    for (const p of W.stirBits) {
      if (p.y < W.surfaceAt(p.x) - 0.5 || p.y > W.groundYAt(p.x) + 0.5) outside++;
    }
  }
  ok(outside === 0, `气泡/泥沙始终留在水体内（越界 ${outside} 次，共 ${n0} 个粒子）`);
  ok(W.stirBits.length === 0, '搅动粒子自动消散（4 秒后清零，无泄漏）');
}

console.log('\n=== B3. 溅射不再是同心椭圆环 ===');
{
  const c = makeCtx();
  W.ripples.length = 0;
  W.addRipple(midX, srfY(midX), 1);
  W._drawRipples(c.ctx);
  ok(c.calls.ellipse === 0, '溅射不再调用 ellipse（旧版就是它画的同心环）');
  ok(c.calls.stroke >= 4, `改成"垂直水花 + 沿水线短横痕"（stroke ${c.calls.stroke} 次）`);
  ok(c.calls.fill === 0, '溅射全是线，不再有填充的环');
}

// ══════════════════════════════════════════════════════════
//  C. 集成：鼠标分层 + 生物起波深度权重
// ══════════════════════════════════════════════════════════
console.log('\n=== C. 集成（鼠标分层 / 生物起波）===');
let app = null, err = null;
try { app = new PondApp(undefined, { resume: false }); } catch (e) { err = e; }
ok(!err, 'PondApp 在桩环境里构造成功', err ? `${err.constructor.name}: ${err.message}` : '');

if (app) {
  const A = app.world;
  const mid = (A.waterSpans[0].x0 + A.waterSpans[0].x1) / 2;
  // 阶段 8-⑨ 起：mousemove 只记坐标，尾迹由 _updateCursorFx 按渲染帧驱动 ——
  // 桩测里"发事件后步一帧"，和真实主循环的节奏一致
  const fire = (x, y) => {
    window.dispatchEvent({ type: 'mousemove', clientX: x, clientY: y });
    app._updateCursorFx(1 / 60);
  };

  // ── C1. 水面附近 → 拖尾 ──
  A.wakeTrails.length = 0; A.stirBits.length = 0;
  const sy = A.surfaceAt(mid) + 6;
  fire(mid - 120, sy);
  for (let i = 0; i < 14; i++) fire(mid - 120 + i * 20, sy + Math.sin(i) * 4);
  ok(A.wakeTrails.length > 0, `水面附近划过留下拖尾（n=${A.wakeTrails.length}）`);
  ok(A.stirBits.length === 0, '水面附近不会误触水下搅动');

  // ── C2. 深水 → 搅动，不留水面痕迹 ──
  A.wakeTrails.length = 0; A.stirBits.length = 0;
  A.wave.calm();
  const dy = Math.min(A.groundYAt(mid) - 16, A.surfaceAt(mid) + 150);
  fire(mid - 120, dy);
  for (let i = 0; i < 14; i++) fire(mid - 120 + i * 20, dy);
  ok(A.stirBits.length > 0, `深水划过翻起粒子（n=${A.stirBits.length}）`);
  ok(A.wakeTrails.length === 0, '深水划过不留水面拖尾');
  // 与"水面拖拽"（同强度下 E 约 17）相比，深水搅动只留下 0.6% 的水面扰动
  ok(A.wave.energy() < 0.3, `深水划过几乎不扰动水面（E=${A.wave.energy().toFixed(4)}，水面拖动约 17）`);

  // ── C3. 生物起波随深度衰减 ──
  const depthW = (d) => Math.exp(-Math.max(0, d) / (NAT.waveDepthFade ?? 52));
  ok(depthW(0) === 1 && depthW(52) < 0.38 && depthW(200) < 0.03,
    `起波深度权重：0px=${depthW(0).toFixed(2)} / 52px=${depthW(52).toFixed(2)} / 200px=${depthW(200).toFixed(3)}`);

  if (app.fishes.length) {
    const fish = app.fishes[0];
    fish.vx = 30; fish.vy = 0;
    app.fishes.length = 1;                  // 只留一条鱼参与起波，隔离测量
    for (const tt of app.turtles) { tt.vx = 0; tt.vy = 0; }   // 龟也起波，先按住
    // 把鱼挪到水域中心（最深的地方），否则它可能本来就在浅滩上，
    // "深水"测出来的其实只有几十像素深
    const maxDepth = Math.max(20, A.groundYAt(mid) - A.surfaceAt(mid) - 12);
    const measure = (depth, t) => {
      fish.x = mid;
      const d = Math.min(depth, maxDepth);
      fish.y = A.surfaceAt(mid) + d;
      A.wakeTrails.length = 0;
      A.wave.calm();
      app._swimWakeT = 99;                 // 强制触发这一帧的起波段
      app._update(0.0001, t);
      const strs = A.wakeTrails.map((w) => w.str);
      return {
        e: A.wave.energy(), n: A.wakeTrails.length, depth: d,
        maxStr: strs.length ? Math.max(...strs) : 0,
      };
    };
    const shal = measure(4, 100);
    const deep = measure(220, 200);
    ok(deep.depth > 140, `深水测点真的够深（${deep.depth.toFixed(0)}px，水域最深 ${maxDepth.toFixed(0)}px）`);
    ok(shal.n > 0, `浅水的鱼在水面留痕（${shal.n} 条）`);
    // 阈值放得很松：起波强度 = 体型幂次 pow(ratio, 2.4) × 个性因子，
    // 而每条鱼的初始尺寸是随机的，同一场景不同种子能差一个数量级。
    // 这里只要证明"确实推动了水面"；强度对比交给下面的浅/深比值断言。
    ok(shal.e > 1e-4, `浅水的鱼把水面推动起来了（E=${shal.e.toExponential(2)}）`);
    // 深水：起波强度被 exp(-depth/fade) 压到阈值附近 —— 要么不留痕，
    // 要么留下的痕迹强度 < 浅水的 5%（肉眼等于没有）
    ok(deep.maxStr < shal.maxStr * 0.05,
      `深水的鱼起波强度被深度衰减压垮（max str ${deep.maxStr.toExponential(2)} vs 浅水 ${shal.maxStr.toExponential(2)}）`);
    ok(shal.e > deep.e * 5,
      `浅水起波远强于深水（E ${shal.e.toExponential(2)} vs ${deep.e.toExponential(2)}）`);
  } else {
    ok(false, '场景里没有鱼可测（应有初始鱼群）');
  }

  // ── C4. 全链路渲染不崩 ──
  let rerr = null;
  try { app._render(3.0); } catch (e) { rerr = e; }
  ok(!rerr, '_render() 全链路无异常（新的水面/拖尾/搅动绘制都接上了）',
    rerr ? `${rerr.constructor.name}: ${rerr.message}` : '');
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
