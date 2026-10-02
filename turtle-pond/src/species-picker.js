/**
 * 选品种面板 —— 「添加鱼/龟/草时可选种类」
 *
 * 交互（阶段 6-②）：
 *   · 左键点水中空白        → 在点击处弹出面板（记住这个坐标）
 *   · 点面板里的某个品种    → 就往那个坐标投放 1 个（面板不关，可连点）
 *   · 点画布上的别处        → 面板跟着移动到新位置，接着投放
 *   · 点龟/鱼本身          → 走生物信息卡（CreaturePanel），不弹面板
 *   · Esc / 点「✕」        → 关闭面板
 *   · A 键                 → 打开/关闭面板（打开时用屏幕中心作为投放点）
 *
 * 三个分组：🐟 小鱼 / 🐢 乌龟 / 🌿 植物，品种数据全部来自 species.js 与 plants.js，
 * 新增品种后这里自动多一个按钮，无需改本文件。
 *
 * 缩略图：有 assets/creatures/<id>_side.png 的用图片，没有的用品种主色做色块
 * （与面板里"矢量绘制帧"的 fallback 思路一致）。
 */

import { FISH_SPECIES, TURTLE_SPECIES, HABITAT_LABELS } from './species.js';
import { PLANT_SPECIES } from './plants.js';

// 分组：品种参数里 kind==='bank' 的植物放「岸边草」子分组
const GROUPS = [
  { key: 'fish',    title: '🐟 小鱼', kind: 'fish' },
  { key: 'turtle',  title: '🐢 乌龟', kind: 'turtle' },
  { key: 'plant',   title: '🌿 植物', kind: 'plant' },
];

const CSS = `
#speciesPicker {
  position: fixed; left: 0; top: 0;
  width: 336px; max-height: 74vh;
  overflow-y: auto; overflow-x: hidden;
  background: linear-gradient(160deg, rgba(250,247,240,0.97), rgba(240,235,223,0.97));
  border: 1px solid rgba(150,120,80,0.28);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(10,30,40,0.4);
  font-family: "Microsoft YaHei", ui-sans-serif, sans-serif;
  color: #3a3226;
  padding: 10px 12px 12px;
  z-index: 110;
  opacity: 0; pointer-events: none;
  transform: translateY(-6px) scale(0.98);
  transform-origin: top left;
  transition: opacity .16s ease, transform .16s ease;
}
#speciesPicker.sp-open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
#speciesPicker .sp-head {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 8px; margin-bottom: 8px;
  border-bottom: 1px solid rgba(150,120,80,0.2);
}
#speciesPicker .sp-title { flex: 1; font-size: 14px; font-weight: 700; color: #2e4436; }
#speciesPicker .sp-hint { font-size: 11px; color: #8a7a60; }
#speciesPicker .sp-close {
  width: 22px; height: 22px; border: none; border-radius: 50%; flex: none;
  background: rgba(90,110,90,0.15); color: #5a6a5a; font-size: 13px;
  cursor: pointer; line-height: 1;
}
#speciesPicker .sp-close:hover { background: rgba(90,110,90,0.3); }
#speciesPicker .sp-group { margin-bottom: 10px; }
#speciesPicker .sp-group:last-child { margin-bottom: 2px; }
#speciesPicker .sp-gtitle {
  font-size: 12px; font-weight: 700; color: #4a6a52;
  margin-bottom: 5px; letter-spacing: .5px;
}
#speciesPicker .sp-gtitle .sp-sub { font-weight: 400; color: #9a8a70; font-size: 11px; }
#speciesPicker .sp-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
}
#speciesPicker .sp-item {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 5px 3px 4px; cursor: pointer; border-radius: 9px;
  background: rgba(255,255,255,0.6); border: 1px solid rgba(150,120,80,0.16);
  transition: background .12s ease, border-color .12s ease, transform .12s ease;
  overflow: hidden;
}
#speciesPicker .sp-item:hover {
  background: rgba(210,236,214,0.9); border-color: rgba(90,150,110,0.55); transform: translateY(-1px);
}
#speciesPicker .sp-item:active { transform: translateY(0) scale(0.97); }
#speciesPicker .sp-thumb {
  width: 100%; aspect-ratio: 1/1; border-radius: 7px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
#speciesPicker .sp-thumb img { width: 100%; height: 100%; object-fit: contain; }
#speciesPicker .sp-name {
  font-size: 10.5px; color: #4a4234; text-align: center; line-height: 1.2;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#speciesPicker .sp-badge {
  position: absolute; top: 3px; right: 3px;
  font-size: 9.5px; line-height: 1; color: #56705c;
  background: rgba(255,255,255,0.85); border-radius: 6px; padding: 2px 4px;
}
#speciesPicker .sp-foot {
  margin-top: 6px; font-size: 11px; color: #8a7a60; text-align: center;
}
#speciesPicker .sp-foot b { color: #4a6a52; }
`;

export class SpeciesPicker {
  /** @param {import('./main.js').PondApp} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.x = 0;         // 当前投放点（画布坐标）
    this.y = 0;
    this._imgCache = new Map();
    this._buildDOM();
    this._renderAll();
  }

  // ── DOM ───────────────────────────────────────────────
  _buildDOM() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'speciesPicker';
    el.innerHTML = `
      <div class="sp-head">
        <span class="sp-title">➕ 添加生物 / 植物</span>
        <span class="sp-hint">点一下 = 放 1 个</span>
        <button class="sp-close" title="关闭 (Esc)">✕</button>
      </div>
      <div class="sp-body"></div>
      <div class="sp-foot">点画布别处可移动投放点 · <b>Esc</b> 关闭</div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.body = el.querySelector('.sp-body');

    // 面板内的点击不要穿透到画布（否则会触发投喂/命中检测）
    for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      el.addEventListener(ev, (e) => e.stopPropagation());
    }
    el.querySelector('.sp-close').addEventListener('click', () => this.close());
  }

  // ── 品种数据 ──────────────────────────────────────────
  /** 当前各品种数量（做角标） */
  _counts() {
    const pop = this.app.population();
    const plants = this.app.plantsEnabled ? this.app.plants.population() : {};
    return { fish: pop.fish ?? {}, turtle: pop.turtle ?? {}, plant: plants };
  }

  _countOf(kind, id) {
    const c = this._counts()[kind] ?? {};
    return c[id] ?? 0;
  }

  /** 品种主色（无缩略图时的色块） */
  _colorOf(kind, sp) {
    if (kind === 'fish') return sp.body ?? '#b9c6cc';
    if (kind === 'turtle') return sp.shell ?? '#6b7a52';
    return sp.color ?? '#5f8a4a';
  }

  /** 缩略图：优先水彩图，失败/不存在 → null（改用色块） */
  _thumbUrl(kind, id) {
    if (kind === 'plant') return null;
    const key = `${kind}:${id}`;
    if (this._imgCache.has(key)) return this._imgCache.get(key);
    const ok = this.app._hasCreatureImage?.(kind, id) ?? true;
    const url = ok ? `assets/creatures/${kind}/${id}_side.png` : null;
    this._imgCache.set(key, url);
    return url;
  }

  // ── 渲染 ──────────────────────────────────────────────
  _renderAll() {
    const parts = [];
    for (const g of GROUPS) {
      if (g.key === 'fish') {
        parts.push(this._groupHtml('fish', g.title, Object.values(FISH_SPECIES), ''));
      } else if (g.key === 'turtle') {
        parts.push(this._groupHtml('turtle', g.title, Object.values(TURTLE_SPECIES), 'habitat'));
      } else {
        parts.push(this._plantGroupsHtml());
      }
    }
    this.body.innerHTML = parts.join('');
    this._bindItems();
  }

  _groupHtml(kind, title, list, extra) {
    const items = list.map((sp) => this._itemHtml(kind, sp, extra)).join('');
    return `
      <div class="sp-group">
        <div class="sp-gtitle">${title}<span class="sp-sub"> · ${list.length} 种</span></div>
        <div class="sp-grid">${items}</div>
      </div>`;
  }

  /** 植物按生长层再分三小组 */
  _plantGroupsHtml() {
    const zones = [
      ['bank', '岸边', '#5f7a37'],
      ['surface', '浮叶', '#3c6b30'],
      ['submerged', '沉水', '#2d5c37'],
    ];
    const out = [];
    for (const [kind, label] of zones) {
      const list = Object.values(PLANT_SPECIES).filter((s) => s.kind === kind);
      if (!list.length) continue;
      const items = list.map((sp) => this._itemHtml('plant', sp)).join('');
      out.push(`
        <div class="sp-group">
          <div class="sp-gtitle">🌿 植物 · ${label}<span class="sp-sub"> · ${list.length} 种</span></div>
          <div class="sp-grid">${items}</div>
        </div>`);
    }
    return out.join('');
  }

  _itemHtml(kind, sp, extra = '') {
    const n = this._countOf(kind, sp.id);
    const hab = extra === 'habitat' ? (HABITAT_LABELS[sp.habitat ?? 'semi'] ?? '') : '';
    const url = this._thumbUrl(kind, sp.id);
    const thumb = url
      ? `<img src="${url}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
         <span class="sp-fallback" style="display:none;width:100%;height:100%;background:${this._colorOf(kind, sp)}"></span>`
      : `<span style="width:100%;height:100%;display:block;background:${this._colorOf(kind, sp)}"></span>`;
    return `
      <div class="sp-item" data-kind="${kind}" data-id="${sp.id}" title="${sp.label}${hab ? '［' + hab + '］' : ''}">
        <div class="sp-thumb">${thumb}</div>
        <div class="sp-name">${sp.label}</div>
        ${n > 0 ? `<div class="sp-badge">×${n}</div>` : ''}
      </div>`;
  }

  _bindItems() {
    for (const el of this.body.querySelectorAll('.sp-item')) {
      el.addEventListener('click', () => {
        this.app.spawnAt(el.dataset.kind, el.dataset.id, this.x, this.y);
        this.refresh();          // 数量角标实时更新
      });
    }
  }

  /** 只刷新数量角标（重绘整块 DOM，成本低、代码简单） */
  refresh() {
    if (!this.open) return;
    this._renderAll();
  }

  // ── 开关 / 定位 ───────────────────────────────────────
  /**
   * 在 (x,y) 处弹出面板
   * @param {number} x 画布坐标（投放点）
   * @param {number} y
   */
  showAt(x, y) {
    this.x = x; this.y = y;
    this.open = true;
    this.el.classList.add('sp-open');
    this.refresh();
    this._place();
    return { x, y };
  }

  close() {
    this.open = false;
    this.el.classList.remove('sp-open');
  }

  toggle(x, y) {
    if (this.open) { this.close(); return false; }
    this.showAt(x ?? this.app.world.w / 2, y ?? this.app.world.h / 2);
    return true;
  }

  /** 面板贴着投放点放，超出视口就翻到另一侧 */
  _place() {
    const w = this.app.world.w, h = this.app.world.h;
    const pw = this.el.offsetWidth || 336;
    const ph = this.el.offsetHeight || 320;
    let px = this.x + 16;
    let py = this.y - 12;
    if (px + pw > w - 8) px = this.x - pw - 16;
    px = Math.max(8, Math.min(px, w - pw - 8));
    py = Math.max(8, Math.min(py, h - ph - 8));
    this.el.style.left = `${Math.round(px)}px`;
    this.el.style.top = `${Math.round(py)}px`;
  }
}
