/**
 * 纯 Node 集成回归：存档快照 / 复原（SCHEMA 5 · 侧视地形）
 * 运行：node _diag_save.mjs
 *
 * 复用 _diag_render.mjs 的 window/document/canvas 桩：
 *   new PondApp() → 跑若干帧 → snapshot/save → 再 new 一个 PondApp 走 restore()
 *   → 校验实体数量一致、坐标落在合法区域、寿命倍率生效。
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

function makeCtx(canvasRef) {
  const calls = { fill: 0, stroke: 0, fillRect: 0, fillText: 0, grad: 0 };
  const store = {
    canvas: canvasRef, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, filter: 'none',
  };
  const stack = [];
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return (...args) => {
        if (p === 'save') { stack.push({ ...t }); return; }
        if (p === 'restore') { const s = stack.pop(); if (s) Object.assign(t, s); return; }
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
}
function makeCanvas(w = 1280, h = 720) {
  const stub = { width: w, height: h, style: {} };
  stub.getContext = () => makeCtx(stub);
  return stub;
}
const makeEl = () => {
  const cls = new Set();
  const el = {
    tagName: 'DIV', id: '', style: {}, dataset: {}, children: [], _events: {},
    value: '', textContent: '', width: 0, height: 0,
    set innerHTML(_v) {}, get innerHTML() { return ''; },
    addEventListener(t, fn) { this._events[t] = fn; },
    removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    blur() {}, focus() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c) => (cls.has(c) ? cls.delete(c) : cls.add(c)) },
  };
  return el;
};
const pondCanvas = makeCanvas();
globalThis.document = {
  head: makeEl(), body: makeEl(), documentElement: makeEl(), hidden: false, addEventListener() {},
  getElementById: (id) => (id === 'pond' ? pondCanvas : makeEl()),
  createElement: (t) => (t === 'canvas' ? makeCanvas(120, 120) : makeEl()),
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
const { SCHEMA } = await import('./src/save.js');

const DT = 1 / 60;
console.log('\n=== A. 采集 → 写盘 ===');
let a = null, err = null;
try { a = new PondApp(undefined, { resume: false }); } catch (e) { err = e; }
ok(!err, 'new PondApp() 构造成功', err ? `${err.constructor.name}: ${err.message}` : '');
if (!a) { console.log('  无法继续'); process.exit(1); }

// 跑 30 秒，让状态稳定
for (let i = 0; i < 60 * 30; i++) a._update(DT, i * DT);

const snap = a.save.snapshot();
ok(snap && typeof snap === 'object', 'snapshot() 产出对象');
ok(snap.v === SCHEMA, `存档版本 = ${snap.v}（当前 SCHEMA ${SCHEMA}）`);
const nT = snap.turtles.length, nF = snap.fishes.length, nP = snap.plants.length;
console.log(`   实体：龟 ${nT} / 鱼 ${nF} / 水草 ${nP} / 蜗牛 ${snap.snails.length} / 螺虾 ${snap.shrimps.length} / 蛋 ${snap.eggs.length} / 遗骸 ${snap.remains.length}`);
ok(nT > 0 && nF > 0, '存档里有龟和鱼');

ok(a.save.save('test') === true || a.save.lastSaveAt > 0, 'save() 成功写盘');

console.log('\n=== B. 复原到新实例 ===');
let b = null, rerr = null;
try {
  b = new PondApp(undefined, { resume: true });
} catch (e) { rerr = e; }
ok(!rerr, 'new PondApp({resume:true}) 复原无异常', rerr ? `${rerr.constructor.name}: ${rerr.message}` : '');
if (!b) { console.log('  无法继续'); process.exit(1); }

ok(b.turtles.length === nT, `龟数量一致 ${b.turtles.length} === ${nT}`);
ok(b.fishes.length === nF, `鱼数量一致 ${b.fishes.length} === ${nF}`);
ok(b.plants.plants.length === nP, `水草数量一致 ${b.plants.plants.length} === ${nP}`);

console.log('\n=== C. 复原后坐标合法（没落到空气/岸里）===');
{
  let badT = 0, badF = 0, badP = 0;
  for (const t of b.turtles) {
    const inW = b.world.isWater(t.x, t.y), onL = b.world.isLand(t.x, t.y);
    if (!inW && !onL) badT++;
  }
  for (const f of b.fishes) if (!b.world.isWater(f.x, f.y)) badF++;
  for (const p of b.plants.plants) {
    if (p.x < -5 || p.x > b.world.w + 5 || p.y < -50 || p.y > b.world.h + 5) badP++;
  }
  ok(badT === 0, `龟全部落在水或岸上`, `越界 ${badT}`);
  ok(badF === 0, `鱼全部在水里`, `越界 ${badF}`);
  ok(badP === 0, `水草都在画面内`, `越界 ${badP}`);
}

console.log('\n=== D. 复原后跑 60 秒不崩、不越界 ===');
{
  let err2 = null;
  try {
    for (let i = 0; i < 60 * 60; i++) b._update(DT, i * DT);
  } catch (e) { err2 = e; }
  ok(!err2, '复原后推进 60s 无异常', err2 ? `${err2.constructor.name}: ${err2.message}` : '');
  let bad = 0;
  for (const t of b.turtles) {
    if (!b.world.isWater(t.x, t.y) && !b.world.isLand(t.x, t.y)) bad++;
  }
  ok(bad === 0, '跑完 60s 龟仍在水/岸上', `越界 ${bad}`);
}

console.log('\n=== E. 寿命倍率（longevity）===');
{
  const L0 = CONFIG.life.longevity;
  const info0 = b.lifeInfo();
  const days = (pair) => (pair ? pair.map((v) => (v / 86400).toFixed(0) + '天').join('~') : '-');
  console.log(`   基准：龟寿命 ${days(info0.turtleMaxAge)} / 鱼寿命 ${days(info0.fishMaxAge)} / 倍率 ${info0.longevity}`);
  const avg0 = b.turtles.reduce((s, t) => s + t.maxAge, 0) / Math.max(1, b.turtles.length);
  b.setLongevity(3);
  const info3 = b.lifeInfo();
  const avg3 = b.turtles.reduce((s, t) => s + t.maxAge, 0) / Math.max(1, b.turtles.length);
  ok(info3.longevity === 3, `setLongevity(3) 生效（${info0.longevity} → ${info3.longevity}）`);
  ok(Math.abs(avg3 / avg0 - 3) < 0.01, `现役龟剩余寿命按比例×3（${(avg0 / 86400).toFixed(1)} → ${(avg3 / 86400).toFixed(1)} 天）`);
  const S0 = info0.turtleStarveDeath, S3 = info3.turtleStarveDeath;
  ok(Math.abs(S3 / S0 - 3) < 0.01, `饿死时长同步×3（${(S0 / 3600).toFixed(1)}h → ${(S3 / 3600).toFixed(1)}h）`);
  b.setLongevity(L0);
  const info1 = b.lifeInfo();
  ok(info1.longevity === L0, '恢复原倍率');
  ok(Math.abs(info1.turtleStarveDeath - S0) < 1, `饿死时长回到基准（${(info1.turtleStarveDeath / 3600).toFixed(1)}h）`);
}

console.log('\n=== F. 版本不符 → 旧档作废 ===');
{
  const raw = JSON.parse(localStorage.getItem('turtle-pond-state'));
  raw.v = SCHEMA - 1;
  localStorage.setItem('turtle-pond-state', JSON.stringify(raw));
  const c = new PondApp(undefined, { resume: true });
  ok(c.turtles.length > 0, '读到旧版本存档 → 自动丢弃并重新开局（仍有龟）', `龟 ${c.turtles.length}`);
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
