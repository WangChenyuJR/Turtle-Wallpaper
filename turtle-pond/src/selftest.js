/**
 * 自测模块 —— 平时只是一个空转的 import，只有 main.js 检测到 ?selftest=1
 * 时才真正调用 runSelfTest()。（刻意不做成"应用页 + 第二 <script>"，
 * 规避 headless 下该组合的截图/转储卡死怪癖）
 *
 * 覆盖：波动方程引擎物理 + 程序纹理 + 集成链路（addWake/mousemove）
 * 结果：写入 window.__TEST__，并直接画在 canvas 左上角（headless 截图可读）
 */

import { CONFIG } from './config.js';
import { WaterWaveField } from './waterwave.js';

export function runSelfTest(app) {
  const log = [];
  let pass = 0, fail = 0;
  const ok = (c, m) => { c ? pass++ : fail++; log.push((c ? 'PASS ' : 'FAIL ') + m); };

  try {
    const W = app.world;
    const wave = W.wave;
    // 侧视剖面（阶段 6-⑧）：池中央可能是晒台，所以要挑真正的"水列"和"岸列"
    const _ws = W.waterSpans[0];
    const midX = (_ws.x0 + _ws.x1) / 2;
    const midY = (W.surfaceAt(midX) + W.groundYAt(midX)) / 2;
    const bankZone = W.landZones.find((z) => z.kind === 'bank') ?? W.landZones[0];
    const bankX = bankZone ? bankZone.mid : W.w * 0.08;

    // ── 1. 波场引擎物理 ─────────────────────────────
    ok(wave instanceof WaterWaveField, 'world.wave 为波动方程场');

    wave.calm();
    wave.disturb(midX, midY, 1.5, 3);
    const e0 = wave.energy();
    ok(e0 > 0, `扰动产生波能 E=${e0.toFixed(1)}`);

    wave.calm();
    wave.disturb(midX - 40, midY, 1, 3);
    wave.disturb(midX + 40, midY, 1, 3);
    const e2 = wave.energy();
    ok(e2 > e0 * 0.4, `双源干涉 E=${e2.toFixed(1)}>单波x0.4`);

    const eBefore = wave.energy();
    for (let i = 0; i < 240; i++) wave.update(1 / 60, { ambient: false });
    const eAfter = wave.energy();
    ok(eAfter < eBefore * 0.35, `自然衰减 ${eBefore.toFixed(1)}->${eAfter.toFixed(1)}`);

    const s = wave.sample(midX, midY);
    ok(Number.isFinite(s.h) && Number.isFinite(s.gx) && Number.isFinite(s.gy),
      `梯度采样 h=${s.h.toFixed(2)}`);

    // ── 2. 拖拽尾迹链路 ─────────────────────────────
    // 阶段 8-④ 起"水面拖尾"只认水线附近（±wakeBand），深水改成水下搅动，
    // 所以这里必须用**水线附近**的 y，不能用池中的 midY。
    const surfY = W.surfaceAt(midX) + 4;
    wave.calm();
    for (let i = 0; i < 6; i++) {
      W.addWake(midX - 120 + i * 40, surfY, midX - 80 + i * 40, surfY + 6, 700);
    }
    ok(wave.energy() > 1, `尾迹写入波场 E=${wave.energy().toFixed(1)}`);
    ok(W.wakeTrails.length > 0, `拖尾痕迹入列 n=${W.wakeTrails.length}`);

    wave.calm();
    const baseE = wave.energy();
    for (let i = 0; i <= 30; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: midX - 150 + i * 10, clientY: surfY + Math.sin(i * 0.5) * 12,
      }));
    }
    ok(wave.energy() > Math.max(baseE * 2, 0.5), `mousemove 尾迹 E=${wave.energy().toFixed(2)}`);

    // ── 3. 程序化纹理 ───────────────────────────────
    W._ensureTextures();
    ok(!!W.tex && !!W.tex.mud && !!W.tex.sand && !!W.tex.silt && !!W.tex.wetmud, '四张程序纹理生成');

    // ── 3.5 岸上脚印管线（阶段 5-⑭）────────────────
    W.footprints.length = 0;
    const bankY = W.groundYAt(bankX) - 8;
    ok(W.isLand(bankX, bankY), `找到岸地落点 (${bankX.toFixed(0)}, ${bankY.toFixed(0)})`);
    {
      W.addFootprint(bankX, bankY, 0.3, 34, 1);
      W.addFootprint(bankX + 8, bankY + 4, 0.3, 34, -1);
      ok(W.footprints.length === 2, `脚印入列 n=${W.footprints.length}`);
      const life0 = W.footprints[0]?.life ?? 0;
      W._updateFootprints(0.5);
      const life1 = W.footprints[0]?.life ?? 1;
      ok(life1 < life0 && life1 > 0, `脚印淡出推进 ${life0.toFixed(2)}->${life1.toFixed(2)}`);
      // 目视验证：在岸顶铺一条左右交替的脚印带（截图可读）
      const z = bankZone ?? { dx0: 0, dx1: W.w };
      for (let i = 0; i < 10; i++) {
        const fx = z.dx0 + ((z.dx1 - z.dx0) * (i + 0.5)) / 10;
        W.addFootprint(fx, W.groundYAt(fx) - 6, 0.1, 34, i % 2 ? 1 : -1);
      }
    }

    // ── 3.6 岸上爬行 → 脚印 端到端（主循环触发链路）──
    const t0 = app.turtles?.[0];
    if (t0) {
      t0.x = bankX;
      t0.y = W.groundYAt(bankX) - t0.size * 0.25;
      t0.state = 'bask'; t0.stateTime = 0; t0.hunger = 0;
      t0._baskGoal = 999;
      t0.angle = 0.05; t0._footAcc = 0;
      W.footprints.length = 0;
      const simT = performance.now() / 1000;
      for (let i = 0; i < 900; i++) app._update(1 / 60, simT + i / 60);
      ok(W.footprints.length >= 3, `岸上爬行触发脚印 n=${W.footprints.length}`);
      W.footprints.length = 0; // 清掉模拟痕迹，保持画面干净
    }

    // ── 4. 渲染无异常 ───────────────────────────────
    let threw = false;
    try { W.draw(app.ctx, 45.6); } catch (e) { threw = true; log.push('ERR ' + e.message); }
    ok(!threw, '完整渲染无异常');
  } catch (e) {
    fail++;
    log.push('CRASH ' + (e.message ?? e));
  }

  log.unshift(`SELFTEST ${pass}/${pass + fail}`);
  const result = { pass, fail, log };
  window.__TEST__ = result;
  // eslint-disable-next-line no-console
  console.log(log.join('\n'));
  return result;
}

/** 把测试结果直接画上 canvas（headless 截图可读，无 DOM 依赖） */
export function drawTestBadge(ctx, result) {
  if (!result) return;
  ctx.save();
  ctx.globalAlpha = 0.92;
  const lh = 22;
  const w = 620, h = lh * (result.log.length + 1) + 18;
  ctx.fillStyle = '#0b1520';
  ctx.fillRect(10, 10, w, h);
  ctx.strokeStyle = result.fail ? '#e05555' : '#57d977';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w, h);
  ctx.fillStyle = result.fail ? '#ff8d8d' : '#8df0a8';
  ctx.font = 'bold 17px Consolas, monospace';
  ctx.fillText(result.log[0], 24, 34);
  ctx.font = '14px Consolas, monospace';
  ctx.fillStyle = '#cfe3ef';
  result.log.slice(1).forEach((l, i) => ctx.fillText(l, 24, 58 + i * lh));
  ctx.restore();
}
