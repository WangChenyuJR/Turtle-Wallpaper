/**
 * 存档系统 —— 阶段 6-①
 *
 * 目标：关掉壁纸再打开，水塘还是"你离开时的那口水塘"。
 *   龟的年龄 / 饥饿 / 状态机 / 后代数
 *   鱼的成长 / 饥饿 / 觅食统计
 *   龟蛋的孵化进度（重启不重置）
 *   每株植物的位置 / 相位 / 是否开花
 *   螺蛳与小虾的位置 / 体型 / 壳色
 *   遗骸的分解进度、水面浮萍、未吃完的饲料
 *   昼夜时刻、天气状态、水塘运行总时长（app.time）
 *
 * 存储策略（三层，互不干扰）：
 *   ① localStorage['turtle-pond-state']  —— 自动存档主体（节流 30s + 关键时机）
 *   ② localStorage['turtle-pond-state.bak'] —— 上一份存档备份
 *   ③ localStorage['turtle-pond-state.trash'] —— 「重新开始」时清掉的档（可一键恢复）
 *
 * 为什么不用数据库？
 *   壁纸是单机、单用户、离线运行的渲染进程，数据量只有几十 KB，
 *   引入数据库 = 多一个进程 + 多一个失败点 + 打包体积翻倍，收益为零。
 *   JSON 存档的可靠性来自"三份轮转 + 校验 + 导出成文件"，不是来自数据库。
 *
 * 版本号：SCHEMA 变更时旧档自动丢弃（避免读到一半崩），
 *         需要兼容旧档时在 _migrate() 里按 from 版本做字段补齐。
 */

export const SAVE_KEY = 'turtle-pond-state';
const BAK_KEY = 'turtle-pond-state.bak';
const TRASH_KEY = 'turtle-pond-state.trash';

/** 存档格式版本：结构不兼容时 +1，旧档自动作废 */
export const SCHEMA = 4;

const AUTOSAVE_INTERVAL = 30;      // 秒，节流自动存档

/** 数字兜底：undefined/NaN → 默认值 */
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
/** 保留 3 位小数，减小存档体积 */
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

export class SaveManager {
  /**
   * @param {import('./main.js').PondApp} app
   */
  constructor(app) {
    this.app = app;
    this._acc = 0;              // 自动存档计时器
    this._dirty = false;        // 有变更待写盘
    this._pendingReset = false; // 用户要求清档，等页面离开时再执行（避免刷新时存档又写回来）
    this.lastSaveAt = 0;        // 上次成功写盘的时间戳
    this.lastSaveReason = '';
    this.error = null;          // 上次失败原因（隐私模式 / 配额满）

    this._bindLeaveHooks();
  }

  // ══════════════════════════════════════════════════════
  //  一、采集：把内存里的世界压成一份普通对象
  // ══════════════════════════════════════════════════════
  /** @returns {object} 可 JSON.stringify 的存档对象 */
  snapshot() {
    const a = this.app;
    return {
      v: SCHEMA,
      savedAt: Date.now(),
      // 水塘运行总时长（决定档案里的"享年"、出生时刻对齐）
      clock: r3(a.time),
      world: { w: a.world.w, h: a.world.h },

      daynight: {
        time: r3(a.daynight.time),
        speed: num(a.daynight.speed, 1),
        dayLength: num(a.daynight.dayLength, 480),
      },
      weather: {
        state: a.weather.state,
        timer: r3(a.weather.timer),
        intensity: r3(a.weather.intensity),
      },

      fishes: a.fishes.map((f) => serializeFish(f)),
      turtles: a.turtles.map((t) => serializeTurtle(t)),
      eggs: a.eggs.map((e) => serializeEgg(e)),
      plants: a.plants.plants.map((p) => serializePlant(p)),
      snails: a.scavengers.snails.map((s) => serializeSnail(s)),
      shrimps: a.scavengers.shrimps.map((s) => serializeShrimp(s)),
      remains: a.remains.map((r) => serializeRemains(r)),
      duckweed: a.duckweed.items.map((d) => serializeDuckweed(d)),
      food: a.food.items.map((f) => serializeFood(f)),

      // 界面偏好（顺手记住，打开时不用重新关一遍面板）
      ui: {
        plantsEnabled: !!a.plantsEnabled,
        showHelp: !!a.showHelp,
        showStats: !!a.showStats,
      },
      // 生命档案一并带走：导出 JSON 时是"完整的一口水塘"
      archive: a.archive.list(),
    };
  }

  // ══════════════════════════════════════════════════════
  //  二、写盘
  // ══════════════════════════════════════════════════════
  /**
   * 立即写盘
   * @param {string} reason 记录用（auto / hidden / unload / manual / clear）
   * @returns {boolean} 是否成功
   */
  save(reason = 'manual') {
    if (!this._enabled()) return false;
    if (this._pendingReset) return false;   // 待清档，别再写回来
    try {
      const payload = JSON.stringify(this.snapshot());
      // 旧档先挪到备份位（只有一份，够用）
      const prev = localStorage.getItem(SAVE_KEY);
      if (prev) localStorage.setItem(BAK_KEY, prev);
      localStorage.setItem(SAVE_KEY, payload);
      this.lastSaveAt = Date.now();
      this.lastSaveReason = reason;
      this._dirty = false;
      this.error = null;
      return true;
    } catch (e) {
      // QuotaExceededError / 隐私模式：静默降级，不打断渲染
      this.error = e?.name || String(e);
      return false;
    }
  }

  /** 标记"世界变了"，等节流到期再写（投喂/加鱼/改名后可调用） */
  touch() { this._dirty = true; }

  /** 主循环每帧调用：每 AUTOSAVE_INTERVAL 秒落一次盘 */
  tick(dt) {
    this._acc += dt;
    if (this._acc >= AUTOSAVE_INTERVAL) {
      this._acc = 0;
      this.save('auto');
    }
  }

  // ══════════════════════════════════════════════════════
  //  三、读取 / 恢复
  // ══════════════════════════════════════════════════════
  /** 是否存在可读的存档 */
  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  /** 读原始存档对象（不恢复），失败返回 null */
  read(key = SAVE_KEY) {
    if (!this._enabled()) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      if ((data.v ?? 0) !== SCHEMA) return null;      // 版本不符 → 丢弃
      return this._migrate(data);
    } catch { return null; }
  }

  /** 版本迁移钩子（当前版本一致，留空；将来在此补齐旧字段） */
  _migrate(data) {
    data.fishes ??= []; data.turtles ??= []; data.eggs ??= [];
    data.plants ??= []; data.snails ??= []; data.shrimps ??= [];
    data.remains ??= []; data.duckweed ??= []; data.food ??= [];
    return data;
  }

  /**
   * 把存档恢复进 app。调用点：PondApp._initScene 之前。
   * @returns {boolean} 是否成功恢复了
   */
  restore() {
    const data = this.read();
    if (!data) return false;
    try {
      restoreWorld(this.app, data);
      return true;
    } catch (e) {
      console.warn('[存档] 恢复失败，将从新水塘开始', e);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════
  //  四、"重新开始"（清档 + 可恢复）
  // ══════════════════════════════════════════════════════
  /**
   * 清档：不立刻删，先挪到 trash 位（可恢复），并标记 pendingReset，
   * 这样即使用户随后刷新页面，_initScene 也不会再读回旧档。
   * @param {boolean} wipeArchive 是否连生命档案一起清（默认保留，纪念册不该被误删）
   */
  reset(wipeArchive = false) {
    try {
      const cur = localStorage.getItem(SAVE_KEY);
      if (cur) localStorage.setItem(TRASH_KEY, cur);
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BAK_KEY);
      if (wipeArchive) localStorage.removeItem('turtle-pond-archive');
    } catch { /* ignore */ }
    this._pendingReset = true;
    this.lastSaveReason = 'reset';
    return this.hasTrash();
  }

  /** trash 位是否有可恢复的档 */
  hasTrash() {
    try { return !!localStorage.getItem(TRASH_KEY); } catch { return false; }
  }

  /** 「重新开始」点错了？一键把刚清掉的档放回来（下次打开生效） */
  undoReset() {
    try {
      const t = localStorage.getItem(TRASH_KEY);
      if (!t) return false;
      localStorage.setItem(SAVE_KEY, t);
      localStorage.removeItem(TRASH_KEY);
    } catch { return false; }
    this._pendingReset = false;
    return true;
  }

  /** 彻底扔掉 trash 位（释放空间） */
  dropTrash() {
    try { localStorage.removeItem(TRASH_KEY); } catch { /* ignore */ }
  }

  // ══════════════════════════════════════════════════════
  //  五、导出 / 导入 JSON 文件
  // ══════════════════════════════════════════════════════
  /** 导出成 .json 下载（换机器 / 备份 / 手动编辑用） */
  exportFile() {
    const text = JSON.stringify(this.snapshot(), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `turtle-pond-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 交给浏览器读完再释放
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return a.download;
  }

  /**
   * 导入 JSON 字符串 → 写入存档位 → 下次打开生效
   * （不热替换内存中的世界，避免半途状态错乱）
   * @param {string} text
   * @returns {{ok:boolean, reason?:string, summary?:object}}
   */
  importText(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, reason: 'JSON 解析失败' }; }
    if (!data || typeof data !== 'object') return { ok: false, reason: '不是合法的存档对象' };
    if ((data.v ?? 0) !== SCHEMA) return { ok: false, reason: `存档版本不符（档 ${data.v} / 需 ${SCHEMA}）` };
    try {
      const prev = localStorage.getItem(SAVE_KEY);
      if (prev) localStorage.setItem(BAK_KEY, prev);
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      localStorage.removeItem(TRASH_KEY);
    } catch (e) {
      return { ok: false, reason: `写入失败：${e?.name || e}` };
    }
    this._pendingReset = false;
    return { ok: true, summary: this.summarize(data) };
  }

  /** 从 <input type=file> 读文件后导入 */
  async importFile(file) {
    const text = await file.text();
    return this.importText(text);
  }

  /** 存档概要（导入预览 / 控制台查看用） */
  summarize(data = this.read()) {
    if (!data) return null;
    const mins = Math.floor((data.clock ?? 0) / 60);
    return {
      savedAt: data.savedAt ? new Date(data.savedAt).toLocaleString() : '未知',
      playTime: `${Math.floor(mins / 60)}小时${mins % 60}分`,
      dayT: data.daynight ? +(((data.daynight.time ?? 0) % (data.daynight.dayLength || 480)) / (data.daynight.dayLength || 480)).toFixed(2) : null,
      weather: data.weather?.state ?? null,
      fish: data.fishes?.length ?? 0,
      turtle: data.turtles?.length ?? 0,
      egg: data.eggs?.length ?? 0,
      plant: data.plants?.length ?? 0,
      snails: data.snails?.length ?? 0,
      shrimps: data.shrimps?.length ?? 0,
      remains: data.remains?.length ?? 0,
      archive: data.archive?.length ?? 0,
      bytes: JSON.stringify(data).length,
    };
  }

  // ══════════════════════════════════════════════════════
  //  六、内部
  // ══════════════════════════════════════════════════════
  _enabled() {
    return this.app?.settings?.persist !== false && this.app?.settings?.saveEnabled !== false;
  }

  /** 关闭页面 / 切到后台时兜底存一次 */
  _bindLeaveHooks() {
    const onLeave = () => this.save('unload');
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save('hidden');
    });
  }
}

// ══════════════════════════════════════════════════════════
//  序列化：单个实体 → 纯数据
//  原则：只存"构造函数里随机生成、之后会被改"的字段。
//        能从 CONFIG / species 查回来的（颜色、行为参数）一律不存。
// ══════════════════════════════════════════════════════════

function serializeFish(f) {
  return {
    sp: f.species.id,
    uid: f._uid ?? null,          // 与 panel.js 的名字表对齐
    x: r3(f.x), y: r3(f.y), vx: r3(f.vx), vy: r3(f.vy),
    a: r3(f.angle), tp: r3(f.tailPhase),
    adultSize: r3(f.adultSize),
    age: r3(f.age), size: r3(f.size),
    hunger: r3(f.hunger),
    reproCooldown: r3(f.reproCooldown),
    maxAge: r3(f.maxAge),
    gen: f.generation ?? 1,
    birth: r3(f.birth ?? 0),
    eaten: f.eaten ?? 0,
    offspring: f.offspring ?? 0,
  };
}

function serializeTurtle(t) {
  return {
    sp: t.species.id,
    uid: t._uid ?? null,
    x: r3(t.x), y: r3(t.y), vx: r3(t.vx), vy: r3(t.vy), a: r3(t.angle),
    adultSize: r3(t.adultSize),
    age: r3(t.age), size: r3(t.size),
    hunger: r3(t.hunger),
    reproCooldown: r3(t.reproCooldown),
    maxAge: r3(t.maxAge),
    gen: t.generation ?? 1,
    birth: r3(t.birth ?? 0),
    eaten: t.eaten ?? 0,
    offspring: t.offspring ?? 0,
    // 状态机
    state: t.state,
    stateTime: r3(t.stateTime),
    decisionTimer: r3(t.decisionTimer),
    baskGoal: t._baskGoal == null ? null : r3(t._baskGoal),
    baskTarget: t.baskTarget ? { x: r3(t.baskTarget.x), y: r3(t.baskTarget.y) } : null,
    flipperPhase: r3(t.flipperPhase),
    headBob: r3(t.headBob),
    shellColor: t.shellColor,
  };
}

function serializeEgg(e) {
  return {
    sp: e.species.id,
    x: r3(e.x), y: r3(e.y),
    incubation: r3(e.incubation),
    age: r3(e.age),
    eggs: e.eggs.map((g) => ({ dx: r3(g.dx), dy: r3(g.dy), r: r3(g.r), phase: r3(g.phase) })),
  };
}

function serializePlant(p) {
  const o = {
    sp: p.sp.id,
    x: r3(p.x), y: r3(p.y),
    phase: r3(p.phase), swayPhase: r3(p.swayPhase),
    hueJitter: r3(p.hueJitter), scale: r3(p.scale),
    seed: p.seed ?? 0,               // 外形随机种子：读档后每株形状不变
  };
  // 三类植物各自特有的尺寸字段
  if (p.height != null) o.height = r3(p.height);
  if (p.size != null) o.size = r3(p.size);
  if (p.kind === 'surface') {
    o.hasFlower = !!p.hasFlower;
    o.rot = r3(p.rot);
    o.ox = r3(p.ox); o.oy = r3(p.oy);
    o.pushVx = r3(p.pushVx); o.pushVy = r3(p.pushVy);
  }
  return o;
}

function serializeSnail(s) {
  return {
    zone: s.zone, x: r3(s.x), y: r3(s.y),
    size: r3(s.size), shellHue: r3(s.shellHue),
    dir: s.dir, speed: r3(s.speed), phase: r3(s.phase),
    restTimer: r3(s.restTimer), nibbleTimer: r3(s._nibbleTimer),
  };
}

function serializeShrimp(s) {
  return {
    x: r3(s.x), y: r3(s.y), vx: r3(s.vx), vy: r3(s.vy), a: r3(s.angle),
    size: r3(s.size), burstTimer: r3(s.burstTimer), phase: r3(s.phase),
  };
}

function serializeRemains(r) {
  return {
    kind: r.kind, x: r3(r.x), y: r3(r.y), size: r3(r.size),
    decay: r3(r.decay), phase: r3(r.phase), eatenBits: r.eatenBits ?? 0,
  };
}

function serializeDuckweed(d) {
  return {
    x: r3(d.x), y: r3(d.y), r: r3(d.r),
    vx: r3(d.vx), vy: r3(d.vy),
    phase: r3(d.phase), rot: r3(d.rot), rotSpeed: r3(d.rotSpeed),
    leafCount: d.leafCount,
  };
}

function serializeFood(f) {
  return {
    x: r3(f.x), y: r3(f.y), r: r3(f.r), vy: r3(f.vy), maxVy: r3(f.maxVy),
    life: r3(f.life), phase: r3(f.phase), splash: r3(f.splash),
  };
}

// ══════════════════════════════════════════════════════════
//  恢复：把纯数据写回新建的实体
//  做法：先用正常构造函数建一个（拿到 species / behavior / shellColor 等派生量），
//        再用存档覆盖随机字段。这样即使将来构造函数加了新随机项，
//        只会有"没存到的字段取随机值"，不会崩。
// ══════════════════════════════════════════════════════════

function applyNum(target, key, src, srcKey = key) {
  if (Number.isFinite(src[srcKey])) target[key] = src[srcKey];
}

function restoreWorld(app, data) {
  // ── 时间轴先恢复：后面生物的 birth 都基于它 ──────────
  app.time = num(data.clock, 0);

  // ── 昼夜 ────────────────────────────────────────────
  if (data.daynight) {
    app.daynight.time = num(data.daynight.time, app.daynight.time);
    if (Number.isFinite(data.daynight.speed)) app.daynight.speed = data.daynight.speed;
    if (Number.isFinite(data.daynight.dayLength)) app.daynight.dayLength = data.daynight.dayLength;
  }

  // ── 天气 ────────────────────────────────────────────
  if (data.weather && ['sunny', 'rain', 'afterRain'].includes(data.weather.state)) {
    app.weather.state = data.weather.state;
    app.weather.timer = num(data.weather.timer, app.weather.timer);
    app.weather.intensity = num(data.weather.intensity, app.weather.intensity);
    app.weather.drops.length = 0;      // 雨滴是纯视觉，重新下雨即可
    app.weather._foodTimer = 0;
  }

  // ── 鱼 ──────────────────────────────────────────────
  app.fishes.length = 0;
  for (const d of data.fishes) {
    const sp = app._fishSpeciesById(d.sp);
    if (!sp) continue;                                    // 品种被删掉了 → 跳过
    const f = new app.FishCtor(app.world, sp, { generation: d.gen, birth: d.birth });
    restoreFish(f, d);
    app.fishes.push(f);
  }

  // ── 龟 ──────────────────────────────────────────────
  app.turtles.length = 0;
  for (const d of data.turtles) {
    const sp = app._turtleSpeciesById(d.sp);
    if (!sp) continue;
    const t = new app.TurtleCtor(app.world, app.turtles.length, sp, { generation: d.gen, birth: d.birth });
    restoreTurtle(t, d);
    app.turtles.push(t);
  }
  app._hookTurtleRepro();                                 // 读档后重新挂产蛋回调

  // ── 龟蛋 ────────────────────────────────────────────
  app.eggs.length = 0;
  for (const d of data.eggs) {
    const sp = app._turtleSpeciesById(d.sp);
    if (!sp) continue;
    const e = new app.EggCtor(app.world, d.x, d.y, sp);
    e.x = num(d.x, e.x); e.y = num(d.y, e.y);
    e.incubation = num(d.incubation, e.incubation);
    e.age = num(d.age, 0);
    if (Array.isArray(d.eggs) && d.eggs.length) {
      e.eggs = d.eggs.map((g) => ({ dx: num(g.dx), dy: num(g.dy), r: num(g.r, 4), phase: num(g.phase) }));
    }
    app.eggs.push(e);
  }

  // ── 植物（按存档逐株重建，而不是按数量随机）──────────
  app.plants.plants.length = 0;
  for (const d of data.plants) {
    const sp = app._plantSpeciesById(d.sp);
    if (!sp) continue;
    const zone = sp.kind === 'bank' ? 'bank' : (sp.kind === 'surface' ? 'surface' : 'submerged');
    const p = new app.PlantCtor(app.world, sp, zone);
    restorePlant(p, d);
    app.plants.plants.push(p);
  }

  // ── 分解者 ──────────────────────────────────────────
  app.scavengers.snails.length = 0;
  app.scavengers.shrimps.length = 0;
  for (const d of data.snails) {
    const s = new app.SnailCtor(app.world, d.zone === 'bank' ? 'bank' : 'bottom');
    s.x = num(d.x, s.x); s.y = num(d.y, s.y);
    applyNum(s, 'size', d); applyNum(s, 'shellHue', d);
    if (Number.isFinite(d.dir)) s.dir = d.dir >= 0 ? 1 : -1;
    applyNum(s, 'speed', d); applyNum(s, 'phase', d);
    applyNum(s, 'restTimer', d);
    if (Number.isFinite(d.nibbleTimer)) s._nibbleTimer = d.nibbleTimer;
    app.scavengers.snails.push(s);
  }
  for (const d of data.shrimps) {
    const s = new app.ShrimpCtor(app.world);
    s.x = num(d.x, s.x); s.y = num(d.y, s.y);
    applyNum(s, 'vx', d); applyNum(s, 'vy', d);
    if (Number.isFinite(d.a)) s.angle = d.a;
    applyNum(s, 'size', d); applyNum(s, 'burstTimer', d); applyNum(s, 'phase', d);
    app.scavengers.shrimps.push(s);
  }

  // ── 遗骸 ────────────────────────────────────────────
  app.remains.length = 0;
  for (const d of data.remains) {
    const onLand = app.world.isWater(d.x, d.y) ? null : d.y;
    const r = new app.RemainsCtor(app.world, d.kind, num(d.size, 8), d.x, d.y, onLand);
    r.decay = num(d.decay, 1);
    r.phase = num(d.phase, 0);
    r.eatenBits = d.eatenBits ?? 0;
    if (r.decay > 0) app.remains.push(r);
  }

  // ── 浮萍 ────────────────────────────────────────────
  app.duckweed.items.length = 0;
  for (const d of data.duckweed) {
    const k = new app.DuckweedCtor(app.world);
    k.x = num(d.x, k.x); k.y = num(d.y, k.y); k.r = num(d.r, k.r);
    k.vx = num(d.vx, 0); k.vy = num(d.vy, 0);
    k.phase = num(d.phase, 0); k.rot = num(d.rot, 0); k.rotSpeed = num(d.rotSpeed, 0);
    if (Number.isFinite(d.leafCount)) k.leafCount = d.leafCount;
    app.duckweed.items.push(k);
  }

  // ── 未吃完的饲料 ────────────────────────────────────
  app.food.items.length = 0;
  for (const d of data.food) {
    const f = new app.FoodCtor(d.x, d.y);
    f.x = num(d.x, f.x); f.y = num(d.y, f.y); f.r = num(d.r, f.r);
    f.vy = num(d.vy, 0); f.maxVy = num(d.maxVy, f.maxVy);
    f.life = num(d.life, 1); f.phase = num(d.phase, 0); f.splash = 0;
    if (f.life > 0) app.food.items.push(f);
  }

  // ── 界面偏好 ────────────────────────────────────────
  if (data.ui) {
    if (typeof data.ui.plantsEnabled === 'boolean') app.plantsEnabled = data.ui.plantsEnabled;
    if (typeof data.ui.showHelp === 'boolean') app.showHelp = data.ui.showHelp;
    if (typeof data.ui.showStats === 'boolean') app.showStats = data.ui.showStats;
  }
}

function restoreFish(f, d) {
  f.x = num(d.x, f.x); f.y = num(d.y, f.y);
  f.vx = num(d.vx, f.vx); f.vy = num(d.vy, f.vy);
  f.angle = num(d.a, f.angle);
  f.tailPhase = num(d.tp, f.tailPhase);
  f.adultSize = num(d.adultSize, f.adultSize);
  f.age = num(d.age, f.age);
  f.size = num(d.size, f.size);
  f.hunger = num(d.hunger, f.hunger);
  f.reproCooldown = num(d.reproCooldown, f.reproCooldown);
  f.maxAge = num(d.maxAge, f.maxAge);
  f.generation = d.gen ?? 1;
  f.birth = num(d.birth, 0);
  f.eaten = d.eaten ?? 0;
  f.offspring = d.offspring ?? 0;
  if (d.uid) f._uid = d.uid;              // 名字表按 uid 对齐
  f._applySpeed();                        // 体型变了要重算速度
}

function restoreTurtle(t, d) {
  t.x = num(d.x, t.x); t.y = num(d.y, t.y);
  t.vx = num(d.vx, t.vx); t.vy = num(d.vy, t.vy);
  t.angle = num(d.a, t.angle);
  t.adultSize = num(d.adultSize, t.adultSize);
  t.age = num(d.age, t.age);
  t.size = num(d.size, t.size);
  t.hunger = num(d.hunger, t.hunger);
  t.reproCooldown = num(d.reproCooldown, t.reproCooldown);
  t.maxAge = num(d.maxAge, t.maxAge);
  t.generation = d.gen ?? 1;
  t.birth = num(d.birth, 0);
  t.eaten = d.eaten ?? 0;
  t.offspring = d.offspring ?? 0;
  // 状态机（存档里的 state 必须合法，否则退回 swim）
  const ok = ['swim', 'seek_food', 'climb_out', 'bask', 'return'];
  t.state = ok.includes(d.state) ? d.state : 'swim';
  t.stateTime = num(d.stateTime, 0);
  t.decisionTimer = num(d.decisionTimer, t.decisionTimer);
  t._baskGoal = d.baskGoal == null ? null : num(d.baskGoal);
  t.baskTarget = d.baskTarget ? { x: num(d.baskTarget.x), y: num(d.baskTarget.y) } : null;
  t.flipperPhase = num(d.flipperPhase, t.flipperPhase);
  t.headBob = num(d.headBob, t.headBob);
  if (typeof d.shellColor === 'string') t.shellColor = d.shellColor;
  if (d.uid) t._uid = d.uid;
}

function restorePlant(p, d) {
  p.x = num(d.x, p.x); p.y = num(d.y, p.y);
  p.phase = num(d.phase, p.phase);
  p.swayPhase = num(d.swayPhase, p.swayPhase);
  p.hueJitter = num(d.hueJitter, p.hueJitter);
  p.scale = num(d.scale, p.scale);
  if (Number.isFinite(d.height)) p.height = d.height;
  if (Number.isFinite(d.size)) p.size = d.size;
  if (p.kind === 'surface') {
    p.hasFlower = !!d.hasFlower;
    p.rot = num(d.rot, p.rot);
    p.ox = num(d.ox, 0); p.oy = num(d.oy, 0);
    p.pushVx = num(d.pushVx, 0); p.pushVy = num(d.pushVy, 0);
  }
  // 外形种子：老档没有这个字段就保持构造时的随机外形（向后兼容）
  if (Number.isFinite(d.seed) && d.seed > 0 && d.seed !== p.seed) p.reseed(d.seed);
}
