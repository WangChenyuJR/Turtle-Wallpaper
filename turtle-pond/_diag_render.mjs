/**
 * 纯 Node 集成回归：整条渲染链路 + 小灯接入（阶段 6-⑥）
 *
 * 目的是"不开浏览器也验证 _render() 不崩、灯真的画出来了、HUD 里有真实钟点"。
 * 做法：搭最小 window/document/canvas 桩 → new PondApp() → 直接调 app._render(t)。
 *
 * 跑法： node _diag_render.mjs
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

// ── 假 canvas 2d 上下文（记录 fillRect / fillText，供断言）──
// 注意：save/restore **必须真的存/取状态**。否则全局状态（尤其
// globalCompositeOperation='lighter'）会在桩里永久"泄漏"，
// 把之后所有 fillRect 都标成叠加——断言就全乱了（这里踩过一次）。
function makeCtx(canvasRef) {
  const calls = { fill: 0, stroke: 0, fillRect: 0, fillText: 0, drawImage: 0, grad: 0, clip: 0 };
  const rects = [], texts = [];
  const store = {
    canvas: canvasRef, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, filter: 'none',
  };
  const stack = [];
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return (...args) => {
        if (p === 'save') { stack.push({ ...t }); return undefined; }
        if (p === 'restore') { const s = stack.pop(); if (s) Object.assign(t, s); return undefined; }
        if (p in calls) calls[p]++;
        if (p === 'fillRect') rects.push({ fill: t.fillStyle, op: t.globalCompositeOperation, x: args[0], y: args[1], w: args[2], h: args[3] });
        if (p === 'fillText') texts.push(String(args[0]));
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
  return { ctx, calls, rects, texts };
}

function makeCanvas(w = 1280, h = 720) {
  const stub = { width: w, height: h, style: {} };
  const c = makeCtx(stub);
  stub.getContext = () => c.ctx;
  stub._calls = c.calls;
  stub._rects = c.rects;
  stub._texts = c.texts;
  return stub;
}

// ── 最小 DOM 桩 ────────────────────────────────────────────
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
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c) => (cls.has(c) ? cls.delete(c) : cls.add(c)) },
    ...ext,
  };
};

const pondCanvas = makeCanvas();
const panelCanvasTop = makeCanvas(120, 120);
const panelCanvasSide = makeCanvas(120, 120);
const stubMap = {
  '.cp-name': makeEl(), '.cp-close': makeEl(), '.cp-tags': makeEl(), '.cp-status': makeEl(),
  '.cp-info': makeEl(), '.cp-views figure.cp-ref': makeEl({ querySelector: () => null }),
  '.cp-cv-top': panelCanvasTop, '.cp-cv-side': panelCanvasSide,
};

globalThis.document = {
  head: makeEl(), body: makeEl(), documentElement: makeEl(),
  hidden: false, addEventListener() {},
  getElementById: (id) => (id === 'pond' ? pondCanvas : makeEl()),
  createElement: (t) => {
    if (t === 'canvas') return makeCanvas();
    // 选择器没在桩表里 → 给个空 el（不要返回 null：面板/选品种面板会直接 addEventListener）
    return makeEl({ querySelector: (sel) => stubMap[sel] ?? makeEl() });
  },
};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720, addEventListener() {}, removeEventListener() {},
  location: { search: '' }, dispatchEvent() {},
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
const { PondApp } = await import('./src/main.js');

console.log('\n=== A. 整条渲染链路（夜晚 / 灯灭）===');
let app = null, err = null;
try {
  app = new PondApp(undefined, { resume: false });
} catch (e) { err = e; }
ok(!err, 'new PondApp() 在桩环境里能构造成功', err ? `${err.constructor.name}: ${err.message}` : '');
if (err) console.log(err.stack);

if (app) {
  app.daynight.setDayT(0.92);          // 22:05 夜晚
  app.lamp.set(false); app.lamp.glow = 0;

  const night = pondCanvas;
  let rerr = null;
  try { app._render(3.2); } catch (e) { rerr = e; }
  // 注意：_render 用的是 app.ctx（构造时绑定的主画布桩），统计就记在 pondCanvas 上
  ok(!rerr, '_render() 夜晚全链路无异常', rerr ? `${rerr.constructor.name}: ${rerr.message}` : '');

  const c0 = pondCanvas._calls;
  console.log(`   主画布调用：fill ${c0.fill} / fillRect ${c0.fillRect} / fillText ${c0.fillText} / 渐变 ${c0.grad}`);
  ok(c0.fill > 50 && c0.fillRect > 5, '夜色下场景确实画了东西');
  ok(c0.fillText > 0, 'HUD 有文字');

  const hud = pondCanvas._texts.find((s) => s.includes('FPS')) ?? '';
  ok(/\b2[0-9]:\d\d\b|\b\d\d:\d\d\b/.test(hud), `状态栏含钟点：${hud.slice(0, 60)}…`);
  ok(hud.includes('夜晚'), '状态栏含时段名（夜晚）');
  ok(!hud.includes('灯亮'), '灯灭时状态栏不显示灯');

  // ── B. 开灯：多出一整层暖光 ──
  const beforeRect = pondCanvas._rects.length;
  const beforeGrad = pondCanvas._calls.grad;
  app.lamp.set(true); app.lamp.glow = 1;
  let rerr2 = null;
  try { app._render(3.3); } catch (e) { rerr2 = e; }
  ok(!rerr2, '开灯后 _render() 无异常', rerr2 ? String(rerr2.message) : '');

  const nLamp = app.lamp.count;
  const newRects = pondCanvas._rects.slice(beforeRect);
  // 场景里只有小灯的倒影会用 lighter + fillRect（fx/world 的加光都是 stroke/fill path）
  const litRects = newRects.filter((r) => r.op === 'lighter');
  ok(nLamp >= 2, `默认布 ${nLamp} 盏小灯（多盏高斯柔光）`);
  ok(pondCanvas._calls.grad >= beforeGrad + nLamp * 4,
    `开灯多出 ${pondCanvas._calls.grad - beforeGrad} 个渐变（每盏 4 层柔光）`);
  ok(litRects.length >= nLamp * 10, `水面倒影光柱画出来了（${litRects.length} 条倒影横条）`);
  // 倒影必须落在水面里（各自灯的岸线以下）
  const banks = app.lamp.list().map((l) => app.world.bankLineAt(l.x));
  const minBank = Math.min(...banks);
  const wrong = litRects.filter((r) => r.y < minBank - 2);
  ok(wrong.length === 0, `倒影没有画到岸上（全在水面内，最高岸线 ${minBank.toFixed(0)}）`);
  // 不是只画了第一盏：每盏灯附近都得有自己的倒影列
  const covered = app.lamp.list().filter((l) =>
    litRects.some((r) => Math.abs(r.x + r.w / 2 - l.x) < 220)).length;
  ok(covered === nLamp, `${nLamp} 盏灯每盏都投了自己的倒影（命中 ${covered} 盏）`);

  const hud2 = pondCanvas._texts.filter((s) => s.includes('FPS')).pop() ?? '';
  ok(hud2.includes('灯亮'), `开灯后状态栏标记：${hud2.slice(-24)}`);

  // ── C. 点灯开关的交互入口（点哪盏亮哪盏）──
  const g = app.lamp.geom();
  const idx = app.lamp.hitIndex(g.x, g.bulbY);
  ok(idx === 0, `点第 1 盏灯罩 → 命中索引 ${idx}（main.js 会消费掉这次点击，不投喂）`);
  app.toggleLampAt(idx);
  ok(app.lamp.fixtures[0].on === false && app.lamp.litCount === nLamp - 1,
    `toggleLampAt(0) 只关掉第 1 盏（还剩 ${app.lamp.litCount}/${nLamp} 亮着）`);
  ok(app.lamp.isOn === true, '还有别的盏亮着 → 整组仍算"开着"');
  app.toggleLamp(true);
  ok(app.lamp.litCount === nLamp, 'toggleLamp(true) → 整组一起亮');
  app.toggleLamp(false);
  ok(app.lamp.litCount === 0 && app.lamp.isOn === false, 'toggleLamp(false) → 整组一起灭');
  ok(typeof app.ambientLight === 'number', `ambientLight 可用：${app.ambientLight.toFixed(2)}`);

  // ── D. 时间源切换 + 彩色回归：白天/黄昏/黎明都能渲染 ──
  let bad = [];
  for (const [label, t] of [['黎明', 0.22], ['白天', 0.5], ['黄昏', 0.78], ['深夜', 0.95]]) {
    app.daynight.setDayT(t);
    try { app._render(4.0); } catch (e) { bad.push(`${label}:${e.message}`); }
  }
  ok(bad.length === 0, '四个时段渲染均无异常', bad.join(' '));

  // ── E. 窗口尺寸变化（resize 后灯的几何自适应）──
  const lampX0 = app.lamp.x, lampH0 = app.lamp.h;
  window.innerWidth = 800; window.innerHeight = 500;
  app.world.resize(800, 500);
  ok(app.lamp.x < lampX0 && app.lamp.h <= lampH0 + 0.01, `缩窗口后灯跟着走：x ${lampX0.toFixed(0)}→${app.lamp.x.toFixed(0)}，h ${lampH0.toFixed(0)}→${app.lamp.h.toFixed(0)}`);
  ok(app.lamp.h >= 30, `灯最小高度受限（${app.lamp.h.toFixed(0)}px），不会缩成一条线`);
  const out = app.lamp.list().filter((l) => l.x < 20 || l.x > app.world.w - 20);
  ok(out.length === 0, `窄窗口下 ${nLamp} 盏灯都还在画面里（${app.lamp.list().map((l) => l.x).join('/')}）`);
  app.lamp.set(true); app.lamp.glow = 1;     // 窄窗口下开灯跑一遍（柔光最吃几何）
  let narrowErr = null;
  for (const t of [0.22, 0.5, 0.78, 0.95]) {
    app.daynight.setDayT(t);
    try { app._render(5.0); } catch (e) { narrowErr = narrowErr ?? `${t}:${e.message}`; }
  }
  ok(!narrowErr, '窄窗口 + 开灯 + 四时段重渲染无异常', narrowErr ?? '');
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
