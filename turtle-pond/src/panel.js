/**
 * 生物信息面板 —— 点击鱼/龟查看：改名 / 三视图 / 详细资料 / 实时状态
 *
 * 交互：
 *   · 左键点中鱼/龟   → 打开面板 + 高亮呼吸圈跟随
 *   · 左键点空白      → 关闭面板（并正常投喂）
 *   · Esc / × 按钮    → 关闭面板
 *   · 面板内名字可编辑，Enter 或失焦保存（localStorage 持久化）
 *
 * 图片约定：assets/creatures/{turtle|fish}/<id>_<top|side>.png
 *   只有部分品种有水彩图；无图品种自动退化为「矢量绘制帧」。
 *
 * 资料来源：./data/species-research.js 的 TURTLE_RESEARCH / FISH_RESEARCH
 */

import { TURTLE_RESEARCH, FISH_RESEARCH } from './data/species-research.js';

const STORE_NAMES = 'pond.names';   // { [uid]: name }
const STORE_SEQ = 'pond.uidSeq';    // 递增计数器

const TURTLE_STATE_CN = {
  swim: '游动中',
  seek_food: '追食中',
  climb_out: '爬上岸',
  bask: '晒背中',
  return: '返回水中',
};

const CSS = `
#creaturePanel {
  position: fixed; right: 18px; top: 50%; transform: translateY(-50%);
  width: 312px; max-height: 86vh; overflow-y: auto;
  background: linear-gradient(160deg, rgba(250,247,240,0.96), rgba(243,238,227,0.96));
  border: 1px solid rgba(150,120,80,0.25);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(10,30,40,0.35);
  font-family: "Microsoft YaHei", ui-sans-serif, sans-serif;
  color: #3a3226;
  padding: 14px 16px 16px;
  z-index: 100;
  opacity: 0; pointer-events: none; transform: translateY(-50%) translateX(24px);
  transition: opacity .22s ease, transform .22s ease;
}
#creaturePanel.cp-open { opacity: 1; pointer-events: auto; transform: translateY(-50%) translateX(0); }
#creaturePanel .cp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
#creaturePanel .cp-name {
  flex: 1; min-width: 0; font-size: 17px; font-weight: 700; color: #2e4436;
  background: transparent; border: none; border-bottom: 1.5px dashed rgba(90,120,80,0.45);
  padding: 2px 4px; outline: none; font-family: inherit;
}
#creaturePanel .cp-name:focus { border-bottom-color: #4a7c59; background: rgba(255,255,255,0.6); }
#creaturePanel .cp-close {
  width: 24px; height: 24px; border: none; border-radius: 50%;
  background: rgba(90,110,90,0.15); color: #5a6a5a; font-size: 14px; cursor: pointer; line-height: 1;
}
#creaturePanel .cp-close:hover { background: rgba(90,110,90,0.3); }
#creaturePanel .cp-tags { font-size: 12px; color: #7a6a50; margin-bottom: 10px; }
#creaturePanel .cp-tags b { color: #4a6a52; }
#creaturePanel .cp-views { display: flex; gap: 10px; margin-bottom: 10px; }
#creaturePanel .cp-views figure {
  margin: 0; flex: 1; text-align: center;
  background: rgba(255,255,255,0.55); border: 1px solid rgba(150,120,80,0.18); border-radius: 10px;
  padding: 6px 4px 4px;
}
#creaturePanel .cp-views img, #creaturePanel .cp-views canvas {
  width: 100%; aspect-ratio: 1/1; object-fit: contain; border-radius: 6px; display: block;
}
#creaturePanel .cp-views figcaption { font-size: 11px; color: #8a7a60; margin-top: 3px; }
#creaturePanel .cp-status {
  font-size: 12.5px; color: #2e5a44; background: rgba(120,180,140,0.14);
  border-radius: 8px; padding: 6px 10px; margin-bottom: 10px; line-height: 1.5;
}
#creaturePanel .cp-info { font-size: 12.5px; line-height: 1.75; color: #4a4234; }
#creaturePanel .cp-info .cp-sci { font-style: italic; color: #6a5a44; }
#creaturePanel .cp-info .cp-row b { color: #2e4436; }
#creaturePanel .cp-feats { margin: 6px 0 0; padding-left: 16px; }
#creaturePanel .cp-feats li { margin-bottom: 1px; }
#creaturePanel .cp-none { color: #a09480; font-size: 12px; }
`;

export class CreaturePanel {
  /** @param {import('./main.js').PondApp} app */
  constructor(app) {
    this.app = app;
    this.selected = null;          // 当前选中的生物实例
    this._acc = 0;                 // 动态刷新节流
    this._imgCache = new Map();    // "kind:id:view" -> HTMLImageElement

    this._loadStore();
    this._buildDOM();
  }

  // ── 存储 ──────────────────────────────────────────────
  _loadStore() {
    try {
      this._names = JSON.parse(localStorage.getItem(STORE_NAMES) || '{}');
      this._seq = parseInt(localStorage.getItem(STORE_SEQ) || '0', 10) || 0;
    } catch { this._names = {}; this._seq = 0; }
  }
  _saveNames() {
    try { localStorage.setItem(STORE_NAMES, JSON.stringify(this._names)); } catch { /* ignore */ }
  }
  _saveSeq() {
    try { localStorage.setItem(STORE_SEQ, String(this._seq)); } catch { /* ignore */ }
  }

  /** 给实例分配稳定 uid（首次访问时） */
  _ensureUid(inst) {
    if (!inst._uid) {
      this._seq += 1;
      inst._uid = this._seq;
      this._saveSeq();
    }
    return inst._uid;
  }

  // ── DOM ───────────────────────────────────────────────
  _buildDOM() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'creaturePanel';
    el.innerHTML = `
      <div class="cp-head">
        <input class="cp-name" spellcheck="false" title="点击编辑名字"/>
        <button class="cp-close" title="关闭 (Esc)">✕</button>
      </div>
      <div class="cp-tags"></div>
      <div class="cp-views">
        <figure><img class="cp-img-top" alt=""/><canvas class="cp-cv-top" width="120" height="120"></canvas><figcaption>俯视 Top</figcaption></figure>
        <figure><img class="cp-img-side" alt=""/><canvas class="cp-cv-side" width="120" height="120"></canvas><figcaption>侧视 Side</figcaption></figure>
      </div>
      <div class="cp-status"></div>
      <div class="cp-info"></div>
    `;
    document.body.appendChild(el);
    this.el = el;

    // 面板内的点击不要穿透到画布（不触发投喂/命中）
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());

    this.nameInput = el.querySelector('.cp-name');
    this.nameInput.addEventListener('change', () => this._saveName());
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.nameInput.blur(); }
      e.stopPropagation();   // 防止触发全局快捷键（如空格暂停）
    });

    el.querySelector('.cp-close').addEventListener('click', () => this.close());
  }

  _saveName() {
    if (!this.selected) return;
    const uid = this._ensureUid(this.selected);
    const name = this.nameInput.value.trim();
    if (name && name !== this._defaultName()) this._names[uid] = name;
    else delete this._names[uid];
    this._saveNames();
  }

  // ── 图片 ──────────────────────────────────────────────
  _imageFor(kind, id, view) {
    const key = `${kind}:${id}:${view}`;
    if (this._imgCache.has(key)) return this._imgCache.get(key);
    const img = new Image();
    img.src = `assets/creatures/${kind}/${id}_${view}.png`;
    img.onerror = () => { img._failed = true; };
    this._imgCache.set(key, img);
    return img;
  }

  /** 矢量绘制帧（无图品种 fallback）：把当前实例画到小画布上 */
  _drawVectorThumb(canvas, inst, angleOverride = 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const oldAngle = inst.angle;
    inst.angle = angleOverride;               // 临时统一朝向，画完恢复
    const est = inst.size * 3.6;              // 体长+四肢余量的估算包围盒
    const scale = (canvas.width * 0.82) / est;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-inst.x, -inst.y);
    inst.draw(ctx);
    ctx.restore();
    inst.angle = oldAngle;
  }

  _setView(figureImgSel, figureCvSel, kind, id, view, inst) {
    const img = this.el.querySelector(figureImgSel);
    const cv = this.el.querySelector(figureCvSel);
    const cached = this._imageFor(kind, id, view);
    const useImg = () => { img.style.display = 'block'; cv.style.display = 'none'; img.src = cached.src; };
    const useCv = () => { img.style.display = 'none'; cv.style.display = 'block'; this._drawVectorThumb(cv, inst); };

    if (cached._failed) { useCv(); return; }
    if (cached.complete && cached.naturalWidth > 0) { useImg(); return; }
    // 尚未加载完：先画矢量帧，加载成功后切图
    useCv();
    cached.onload = () => { if (this.selected === inst) useImg(); };
  }

  // ── 打开 / 关闭 ───────────────────────────────────────
  select(inst) {
    this.selected = inst;
    const kind = this.app.turtles.includes(inst) ? 'turtle' : 'fish';
    const sp = inst.species;
    this._kind = kind;

    this._ensureUid(inst);
    this.nameInput.value = this._names[inst._uid] || this._defaultName();

    // 标签行
    const HAB = { aquatic: '水龟', semi: '半水龟', terrestrial: '陆龟', marsh: '沼泽龟' };
    const stage = inst.isAdult ? '成年' : '幼体';
    const tags = this.el.querySelector('.cp-tags');
    if (kind === 'turtle') {
      const hab = HAB[sp.habitat ?? 'semi'] ?? '半水龟';
      tags.innerHTML = `<b>${sp.label}</b>［${hab}］ · ${stage}`;
    } else {
      tags.innerHTML = `<b>${sp.label}</b> · ${stage}`;
    }

    // 三视图（俯视 + 侧视；无图自动矢量帧）
    this._setView('.cp-img-top', '.cp-cv-top', kind, sp.id, 'top', inst);
    this._setView('.cp-img-side', '.cp-cv-side', kind, sp.id, 'side', inst);

    // 静态资料
    this._renderInfo(kind, sp);

    // 动态状态（立即刷一次）
    this._renderStatus();

    this.el.classList.add('cp-open');
  }

  close() {
    this.selected = null;
    this.el.classList.remove('cp-open');
  }

  _defaultName() {
    if (!this.selected) return '';
    return this.selected.species.label;
  }

  // ── 资料渲染 ──────────────────────────────────────────
  _renderInfo(kind, sp) {
    const R = (kind === 'turtle' ? TURTLE_RESEARCH : FISH_RESEARCH)[sp.id];
    const box = this.el.querySelector('.cp-info');
    if (!R || !R.info) {
      box.innerHTML = `<span class="cp-none">暂无图鉴资料（可补充到 species-research.js）</span>`;
      return;
    }
    const i = R.info;
    const fmtRange = (r, unit) => Array.isArray(r) ? `${r[0]}–${r[1]}${unit}` : '—';
    const feats = (i.features ?? []).map((f) => `<li>${f}</li>`).join('');
    box.innerHTML = `
      <div class="cp-row cp-sci">${i.sciName ?? ''}</div>
      ${kind === 'turtle' && i.habitatCn ? `<div class="cp-row"><b>栖息类型</b>：${i.habitatCn}</div>` : ''}
      ${kind === 'fish' && i.waterLayer ? `<div class="cp-row"><b>活动水层</b>：${i.waterLayer}</div>` : ''}
      <div class="cp-row"><b>成体尺寸</b>：${fmtRange(i.sizeCm, ' cm')}</div>
      <div class="cp-row"><b>适温</b>：${fmtRange(i.tempC, '℃')}${i.pH ? ` ｜ <b>pH</b>：${fmtRange(i.pH, '')}` : ''}</div>
      <div class="cp-row"><b>食性</b>：${i.diet ?? '—'}</div>
      <div class="cp-row"><b>寿命</b>：${i.lifespan ?? '—'} ｜ <b>饲养难度</b>：${i.difficulty ?? '—'}</div>
      <div class="cp-row"><b>原产地</b>：${i.origin ?? '—'}</div>
      ${feats ? `<ul class="cp-feats">${feats}</ul>` : ''}
    `;
  }

  _renderStatus() {
    const inst = this.selected;
    if (!inst) return;
    const box = this.el.querySelector('.cp-status');
    const parts = [];
    if (this._kind === 'turtle') {
      parts.push(`当前状态：<b>${TURTLE_STATE_CN[inst.state] ?? inst.state}</b>`);
      parts.push(inst.y < this.app.world.bankY ? '水域' : '岸上');
    } else {
      const hunger = Math.round((inst.hunger ?? 0) * 100);
      parts.push(`当前状态：<b>${hunger > 60 ? '觅食中' : '游动中'}</b>`);
      parts.push(`饱食 ${100 - hunger}%`);
    }
    parts.push(inst.isAdult ? '成长 100%' : '成长中');
    box.innerHTML = parts.join('  ·  ');
  }

  /** 主循环调用：节流刷新动态状态 */
  tick(dt) {
    if (!this.selected) return;
    this._acc += dt;
    if (this._acc >= 0.3) {
      this._acc = 0;
      this._renderStatus();
    }
  }

  // ── 命中检测 ──────────────────────────────────────────
  /** 点中生物返回实例并打开面板；返回 null 表示点空白 */
  hitTest(x, y) {
    const { fishes, turtles } = this.app;
    let best = null, bestD = Infinity;
    // 龟优先（个体大、数量少）
    for (const inst of [...turtles, ...fishes]) {
      const dx = inst.x - x, dy = inst.y - y;
      const d2 = dx * dx + dy * dy;
      const r = Math.max(14, inst.size * 1.1);
      if (d2 < r * r && d2 < bestD) { best = inst; bestD = d2; }
    }
    return best;
  }

  /** window mousedown 时调用：true = 已消费（点中生物/面板），false = 点空白 */
  handleCanvasClick(x, y) {
    const hit = this.hitTest(x, y);
    if (hit) { this.select(hit); return true; }
    if (this.selected) this.close();
    return false;
  }

  // ── 高亮跟随 ──────────────────────────────────────────
  drawHighlight(ctx, time) {
    const inst = this.selected;
    if (!inst) return;
    // 实例已被移除（removeFish / setPopulation）→ 关闭
    if (!this.app.fishes.includes(inst) && !this.app.turtles.includes(inst)) {
      this.close();
      return;
    }
    const r = inst.size * 1.35 + Math.sin(time * 3.2) * 2.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(140,225,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(inst.x, inst.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // 外圈淡环
    ctx.strokeStyle = 'rgba(140,225,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(inst.x, inst.y, r + 5 + Math.sin(time * 2.1) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
