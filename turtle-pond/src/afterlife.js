/**
 * 生命档案 —— 阶段 5-⑥
 *
 * 死亡的生物不直接消失：
 *   池塘里翻肚漂浮渐隐（dying 动画，在 fish/turtle 内部实现）
 *   → 移除瞬间把"一生"快照写入这里
 *   → 档案不在池塘中渲染，但随时可查（O 键面板 / pond.archive()）
 *
 * 条目字段：
 *   name      自动中文名（重名自动追加序号）
 *   species   品种 label
 *   kind      'fish' | 'turtle'
 *   gen       世代（初始种群 = 1，繁殖后代 +1）
 *   birth/death/age  水塘内秒
 *   cause     'old' 老死 | 'starve' 饿死
 *   stats     { eaten 吃食数, offspring 繁殖数, size 成年体型 }
 */

import { CONFIG } from './config.js';

// 中文名池（双字叠字/雅称，符合水塘气质）
const NAME_POOL = [
  '墨墨', '团团', '小锦', '爬爬', '绿豆', '汤圆', '布丁', '石头', '阿黄', '泡泡',
  '贝壳', '糯米', '果冻', '小花', '大壮', '悠悠', '皮皮', '呆呆', '闪闪', '安安',
  '慢慢', '静静', '跳跳', '胖胖', '青青', '波波', '酥酥', '糖糖', '圆圆', '尾巴',
  '荷叶', '薯条', '乌乌', '铠铠', '游游', '墨鲤', '锦儿', '草草', '甲甲', '缘缘',
];

const CAUSE_LABELS = { old: '寿终正寝', starve: '饥饿' };
const KIND_LABELS = { fish: '鱼', turtle: '龟' };

export class LifeArchive {
  constructor() {
    this.entries = [];
    this._nameUse = {};        // 名字使用计数
    this._load();
  }

  /** 收录一位逝者；creature 需带 profile() 快照方法 */
  add(creature, now) {
    const p = creature.profile();          // 由 fish/turtle 提供生前统计
    const entry = {
      name: this._uniqueName(),
      kind: creature.kind,
      species: creature.species.label,
      gen: creature.generation ?? 1,
      birth: +(creature.birth ?? 0).toFixed(1),
      death: +now.toFixed(1),
      age: +(now - (creature.birth ?? 0)).toFixed(1),
      cause: creature.deathCause ?? 'old',
      stats: p,
      recordedAt: Date.now(),
    };
    this.entries.unshift(entry);
    if (this.entries.length > (CONFIG.life?.archiveCap ?? 200)) {
      this.entries.length = CONFIG.life?.archiveCap ?? 200;
    }
    this._save();
    return entry;
  }

  /** 重名自动编号：墨墨 → 墨墨·2 */
  _uniqueName() {
    const base = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
    const n = (this._nameUse[base] ?? 0) + 1;
    this._nameUse[base] = n;
    return n === 1 ? base : `${base}·${n}`;
  }

  list() { return this.entries; }
  count() { return this.entries.length; }

  /** 按名字查详情（模糊包含） */
  detail(name) {
    return this.entries.filter((e) => e.name.includes(name));
  }

  /** 生态小结：各死因计数 */
  stats() {
    const byCause = {};
    for (const e of this.entries) byCause[e.cause] = (byCause[e.cause] || 0) + 1;
    const byKind = {};
    for (const e of this.entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    return { total: this.entries.length, byCause, byKind };
  }

  // ── 持久化 ───────────────────────────────────────────
  _save() {
    if (!(CONFIG.life?.persist ?? true)) return;
    try {
      localStorage.setItem('turtle-pond-archive', JSON.stringify(this.entries.slice(0, 50)));
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  _load() {
    if (!(CONFIG.life?.persist ?? true)) return;
    try {
      const raw = localStorage.getItem('turtle-pond-archive');
      if (raw) {
        this.entries = JSON.parse(raw) ?? [];
        // 恢复名字计数
        for (const e of this.entries) {
          const base = e.name.split('·')[0];
          this._nameUse[base] = Math.max(this._nameUse[base] ?? 0, parseInt(e.name.split('·')[1] ?? '1', 10));
        }
      }
    } catch (e) { this.entries = []; }
  }
}

export { CAUSE_LABELS, KIND_LABELS, NAME_POOL };
