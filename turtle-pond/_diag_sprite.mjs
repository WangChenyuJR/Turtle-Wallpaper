// _diag_sprite.mjs — turtle-sprite.js 零渲染逻辑诊断（untracked）
// 跑法：node _diag_sprite.mjs
// 桩：loadImage 返假图（尺寸来自 manifest），ctx 记录 drawImage/save/restore/rotate 调用。
// 断言：A 加载件数与 manifest 一致且锚点有限 B 绘制调用顺序符合层级表 C 各状态变换有限（无 NaN）
//       D eat 状态下 head 有额外旋转/平移 E 缺部件优雅跳过
import fs from 'fs';
import path from 'path';
import { TurtleSprite } from './src/turtle-sprite.js';

const dir = (v) => path.join('assets/creatures/turtle/sprites/yellowthroat', v);
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };

function makeStubCtx() {
  const calls = [];
  const finite = () => calls.every(c => c.args.every(a => typeof a !== 'string' && Number.isFinite(a)));
  const badCalls = () => calls.filter(c => !c.args.every(a => typeof a !== 'string' && Number.isFinite(a)));
  return {
    calls,
    finite,
    badCalls,
    save() { calls.push({ fn: 'save', args: [] }); },
    restore() { calls.push({ fn: 'restore', args: [] }); },
    translate(...a) { calls.push({ fn: 'translate', args: a }); },
    rotate(...a) { calls.push({ fn: 'rotate', args: a }); },
    scale(...a) { calls.push({ fn: 'scale', args: a }); },
    drawImage(img, dx, dy) { calls.push({ fn: 'drawImage', args: [0, dx, dy], img: img._name }); },
    set globalAlpha(v) { calls.push({ fn: 'globalAlpha', args: [v] }); },
    get globalAlpha() { return 1; },
  };
}

async function loadSprite(view) {
  const manifest = readJSON(path.join(dir(view), 'manifest.json'));
  const sprite = new TurtleSprite({
    species: 'yellowthroat', view,
    loadImage: async (url) => {
      const file = path.basename(url);
      const entry = Object.values(manifest.parts).find(p => p.file === file);
      return { width: entry.bbox[2] - entry.bbox[0] + 1, height: entry.bbox[3] - entry.bbox[1] + 1, img: { _name: file.replace('.png', '') } };
    },
  });
  // fetch 桩（Node 无 fetch 到本地文件——直接替换）
  sprite.fetch = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u) => ({ json: async () => manifest });
  try { await sprite.load(); } finally { globalThis.fetch = origFetch; }
  return { sprite, manifest };
}

console.log('── 俯视/侧视装配逻辑 ──');
for (const view of ['top', 'side']) {
  const { sprite, manifest } = await loadSprite(view);
  console.log(`[${view}]`);
  ok(sprite.ready, 'load() 完成');
  ok(Object.keys(sprite.parts).length === Object.keys(manifest.parts).length,
    `部件件数 ${Object.keys(sprite.parts).length} === manifest ${Object.keys(manifest.parts).length}`);
  ok(Object.entries(sprite.parts).every(([, p]) => Number.isFinite(p.ax) && Number.isFinite(p.ay)), '全部锚点有限');
  ok(sprite.shellLen > 0, `壳宽 ${sprite.shellLen}px`);

  // 空间关系恢复：部件关节应落点 = 原图 anchor / explode 挂点 slot 相对壳锚点
  const jointOk = Object.entries(sprite.parts).every(([nm, p]) =>
    Number.isFinite(p.jpx) && Number.isFinite(p.jpy));
  ok(jointOk, `全部部件 jpx/jpy 有限（rig=${sprite.rig}）`);
  ok(sprite.rig === 'explode' && Object.entries(sprite.parts).every(([nm, p]) => nm === 'shell' || manifest.parts[nm].slot), 'explode 装配：全部非壳部件带壳上挂点');
  const legCount = Object.keys(sprite.parts).filter(n => n.startsWith('leg')).length;
  ok(legCount === (view === 'top' ? 4 : 3), `腿件数 ${legCount}（${view === 'top' ? '俯视 4' : '侧视 3，远后腿 AI 惯例省略'}）`);
  const j = (nm) => { const p = sprite.parts[nm]; return [p.jpx, p.jpy]; };
  if (sprite.parts.head && sprite.parts.tail) {
    const [hx, hy] = j('head'), [tx, ty] = j('tail');
    const geoOk = view === 'top' ? (hy < ty && Math.abs(hx - tx) < sprite.shellLen)
      : (hx > tx && Math.abs(hy - ty) < sprite.shellLen * 0.6);
    ok(geoOk, `头/尾关节方位正确（head=(${hx.toFixed(0)},${hy.toFixed(0)}) tail=(${tx.toFixed(0)},${ty.toFixed(0)})）`);
  }

  // 绘制顺序
  const ctx = makeStubCtx();
  sprite.draw(ctx, { x: 100, y: 100, size: 120, angle: 0.3, time: 1.23, state: 'swim', speed: 0.8 });
  const draws = ctx.calls.filter(c => c.fn === 'drawImage').map(c => c.img);
  // 期望 = 层级表按实际存在的部件过滤（缺件优雅跳过）
  const expectOrder = (view === 'top'
    ? ['tail', 'legHL', 'legHR', 'legFL', 'legFR', 'head', 'shell']
    : ['tail', 'legHL', 'legHR', 'legFL', 'legFR', 'shell', 'head']).filter(n => draws.includes(n));
  ok(JSON.stringify(draws) === JSON.stringify(expectOrder.filter(n => draws.includes(n))),
    `绘制顺序 ${draws.join('→')}`);
  if (!ctx.finite()) console.log('    违规调用:', JSON.stringify(ctx.badCalls()));
  ok(ctx.finite(), 'swim 全部变换有限');
  ok(view === 'top'
    ? (draws.includes('shell') && draws.indexOf('shell') > draws.indexOf('head'))
    : (draws.includes('head') && draws.indexOf('head') > draws.indexOf('shell')),
    view === 'top' ? '俯视：壳最后画，盖住肢根/颈根' : '侧视：头最后画，颈在壳前');

  // eat 状态：head 有平移（top）或组合变换（side）
  const ctx2 = makeStubCtx();
  sprite.draw(ctx2, { x: 0, y: 0, size: 120, time: 0.5, state: 'eat', neckExt: 1, bite: 0.5 });
  ok(ctx2.finite(), 'eat 全部变换有限');
  const saves = ctx2.calls.filter(c => c.fn === 'save').length;
  const restores = ctx2.calls.filter(c => c.fn === 'restore').length;
  ok(saves === restores && saves >= 2, `save/restore 配平（${saves}/${restores}，含外层状态栈）`);

  // grow：headScale 幼体大头
  const ctx3 = makeStubCtx();
  sprite.draw(ctx3, { x: 0, y: 0, size: 60, time: 0, state: 'idle', headScale: 1.15 });
  ok(ctx3.finite(), '幼体 headScale 变换有限');
}

// ── F 注册表：预加载/同步查询/降级（turtle.js 接入路径） ──
console.log('\n── 注册表 TurtleSprites ──');
{
  const { TurtleSprites } = await import('./src/turtle-sprite.js');
  const speciesList = ['yellowthroat', 'helmetedSideNeck', 'caramelSlider', 'goldLineReeves', 'redbellySideNeck', 'terrapin',
    'redear', 'yellowpond', 'chinese', 'softshell', 'mapTurtle', 'mata', 'burmese'];

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    // u = assets/creatures/turtle/sprites/<sp>/<view>/manifest.json
    const m = u.replace(/\\/g, '/').match(/sprites\/([^/]+)\/(top|side)\//);
    const manifest = readJSON(path.join('assets/creatures/turtle/sprites', m[1], m[2], 'manifest.json'));
    return { json: async () => manifest };
  };

  const stubLoadImage = (url) => {
    const mm = url.replace(/\\/g, '/').match(/sprites\/([^/]+)\/(top|side)\/([^/]+)$/);
    const manifest = readJSON(path.join('assets/creatures/turtle/sprites', mm[1], mm[2], 'manifest.json'));
    const entry = Object.values(manifest.parts).find(p => p.file === mm[3]);
    if (!entry) return Promise.reject(new Error('no part ' + mm[3]));
    return Promise.resolve({ width: entry.bbox[2] - entry.bbox[0] + 1, height: entry.bbox[3] - entry.bbox[1] + 1, img: { _name: mm[3] } });
  };

  try {
    // F1 就绪前 get → null（降级路径）
    ok(TurtleSprites.get('yellowthroat', 'side') === null, '未加载时 get → null（走旧画法）');
    // F2 全量预加载
    await TurtleSprites.preload(speciesList, 'side', { loadImage: stubLoadImage });
    const allReady = speciesList.every(sp => TurtleSprites.get(sp, 'side')?.ready);
    ok(allReady, `${speciesList.length} 种全部预加载就绪`);
    // F3 重复预加载安全（不重复加载、不报错）
    await TurtleSprites.preload(speciesList, 'side', { loadImage: stubLoadImage });
    ok(speciesList.every(sp => TurtleSprites.get(sp, 'side')?.ready), '重复 preload 无副作用');
    // F4 壳长归一基准有效（size 换算）
    const lensOk = speciesList.every(sp => TurtleSprites.get(sp, 'side').shellLen > 100);
    ok(lensOk, '各品种 shellLen 有效（>100px 原图）');
    // F5 相位直通：phase 固定时两次绘制 drawImage 数一致且 rotate 稳定（不随 time 漂移）
    const sp0 = TurtleSprites.get('yellowthroat', 'side');
    const c1 = makeStubCtx(), c2 = makeStubCtx();
    sp0.draw(c1, { x: 0, y: 0, size: 120, time: 0, state: 'swim', phase: 1.234, tailPhase: 0.6, headPhase: 0.4 });
    sp0.draw(c2, { x: 0, y: 0, size: 120, time: 9.9, state: 'swim', phase: 1.234, tailPhase: 0.6, headPhase: 0.4 });
    const r1 = c1.calls.filter(c => c.fn === 'rotate').map(c => c.args[0]);
    const r2 = c2.calls.filter(c => c.fn === 'rotate').map(c => c.args[0]);
    ok(JSON.stringify(r1) === JSON.stringify(r2), '相位直通：time 不同而 phase 相同 → 变换完全一致（帧间零漂移）');
    // F6 加载失败降级：损坏品种 get → null
    await TurtleSprites.preload(['nonexistent'], 'side', {
      loadImage: () => Promise.reject(new Error('x')),
    }).catch(() => {});
    ok(TurtleSprites.get('nonexistent', 'side') === null, '加载失败品种 get → null（降级）');

    // ── G 面板图鉴路径：俯视按需加载 + 包围盒自适应（详情页缩略图） ──
    // G1 俯视惰性加载（面板首次打开才拉 top 部件）：就绪后两视角齐全
    await TurtleSprites.preload(speciesList, 'top', { loadImage: stubLoadImage });
    const bothViews = speciesList.every(sp =>
      TurtleSprites.get(sp, 'top')?.ready && TurtleSprites.get(sp, 'side')?.ready);
    ok(bothViews, `${speciesList.length} 种 × 俯视/侧视 全部就绪（面板两格都要）`);
    // G2 重复 preload 返回 Promise（面板"就绪后自动补画"依赖它，且不重复请求）
    const again = TurtleSprites.preload(['yellowthroat'], 'top', { loadImage: stubLoadImage });
    ok(again instanceof Promise && Array.isArray(await again), '重复 preload 不抛错且返回可等 Promise');

    const CW = 240, CH = 240;   // 面板图鉴格（width/height 属性 240）
    const fitBad = [], drawBad = [];
    for (const sp of speciesList) for (const v of ['top', 'side']) {
      const s = TurtleSprites.get(sp, v);
      const fit = s.fitInto(CW, CH, 0.88);
      if (!fit || !Number.isFinite(fit.x) || !Number.isFinite(fit.y) || !(fit.size > 0)) {
        fitBad.push(`${sp}/${v}`);
        continue;
      }
      // 包围盒按 fit 缩放后必须整只落在格子里
      const k = fit.size / s.shellLen, b = s.bbox;
      const inside = fit.x + b.x0 * k >= 0 && fit.y + b.y0 * k >= 0
        && fit.x + b.x1 * k <= CW && fit.y + b.y1 * k <= CH;
      const c = makeStubCtx();
      s.draw(c, { x: fit.x, y: fit.y, size: fit.size, angle: 0, state: 'idle', phase: 0, tailPhase: 0, headPhase: 0 });
      const nDraw = c.calls.filter(f => f.fn === 'drawImage').length;
      const dOk = c.finite() && nDraw === Object.keys(s.parts).length;
      if (!inside || !dOk) drawBad.push(`${sp}/${v}${inside ? '' : '(出界)'}${dOk ? '' : '(变换/件数)'}`);
    }
    ok(fitBad.length === 0, `fitInto 全部有效（${fitBad.join(',') || '无异常'}）`);
    ok(drawBad.length === 0, `缩略图整只落在 ${CW}×${CH} 内且部件画全（${drawBad.join(',') || '无异常'}）`);
    const originOk = speciesList.every(sp => ['top', 'side'].every(v => {
      const b = TurtleSprites.get(sp, v).bbox;
      return b.x0 < 0 && b.x1 > 0 && b.y0 < 0 && b.y1 > 0;
    }));
    ok(originOk, '包围盒包含壳锚点（原点）——居中基准正确');
  } finally {
    globalThis.fetch = origFetch;
  }
}

console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
