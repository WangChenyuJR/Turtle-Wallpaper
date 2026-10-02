/**
 * 纯 Node 回归：生物信息面板（点击乌龟弹不出信息）
 *
 * 不开浏览器、不渲染。用 Proxy 假造 canvas 2d 上下文，
 * 直接调 CreaturePanel._setVector，验证：
 *   A. 传选择器字符串不再抛错（修复点）
 *   B. 确实往 canvas 里画了东西（不是静默跳过）
 *   C. 选择器没命中时静默返回，不炸
 *   D. 全品种遍历：19 种龟 + 全部鱼都能画出来
 *
 * 跑法： node _diag_panel.mjs
 */
import { CreaturePanel } from './src/panel.js';
import { TURTLE_SPECIES, FISH_SPECIES } from './src/species.js';

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

// ── 假 canvas 2d 上下文：任何方法都是 no-op，但记录调用次数 ──
function makeCtx() {
  const calls = { fill: 0, stroke: 0, fillRect: 0, clearRect: 0, drawImage: 0, grad: 0 };
  const store = {};
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return (...args) => {
        if (p in calls) calls[p]++;
        if (String(p).startsWith('create')) { calls.grad++; return { addColorStop() {} }; }
        if (p === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return { ctx, calls };
}

function makeCanvas() {
  const { ctx, calls } = makeCtx();
  return { width: 120, height: 120, getContext: () => ctx, _calls: calls };
}

function makePanel(stubs) {
  const p = Object.create(CreaturePanel.prototype);   // 跳过构造函数（不需要 DOM）
  p.el = { querySelector: (sel) => stubs[sel] ?? null };
  p._imgCache = new Map();
  return p;
}

const inst = (species, artSeed = 7) => ({ species, artSeed, x: 100, y: 100, size: 20 });

console.log('\n=== A. 根因复现：旧写法 "字符串.getContext" 必然抛错 ===');
{
  let threw = null;
  try { '.cp-cv-top'.getContext('2d'); } catch (e) { threw = e.constructor.name; }
  ok(threw === 'TypeError', '字符串没有 getContext → 旧代码在 select() 里抛 TypeError（面板打不开）', `得到 ${threw}`);
}

console.log('\n=== B. 修复后：传选择器字符串能正常绘制 ===');
{
  const stubs = { '.cp-cv-top': makeCanvas(), '.cp-cv-side': makeCanvas() };
  const p = makePanel(stubs);
  const t = inst(TURTLE_SPECIES.redear);
  p.app = { turtles: [t], fishes: [] };

  let err = null;
  try { p._setVector('.cp-cv-top', t, 'top'); } catch (e) { err = e; }
  ok(!err, '俯视图传字符串选择器不再抛错', err ? String(err.message) : '');

  const c = stubs['.cp-cv-top']._calls;
  ok(c.clearRect === 1, '画前清空画布（clearRect 一次）', `clearRect=${c.clearRect}`);
  ok(c.fillRect === 1, '铺了宣纸色衬底（fillRect 一次）', `fillRect=${c.fillRect}`);
  ok(c.fill > 5 && c.stroke > 2, '真的画了龟（有填充 + 描边路径）', `fill=${c.fill} stroke=${c.stroke}`);

  // 侧视图
  let err2 = null;
  try { p._setVector('.cp-cv-side', t, 'side'); } catch (e) { err2 = e; }
  ok(!err2, '侧视图同理', err2 ? String(err2.message) : '');
  ok(stubs['.cp-cv-side']._calls.fill > 5, '侧视图也画出来了',
    `fill=${stubs['.cp-cv-side']._calls.fill}`);
}

console.log('\n=== C. 选择器没命中：静默返回，不抛错 ===');
{
  const p = makePanel({});                 // querySelector 全部返回 null
  p.app = { turtles: [inst(TURTLE_SPECIES.redear)], fishes: [] };
  let err = null;
  try { p._setVector('.cp-cv-top', inst(TURTLE_SPECIES.redear), 'top'); } catch (e) { err = e; }
  ok(!err, '画布缺失时安全跳过（不再把整个 select() 拖崩）', err ? String(err.message) : '');
}

console.log('\n=== D. 全品种遍历：每种龟/鱼的三视图都能画 ===');
{
  const stubs = { '.cp-cv-top': makeCanvas(), '.cp-cv-side': makeCanvas() };
  const p = makePanel(stubs);

  const turtleIds = Object.keys(TURTLE_SPECIES);
  const fishIds = Object.keys(FISH_SPECIES);
  let badT = [], badF = [];
  for (const id of turtleIds) {
    const t = inst(TURTLE_SPECIES[id]);
    p.app = { turtles: [t], fishes: [] };
    try { p._setVector('.cp-cv-top', t, 'top'); p._setVector('.cp-cv-side', t, 'side'); }
    catch (e) { badT.push(`${id}:${e.message}`); }
  }
  for (const id of fishIds) {
    const f = inst(FISH_SPECIES[id]);
    p.app = { turtles: [], fishes: [f] };
    try { p._setVector('.cp-cv-top', f, 'top'); p._setVector('.cp-cv-side', f, 'side'); }
    catch (e) { badF.push(`${id}:${e.message}`); }
  }
  ok(badT.length === 0, `全部 ${turtleIds.length} 种龟三视图绘制无异常`, badT.join(' '));
  ok(badF.length === 0, `全部 ${fishIds.length} 种鱼三视图绘制无异常`, badF.join(' '));
}

console.log('\n=== E. 面板静态资料表覆盖检查（只影响文案，不崩） ===');
{
  const { TURTLE_RESEARCH, FISH_RESEARCH } = await import('./src/data/species-research.js');
  const missT = Object.keys(TURTLE_SPECIES).filter((k) => !TURTLE_RESEARCH[k]?.info);
  const missF = Object.keys(FISH_SPECIES).filter((k) => !FISH_RESEARCH[k]?.info);
  console.log(`  龟无资料: ${missT.length ? missT.join(',') : '无'}`);
  console.log(`  鱼无资料: ${missF.length ? missF.join(',') : '无'}`);
}

// ── F. 端到端（假 DOM）：点中乌龟 → select() 跑完 → 面板加上 cp-open ──
console.log('\n=== F. 端到端（假 DOM）：点中乌龟能真正打开面板 ===');
{
  // 极简 DOM 桩：_buildDOM 只写 innerHTML 再 querySelector，不解析 DOM 树，够用
  const makeStubEl = (ext = {}) => {
    const cls = new Set();
    return {
      tagName: 'DIV', id: '', style: {}, dataset: {}, children: [], _events: {},
      value: '', textContent: '',
      set innerHTML(_v) {}, get innerHTML() { return ''; },
      addEventListener(t, fn) { this._events[t] = fn; },
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return null; },
      blur() { this._blurred = true; },
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c),
        contains: (c) => cls.has(c), _all: cls,
      },
      ...ext,
    };
  };
  const canvasStub = () => { const c = makeCanvas(); return makeStubEl({ width: 120, height: 120, getContext: c.getContext, _calls: c._calls }); };

  const refImg = makeStubEl({ complete: false, naturalWidth: 0, onload: null, onerror: null });
  const refFig = makeStubEl({ querySelector: () => refImg });
  const nameInput = makeStubEl();
  const cvTop = canvasStub(), cvSide = canvasStub();
  // 面板内部选择的桩表：构造时 _buildDOM 会按这些选择器取节点
  const stubMap = {
    '.cp-name': nameInput,
    '.cp-close': makeStubEl(),
    '.cp-tags': makeStubEl(),
    '.cp-status': makeStubEl(),
    '.cp-info': makeStubEl(),
    '.cp-views figure.cp-ref': refFig,
    '.cp-cv-top': cvTop,
    '.cp-cv-side': cvSide,
  };

  globalThis.document = {
    head: makeStubEl(), body: makeStubEl(),
    createElement: (t) => {
      if (t === 'canvas') return canvasStub();
      return makeStubEl({ querySelector: (sel) => stubMap[sel] ?? null });
    },
  };
  globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
  };
  globalThis.Image = class { constructor() { this.complete = false; this.naturalWidth = 0; } };

  const t = inst(TURTLE_SPECIES.redear);
  t.state = 'swim';
  const app = {
    turtles: [t], fishes: [],
    world: { bankY: 300, isWater: () => true },     // 让 _renderStatus 走"水域"分支
    save: { touch() {} },
  };

  const panel = new CreaturePanel(app);
  const panelEl = panel.el;                          // 真实构造函数建出来的那个面板节点

  let err = null;
  // 在乌龟身上单击 → 走 main.js 里完全相同的入口
  try {
    const consumed = panel.handleCanvasClick(t.x, t.y);
    ok(consumed === true, 'handleCanvasClick 返回 true（本次点击已被消费，不会误投喂）');
  } catch (e) { err = e; }
  ok(!err, 'handleCanvasClick → select() 全程无异常', err ? `${err.constructor.name}: ${err.message}` : '');
  ok(panel.selected === t, '选中了个体');
  ok(panelEl.classList.contains('cp-open'), '面板加上了 cp-open（= 真的弹出来了）');
  ok(cvTop._calls.fill > 5 && cvSide._calls.fill > 5, '面板里两格三视图都画了东西',
    `top.fill=${cvTop._calls.fill} side.fill=${cvSide._calls.fill}`);
  ok(nameInput.value === '巴西红耳龟', '名字框填了默认名', nameInput.value);
  ok(t._uid > 0, '分配了持久化 uid', `uid=${t._uid}`);

  // 点空白 → 面板应关闭
  panel.handleCanvasClick(9999, 9999);
  ok(!panelEl.classList.contains('cp-open'), '点空白后面板关闭（cp-open 移除）');
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
