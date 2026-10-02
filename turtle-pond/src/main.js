/**
 * 乌龟水塘动态壁纸 —— 主入口
 *
 * 交互：
 *   · 移动鼠标      → 鱼群避让，乌龟好奇跟随
 *   · 左键点击      → 在点击处投喂（关键交互）
 *   · 右键          → 打开/关闭帮助
 *   · 空格          → 暂停/继续
 *   · F             → 全屏
 *   · + / -         → 加/减鱼
 *   · T             → 加乌龟
 */

import { CONFIG } from './config.js';
import { World } from './world.js';
import { Fish } from './fish.js';
import { Turtle, Egg } from './turtle.js';
import { DuckweedField, Duckweed } from './duckweed.js';
import { FoodManager, Food } from './food.js';
import { PlantField, Plant, PLANT_SPECIES, DEFAULT_PLANTS } from './plants.js';
import { DayNight } from './daynight.js';
import { Weather } from './weather.js';
import { LifeArchive, KIND_LABELS, CAUSE_LABELS } from './afterlife.js';
import { Remains, ScavengerField, Snail, Shrimp } from './scavengers.js';
import { FXLayer } from './fx.js';
import { AudioEngine } from './audio.js';
import { CreaturePanel } from './panel.js';
import { SpeciesPicker } from './species-picker.js';
import { SaveManager, SAVE_KEY, SCHEMA as SAVE_SCHEMA } from './save.js';
import { runSelfTest, drawTestBadge } from './selftest.js';
import {
  DEFAULT_POPULATION, FISH_SPECIES, TURTLE_SPECIES,
  pickFishSpecies, pickTurtleSpecies, listSpecies, HABITAT_LABELS,
} from './species.js';
import { dist2, clamp } from './utils.js';

class PondApp {
  /**
   * @param {object} population 初始种群配置（读档失败时的回退）
   * @param {object} [opts] { resume: boolean } resume=false 强制开新水塘（忽略存档）
   */
  constructor(population = DEFAULT_POPULATION, opts = {}) {
    this.canvas = document.getElementById('pond');
    this.ctx = this.canvas.getContext('2d');
    this.world = new World(window.innerWidth, window.innerHeight);

    // ── 存档系统需要的构造器引用（save.js 不直接 import 各实体，避免循环依赖）──
    this.FishCtor = Fish; this.TurtleCtor = Turtle; this.EggCtor = Egg;
    this.PlantCtor = Plant; this.RemainsCtor = Remains;
    this.SnailCtor = Snail; this.ShrimpCtor = Shrimp;
    this.DuckweedCtor = Duckweed; this.FoodCtor = Food;
    this.settings = { persist: CONFIG.life?.persist ?? true, saveEnabled: true };
    this.save = new SaveManager(this);
    this.resumed = false;      // 本次是否为"读档继续"

    this.fishes = [];
    this.turtles = [];
    this.eggs = [];               // 龟蛋（阶段 5-③）
    this.duckweed = new DuckweedField(this.world, CONFIG.duckweed.count);
    this.food = new FoodManager(this.world);
    // 植物（阶段 5-②）：岸边/浮叶/沉水三类
    this.plants = new PlantField(this.world, DEFAULT_PLANTS);
    this.plantsEnabled = CONFIG.plants?.enabled ?? true;
    // 昼夜循环（阶段 5-④）
    this.daynight = new DayNight(CONFIG.daynight?.startT ?? 0.15);
    // 天气（阶段 5-⑤）
    this.weather = new Weather();
    this.weather.onRainFoodDrop = (x) => this.food.feed(x, this.world.bankLineAt(x) + 24, 1);
    // 生命档案 + 遗骸 + 分解者（阶段 5-⑥⑦）
    this.archive = new LifeArchive();
    this.remains = [];
    this.scavengers = new ScavengerField(this.world);
    this.showArchive = false;
    // 视觉打磨层（阶段 5-⑧）：阴影 / 景深雾 / 焦散 / 水面高光
    this.fx = new FXLayer(this.world);
    // 音效（阶段 5-⑨）：默认静音，首次手势解锁
    this.audio = new AudioEngine();
    // 生物信息面板（点击鱼/龟查看详情/改名/三视图）
    this.panel = new CreaturePanel(this);
    // 选品种面板（阶段 6-②：添加鱼/龟/草时可选种类）
    this.picker = new SpeciesPicker(this);
    this.time = 0;

    this.cursor = { x: 0, y: 0, active: false };
    // 光标尾迹状态（阶段 5-⑩）：记录上一位置/时间，按移动速度生成水面尾迹
    this._cursorTrail = { lx: 0, ly: 0, lt: 0, accum: 0 };
    this.paused = false;
    this.showHelp = true;
    this.showStats = true;
    this.showLegend = false;
    this._toastText = '';
    this._toastTimer = 0;
    this.lastTime = performance.now();
    this.visible = true;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._curFps = 60;

    this._initScene(population, opts.resume !== false);
    this._bindEvents();

    requestAnimationFrame((t) => this._loop(t));
  }

  /**
   * 初始化场景（阶段 3：数据驱动）
   * @param {object} population 种群配置
   * @param {boolean} tryResume 是否尝试从存档恢复（默认 true）
   */
  _initScene(population = DEFAULT_POPULATION, tryResume = true) {
    // ── 优先读档：把上次离开时的世界整份还原 ────────────
    if (tryResume && this.save.restore()) {
      this.resumed = true;
      const s = this.save.summarize();
      console.log('[🐢 乌龟水塘] 已读取存档：',
        `${s.fish} 鱼 / ${s.turtle} 龟 / ${s.plant} 植物 / 累计 ${s.playTime}`,
        `（存档于 ${s.savedAt}）`);
      // 让"命名"系统的 uid 计数器避开存档里已用的 uid
      this.panel?.syncSeqFromInstances();
      this.save.touch();
      return;
    }
    // ── 没有存档（或版本不符）→ 按配置新建 ─────────────
    this._spawnPopulation(population);
  }

  /** 按种群配置从零生成生物 */
  _spawnPopulation(population = DEFAULT_POPULATION) {
    // 鱼
    for (const [spId, n] of Object.entries(population.fish ?? {})) {
      const sp = FISH_SPECIES[spId];
      if (!sp) continue;
      for (let i = 0; i < n; i++) this.fishes.push(new Fish(this.world, sp));
    }
    // 乌龟
    for (const [spId, n] of Object.entries(population.turtle ?? {})) {
      const sp = TURTLE_SPECIES[spId];
      if (!sp) continue;
      for (let i = 0; i < n; i++) {
        this.turtles.push(new Turtle(this.world, this.turtles.length, sp));
      }
    }
    // 挂产蛋回调（阶段 5-③）
    this._hookTurtleRepro();
  }

  // ── 供 save.js 使用的品种查询（品种被删除时返回 null）──
  _fishSpeciesById(id) { return FISH_SPECIES[id] ?? null; }
  _turtleSpeciesById(id) { return TURTLE_SPECIES[id] ?? null; }
  _plantSpeciesById(id) { return PLANT_SPECIES[id] ?? null; }

  /**
   * 该品种是否有水彩立绘（assets/creatures/<kind>/<id>_side.png）
   * 探测结果缓存在 CreaturePanel 的缓存里，避免"有图品种"被降级成色块。
   */
  _hasCreatureImage(kind, id) {
    const cache = this.panel?._imgCache;
    if (!cache) return true;
    for (const view of ['side', 'top']) {
      let img = cache.get(`${kind}:${id}:${view}`);
      if (!img) {
        img = new Image();
        img.src = `assets/creatures/${kind}/${id}_${view}.png`;
        img.onerror = () => { img._failed = true; };
        cache.set(`${kind}:${id}:${view}`, img);
      }
      if (img.complete) { if (img.naturalWidth > 0 && !img._failed) return true; }
      else if (!img._failed) return true;   // 还没加载完 → 先按"有"处理
    }
    return false;
  }

  /** 给每只龟挂上产蛋回调（新加的龟也要挂） */
  _hookTurtleRepro() {
    for (const t of this.turtles) {
      if (t.onLayEggs) continue;
      t.onLayEggs = (turtle) => this._turtleLayEggs(turtle);
    }
  }

  /** 乌龟产蛋：数量上限内才允许，返回是否成功 */
  _turtleLayEggs(turtle) {
    if (this.turtles.length >= CONFIG.growth.turtleCap) return false;
    const n = CONFIG.growth.eggsPerClutch;
    const count = n[0] + Math.floor(Math.random() * (n[1] - n[0] + 1));
    for (let i = 0; i < count; i++) {
      this.eggs.push(new Egg(this.world, turtle.x + (Math.random() - 0.5) * 16, turtle.y + 6, turtle.species));
    }
    this.world.addRipple(turtle.x, this.world.bankLineAt(turtle.x) + 6, 0.8);
    return true;
  }

  // ── 事件 ──────────────────────────────────────────────
  _bindEvents() {
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.world.resize(window.innerWidth, window.innerHeight);
      // 植物位置依赖岸线/泥沼线，resize 后重建
      if (this.plants) this.plants.build(this.plants.population());
    });
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    window.addEventListener('mousemove', (e) => {
      this.cursor.x = e.clientX;
      this.cursor.y = e.clientY;
      this.cursor.active = true;
      this._cursorWake(e.clientX, e.clientY);
    });
    window.addEventListener('mouseleave', () => { this.cursor.active = false; });

    // 左键：点中生物 → 信息卡；点空白 → 投喂 + 弹出「选品种」面板（记住投放点）
    window.addEventListener('mousedown', (e) => {
      this.audio.unlock();      // 首次手势解锁音频（浏览器自动播放策略）
      if (e.button === 0) {
        if (this.panel.handleCanvasClick(e.clientX, e.clientY)) {
          this.picker.close();          // 选生物看资料时，收起选品种面板
          return;
        }
        this.food.feed(e.clientX, e.clientY);
        this.audio.playFeed();          // 投喂落水声（阶段 5-⑨）
        // 弹出/移动「选品种」面板，记下这次点击的位置作为投放点
        this.picker.showAt(e.clientX, e.clientY);
        this.save.touch();
      } else if (e.button === 2) {
        this.showHelp = !this.showHelp;
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // 键盘
    window.addEventListener('keydown', (e) => {
      // 正在面板里改名（输入框）→ 不抢按键，否则打不出 s / w / t 等字母
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      switch (e.key.toLowerCase()) {
        case ' ':
          this.paused = !this.paused;
          e.preventDefault();
          break;
        case 'f':
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen();
          break;
        case 'h':
          this.showHelp = !this.showHelp;
          break;
        case '+': case '=':
          this.addFish(2);
          break;
        case '-': case '_':
          this.removeFish(2);
          break;
        case 't':
          this.addTurtle();
          break;
        case 'a':
          // 选品种面板：A 键开关（打开时以屏幕中心为投放点）
          this.picker.toggle();
          break;
        case 'l':
          this.showLegend = !this.showLegend;
          break;
        case 'p':
          this.plantsEnabled = !this.plantsEnabled;
          break;
        case 'n':
          // 时间快进开关（×25），观赏昼夜交替用
          this.daynight.speed = this.daynight.speed > 1 ? 1 : 25;
          break;
        case 'w': {
          // 手动切换天气：晴 → 雨 → 雨后 → 晴
          const order = ['sunny', 'rain', 'afterRain'];
          const next = order[(order.indexOf(this.weather.state) + 1) % order.length];
          this.weather.set(next);
          break;
        }
        case 'o':
          // 生命档案面板
          this.showArchive = !this.showArchive;
          break;
        case 'm': {
          // 静音开关（阶段 5-⑨）；首次按 M 会顺带解锁音频
          this.audio.unlock();
          const nowMuted = !CONFIG.audio.muted;
          this.audio.setMuted(nowMuted);
          this._toast(nowMuted ? '🔇 已静音' : `🔊 音量 ${Math.round(CONFIG.audio.masterVolume * 100)}%`);
          break;
        }
        case 'g':
          // 视觉打磨总开关（阶段 5-⑧）：性能对比用
          CONFIG.fx.enabled = !CONFIG.fx.enabled;
          this._toast(CONFIG.fx.enabled ? '✨ 视觉打磨：开' : '✨ 视觉打磨：关（省性能）');
          break;
        case 's':
          // 存档：S = 立即存档；Shift+S = 导出 JSON 文件（阶段 6-①）
          if (e.shiftKey) this._toast(`📦 已导出 ${this.exportSave()}`);
          else {
            const r = this.saveNow();
            this._toast(r.ok ? '💾 已存档' : `⚠️ 存档失败（${r.error ?? '未知'}）`);
          }
          break;
        case 'r':
          // 重新开始：需 Shift 防误触；清档前提示可恢复
          if (e.shiftKey) {
            this.newGame(false);
            this._toast('🔄 已清档，3 秒后重开…（pond.undoReset() 可恢复）');
            setTimeout(() => location.reload(), 3000);
          }
          break;
        case 'escape':
          this.panel.close();
          this.picker.close();
          break;
        // 数字键 1~6 → 按品种添加鱼
        case '1': case '2': case '3': case '4': case '5': case '6': {
          const ids = Object.keys(FISH_SPECIES);
          const id = ids[parseInt(e.key, 10) - 1];
          if (id) this.addFish(1, id);
          break;
        }
      }
    });

    // 页面不可见时暂停（性能策略）
    document.addEventListener('visibilitychange', () => {
      this.visible = !document.hidden;
    });
  }

  /**
   * 光标水面尾迹（阶段 5-⑪）—— 真实波动方程
   * 沿光标移动的线段调用 world.addWake → 波场里连续落下扰动，
   * 水波会真实传播、相互干涉并随距离衰减。
   * 位移不足 minDist 时先攒着，避免高频采样把波场"打糊"。
   */
  _cursorWake(x, y) {
    const nat = CONFIG.natural || {};
    if (nat.enabled === false || nat.cursorWake === false) return;

    const tr = this._cursorTrail;
    const now = performance.now();
    const dx = x - tr.lx, dy = y - tr.ly;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, now - tr.lt) / 1000;
    const speed = dist / dt;                 // px/s

    if (!tr.lt) { tr.lx = x; tr.ly = y; tr.lt = now; return; }

    const minDist = nat.cursorWakeMinDist ?? 6;
    if (dist < minDist) { tr.lt = now; return; }

    // 用线段补插值：光标移动再快，尾迹也不会断成一粒粒孤立的波
    if (this.world.isWater(x, y)) {
      this.world.addWake(tr.lx, tr.ly, x, y, speed);
    }
    tr.lx = x; tr.ly = y; tr.lt = now;
  }

  // ── 对外接口（LivelyProperties / 控制台可调）──────────
  /**
   * 添加小鱼
   * @param {number} n 数量
   * @param {string} [speciesId] 指定品种 id；不传则随机
   * @param {object} [opts] { baby } 幼苗模式
   */
  addFish(n = 1, speciesId = null, opts = {}) {
    const sp = speciesId ? FISH_SPECIES[speciesId] : null;
    if (speciesId && !sp) console.warn('[pond] 未知鱼品种:', speciesId);
    for (let i = 0; i < n; i++) this.fishes.push(new Fish(this.world, sp, opts));
    this.save.touch();
  }

  /** 移除小鱼（可按品种精确移除） */
  removeFish(n = 1, speciesId = null) {
    for (let i = 0; i < n; i++) {
      let idx = this.fishes.length - 1;
      if (speciesId) {
        idx = this.fishes.findLastIndex((f) => f.species.id === speciesId);
        if (idx < 0) break;
      } else if (idx < 0) break;
      this.fishes.splice(idx, 1);
    }
    this.save.touch();
  }

  /**
   * 添加乌龟
   * @param {string} [speciesId]
   * @param {object} [opts] { baby } 幼龟模式
   */
  addTurtle(speciesId = null, opts = {}) {
    if (this.turtles.length >= CONFIG.growth.turtleCap) return null;
    const sp = speciesId ? TURTLE_SPECIES[speciesId] : null;
    if (speciesId && !sp) console.warn('[pond] 未知龟品种:', speciesId);
    const t = new Turtle(this.world, this.turtles.length, sp, opts);
    t.onLayEggs = (turtle) => this._turtleLayEggs(turtle);
    this.turtles.push(t);
    this.save.touch();
    return t;
  }

  removeTurtle(n = 1, speciesId = null) {
    for (let i = 0; i < n; i++) {
      let idx = this.turtles.length - 1;
      if (speciesId) {
        idx = this.turtles.findLastIndex((t) => t.species.id === speciesId);
        if (idx < 0) break;
      } else if (idx < 0) break;
      this.turtles.splice(idx, 1);
    }
    this.save.touch();
  }

  /** 统计当前种群（品种 → 数量） */
  population() {
    const fish = {};
    const turtle = {};
    for (const f of this.fishes) fish[f.species.id] = (fish[f.species.id] || 0) + 1;
    for (const t of this.turtles) turtle[t.species.id] = (turtle[t.species.id] || 0) + 1;
    return { fish, turtle };
  }

  /** 列出所有可用品种 */
  speciesList() {
    return listSpecies();
  }

  /** 统计乌龟栖息类型分布（阶段 5：陆龟/水龟分类） */
  habitatStats() {
    const byHabitat = {};
    const byState = {};
    for (const t of this.turtles) {
      const h = t.habitat ?? 'semi';
      byHabitat[h] = (byHabitat[h] || 0) + 1;
      byState[t.state] = (byState[t.state] || 0) + 1;
    }
    return { byHabitat, byState, label: HABITAT_LABELS };
  }

  /** 清空并重建整个种群 */
  setPopulation(pop) {
    this.fishes.length = 0;
    this.turtles.length = 0;
    this.eggs.length = 0;
    this.remains.length = 0;
    this._spawnPopulation(pop);
    this.save.touch();
  }

  // ── 「选品种」投放（阶段 6-②）─────────────────────────
  /**
   * 投放一只/一株到指定位置 —— 选品种面板的落点
   * @param {'fish'|'turtle'|'plant'} kind
   * @param {string} id 品种 id
   * @param {number} x 画布坐标
   * @param {number} y
   * @returns {object|null} 新建的实例（失败/超上限返回 null）
   */
  spawnAt(kind, id, x, y) {
    if (kind === 'fish') return this.addFishAt(id, x, y);
    if (kind === 'turtle') return this.addTurtleAt(id, x, y);
    if (kind === 'plant') return this.addPlantAt(id, x, y);
    console.warn('[pond] 未知类别:', kind);
    return null;
  }

  /**
   * 在点击处加一条鱼（不传坐标则按默认随机位置）
   * @param {string} speciesId
   * @param {number} [x]
   * @param {number} [y]
   */
  addFishAt(speciesId, x, y) {
    const sp = FISH_SPECIES[speciesId];
    if (!sp) { console.warn('[pond] 未知鱼品种:', speciesId); return null; }
    const f = new Fish(this.world, sp);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const p = this.world.constrainToWater(x, y, 26);
      f.x = p.x; f.y = p.y;
      f.vx = 0; f.vy = 0;
    }
    this.fishes.push(f);
    this.save.touch();
    return f;
  }

  /**
   * 在点击处加一只龟（点在水里→游动；点在岸上→直接上岸趴着；
   * 水龟被放到岸上且非主动状态时，状态机会自己把它带回水里）
   * @param {string} speciesId
   * @param {number} [x]
   * @param {number} [y]
   */
  addTurtleAt(speciesId, x, y) {
    if (this.turtles.length >= CONFIG.growth.turtleCap) return null;
    const sp = TURTLE_SPECIES[speciesId];
    if (!sp) { console.warn('[pond] 未知龟品种:', speciesId); return null; }
    const t = new Turtle(this.world, this.turtles.length, sp);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const cx = clamp(x, 12, this.world.w - 12);
      t.x = cx;
      if (this.world.isWater(cx, y)) {
        const p = this.world.constrainToWater(cx, y, 18);
        t.y = p.y;
        t.state = 'swim';
        t.stateTime = 0;
      } else {
        // 岸边：不让它贴到屏幕最上沿
        t.y = Math.max(16, Math.min(y, this.world.bankLineAt(cx) - 6));
        t.state = 'bask';
        t.stateTime = 0;
      }
      t.vx = 0; t.vy = 0;
    }
    t.onLayEggs = (turtle) => this._turtleLayEggs(turtle);
    this.turtles.push(t);
    this.save.touch();
    return t;
  }

  /**
   * 在点击处种一株植物（按品种所属层自动吸附到岸线/水面/泥沼线）
   * @param {string} speciesId
   * @param {number} [x]
   * @param {number} [y]
   */
  addPlantAt(speciesId, x, y) {
    const sp = PLANT_SPECIES[speciesId];
    if (!sp) { console.warn('[pond] 未知植物品种:', speciesId); return null; }
    this.plantsEnabled = true;                  // 关着植物就先打开，否则种了看不见
    const p = this.plants.addPlant(speciesId, x ?? this.world.w / 2, y ?? 0);
    if (p) this.save.touch();
    return p;
  }

  // ── 存档接口（阶段 6-①）───────────────────────────────
  /** 立即存档 */
  saveNow() {
    const ok = this.save.save('manual');
    return { ok, at: new Date().toLocaleTimeString(), reason: this.save.lastSaveReason, error: this.save.error };
  }

  /** 存档概要（当前内存世界 / 已落盘存档） */
  saveInfo() {
    return {
      hasSave: this.save.hasSave(),
      hasTrash: this.save.hasTrash(),
      resumed: this.resumed,
      schema: SAVE_SCHEMA,
      key: SAVE_KEY,
      lastSaveAt: this.save.lastSaveAt ? new Date(this.save.lastSaveAt).toLocaleString() : null,
      current: this.save.summarize(this.save.snapshot()),
    };
  }

  /** 导出存档为 .json 下载 */
  exportSave() { return this.save.exportFile(); }

  /**
   * 导入存档（从文本）—— 写入后需刷新页面生效
   * @param {string} text
   */
  importSave(text) {
    const res = this.save.importText(text);
    if (res.ok) res.hint = '已写入存档，刷新页面后生效（F5 / 重新应用壁纸）';
    return res;
  }

  /** 重新开始：清档（可恢复），刷新后生效 */
  newGame(wipeArchive = false) {
    const ok = this.save.reset(wipeArchive);
    return { ok, recoverable: ok, hint: '已清档。后悔了？pond.undoReset() 可恢复' };
  }

  /** 撤销清档 */
  undoReset() {
    const ok = this.save.undoReset();
    return { ok, hint: ok ? '已恢复被清掉的存档，刷新后生效' : '没有可恢复的存档' };
  }

  /**
   * 屏幕中央下方弹一条短提示（存档/导出等即时反馈）
   * @param {string} text
   * @param {number} [seconds=2.2]
   */
  _toast(text, seconds = 2.2) {
    this._toastText = text;
    this._toastTimer = seconds;
  }

  setQuality(level) {
    this._quality = level;
  }

  // ── 植物接口（阶段 5-②）─────────────────────────────
  /** 重建植物群落：pond.setPlants({ lilypad: 12, reed: 30 }) */
  setPlants(pop) {
    this.plants.build(pop);
    this.save.touch();
    return this.plants.population();
  }

  /** 当前植物统计 */
  plantPopulation() {
    return this.plants.population();
  }

  /** 列出可用植物品种 */
  plantSpeciesList() {
    return Object.values(PLANT_SPECIES).map((s) => ({
      id: s.id, label: s.label, kind: s.kind, shelter: !!s.shelter,
    }));
  }

  /** 开关植物显示 */
  togglePlants() {
    this.plantsEnabled = !this.plantsEnabled;
    return this.plantsEnabled;
  }

  // ── 主循环 ────────────────────────────────────────────
  _loop(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 1 / 20);   // 防止切页后跳帧

    // 帧率统计
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this._curFps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    if (!this.paused && this.visible) {
      this._update(dt, now / 1000);
    }
    // 存档节流推进（暂停时不计时，避免暂停期间反复写盘）
    if (this.visible) this.save.tick(dt);
    // 提示条倒计时（用真实 dt，暂停时也照样淡出）
    if (this._toastTimer > 0) this._toastTimer = Math.max(0, this._toastTimer - dt);
    this.panel.tick(dt);
    this._render(now / 1000);

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt, time) {
    this.time = time;
    // 昼夜推进
    if (CONFIG.daynight?.enabled) this.daynight.update(dt);
    const light = CONFIG.daynight?.enabled ? this.daynight.light : 1;
    const env = {
      light,
      isNight: CONFIG.daynight?.enabled ? this.daynight.isNight : false,
      rain: CONFIG.weather?.enabled ? this.weather.state === 'rain' : false,
    };

    // 天气推进（阶段 5-⑤）
    if (CONFIG.weather?.enabled) this.weather.update(dt, this.world);

    // 鱼群先算行为（需要彼此信息；夜晚变慢；濒死鱼不参与）
    const plantRef = this.plantsEnabled ? this.plants : null;
    const fishLight = Math.max(CONFIG.daynight?.nightFishSpeed ?? 0.55, light);
    for (const f of this.fishes) {
      f.lightLevel = fishLight;
      if (!f.dying) f.flock(this.fishes, this.cursor, this.food.items, dt, plantRef);
    }
    for (const f of this.fishes) f.update(dt);

    // 乌龟（夜晚不上岸、岸上加速回水）
    for (const t of this.turtles) {
      const wasInWater = this.world.isWater(t.x, t.y);
      t.update(dt, this.food.items, this.cursor, this.turtles, env);
      // 从岸上回到水里 → 溅水声（阶段 5-⑨）
      if (!wasInWater && this.world.isWater(t.x, t.y) && !t.dying) {
        this.audio.playSplash(0.9);
        this.world.addRipple(t.x, this.world.bankLineAt(t.x) + 4, 1.1);
      }
    }

    // 食物
    this.food.update(dt);

    // ── 死亡结算（阶段 5-⑥）：入档案 + 留遗骸 + 移除 ──
    this._reapDead();

    // ── 分解者（阶段 5-⑦）：螺蛳啃遗骸 / 虾吃沉底食物 ──
    this.scavengers.update(dt, this.remains, this.food.items);
    for (let i = this.remains.length - 1; i >= 0; i--) {
      if (this.remains[i].gone) this.remains.splice(i, 1);
    }

    // ── 繁殖系统（阶段 5-③）──────────────────────────
    this._reproduce(dt);

    // 浮萍（被生物推开）
    const movers = [...this.turtles, ...this.fishes.map(f => ({ x: f.x, y: f.y, size: f.size }))];
    this.duckweed.update(dt, movers);

    // 植物（浮叶被推开 + 摇摆）
    this.plants.update(dt, time, movers);

    // 世界（涟漪 + 真实波场推进）
    this.world.update(dt);

    // ── 生物游动尾迹（阶段 5-⑪）：鱼/龟在水中游过留下真实扩散的波 ──
    // 每 0.3s 一批（而不是每帧），控制扰动次数；强度随体型微调
    this._swimWakeT = (this._swimWakeT ?? 0) + dt;
    if (this._swimWakeT >= 0.3 && (CONFIG.natural?.wave ?? true)) {
      this._swimWakeT = 0;
      for (const f of this.fishes) {
        if (f.dying) continue;
        if (this.world.isWater(f.x, f.y)) {
          this.world.wave.disturb(f.x, f.y, 0.045 + f.size * 0.004, 2);
        }
      }
      for (const t of this.turtles) {
        if (t.dying || !this.world.isWater(t.x, t.y)) continue;
        // 只在龟真正移动时起波（趴着晒背不起）
        const sp = Math.hypot(t.vx ?? 0, t.vy ?? 0);
        if (sp > 2) this.world.wave.disturb(t.x, t.y, 0.12, 3);
      }
    }

    // 音效推进（阶段 5-⑨）：雨声随天气起伏 + 夜晚稀疏蛙鸣
    this.audio.update(dt, {
      rain: env.rain,
      isNight: env.isNight,
      rainIntensity: this.weather.intensity,
    });
  }

  /** 鱼群繁殖判定：成年 + 饱食 + 同种邻近 + 冷却结束 + 上限内 */
  _reproduce(dt) {
    const G = CONFIG.growth;

    // ── 鱼：成对繁殖 ─────────────────────────────────
    if (this.fishes.length < G.fishCap) {
      for (const f of this.fishes) {
        if (!f.isAdult || f.dying || f.hunger > G.reproHungerMax || f.reproCooldown > 0) continue;
        // 每秒约 fishReproChance 的概率（按 dt 折算到帧）
        if (Math.random() > G.fishReproChance * dt) continue;
        // 找同种成年邻居
        let mate = null;
        for (const o of this.fishes) {
          if (o === f || !o.isAdult || o.dying || o.hunger > G.reproHungerMax) continue;
          if (o.species.id !== f.species.id) continue;
          if (dist2(f.x, f.y, o.x, o.y) < 46 * 46) { mate = o; break; }
        }
        if (!mate) continue;
        // 生 1~2 条鱼苗
        const fryN = 1 + (Math.random() < 0.35 ? 1 : 0);
        for (let i = 0; i < fryN; i++) {
          if (this.fishes.length >= G.fishCap) break;
          this.addFish(1, f.species.id, { baby: true });
          const fry = this.fishes[this.fishes.length - 1];
          fry.x = f.x + (Math.random() - 0.5) * 20;
          fry.y = f.y + (Math.random() - 0.5) * 20;
        }
        f.reproCooldown = G.fishReproCooldown;
        mate.reproCooldown = G.fishReproCooldown;
        f.offspring = (f.offspring ?? 0) + fryN;    // 生命档案统计用
        // 消耗体力
        f.hunger = Math.min(1, f.hunger + 0.22);
        mate.hunger = Math.min(1, mate.hunger + 0.22);
        this.world.addRipple(f.x, f.y, 0.7);
        break; // 每帧最多一对
      }
    }

    // ── 龟蛋：孵化 ───────────────────────────────────
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const egg = this.eggs[i];
      egg.update(dt);
      if (egg.hatched) {
        this.eggs.splice(i, 1);
        if (this.turtles.length < G.turtleCap) {
          // 每窝孵化 1 只幼龟（多余的蛋为"未受精"自然消失）
          const baby = new Turtle(this.world, this.turtles.length, egg.species, { baby: true });
          baby.x = egg.x;
          baby.y = Math.max(egg.y, this.world.bankLineAt(egg.x) + 14);
          baby.state = 'return';   // 破壳后先爬回水里
          baby.onLayEggs = (t) => this._turtleLayEggs(t);
          this.turtles.push(baby);
          this.world.addRipple(egg.x, this.world.bankLineAt(egg.x) + 8, 1.0);
        }
      }
    }
  }

  // ── 生命周期（阶段 5-⑥）──────────────────────────────
  /** 收殓死亡生物：写入生命档案 → 留下遗骸 → 从池塘移除 */
  _reapDead() {
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i];
      if (!f.dead) continue;
      this.archive.add(f, this.time);
      this._spawnRemains('fish', f.size, f.x, f.y);
      this.fishes.splice(i, 1);
    }
    for (let i = this.turtles.length - 1; i >= 0; i--) {
      const t = this.turtles[i];
      if (!t.dead) continue;
      this.archive.add(t, this.time);
      this._spawnRemains('turtle', t.size, t.x, t.y, !this.world.isWater(t.x, t.y));
      this.turtles.splice(i, 1);
    }
  }

  /** 留下遗骸：水里沉底，岸上（龟）原地 */
  _spawnRemains(kind, size, x, y, onLand = false) {
    this.remains.push(new Remains(this.world, kind, size, x, y, onLand ? y : null));
  }

  _render(time) {
    const ctx = this.ctx;
    const { w, h } = this.world;

    ctx.clearRect(0, 0, w, h);

    // 背景天空（岸边之上）—— 昼夜循环接管
    if (CONFIG.daynight?.enabled) {
      this.daynight.drawSky(ctx, this.world);
    } else {
      ctx.fillStyle = CONFIG.colors.sky;
      ctx.fillRect(0, 0, w, this.world.bankY);
    }

    // 场景三区
    this.world.draw(ctx, time);

    // 岸线水面高光带（阶段 5-⑧）
    this.fx.drawWaterEdge(ctx, time, CONFIG.daynight?.enabled ? this.daynight.light : 1);

    // ── 植物分层绘制 ──────────────────────────────────
    if (this.plantsEnabled) {
      // 1) 岸边植物（贴岸线，位于水之前）
      this.plants.drawLayer(ctx, time, 'bank');
      // 2) 沉水植物（水底）
      this.plants.drawLayer(ctx, time, 'submerged');
    }

    // 龟蛋（埋在岸边沙土，画在岸边植物之上）
    for (const egg of this.eggs) egg.draw(ctx);

    // 浮萍
    this.duckweed.draw(ctx);

    // 食物
    this.food.draw(ctx);

    // 遗骸 + 螺蛳（水底层，阶段 5-⑦）
    for (const r of this.remains) r.draw(ctx, time);
    this.scavengers.draw(ctx, time, 'bottom');

    // ── 生物阴影（阶段 5-⑧）：先铺影，再画本体 ────────
    for (const t of this.turtles) this.fx.drawShadow(ctx, t);
    for (const f of this.fishes) this.fx.drawShadow(ctx, f);

    // 生物
    for (const t of this.turtles) t.draw(ctx);
    for (const f of this.fishes) f.draw(ctx);

    // 小虾（水中层，阶段 5-⑦）
    this.scavengers.draw(ctx, time, 'top');

    // ── 水下景深雾 + 水面焦散（阶段 5-⑧）─────────────
    const lightNow = CONFIG.daynight?.enabled ? this.daynight.light : 1;
    this.fx.drawDepthFog(ctx, lightNow);
    this.fx.drawCaustics(ctx, time, lightNow, CONFIG.weather?.enabled && this.weather.state === 'rain');

    // 3) 水面浮叶（睡莲/荷花）—— 画在生物之上，形成遮罩层次
    if (this.plantsEnabled) {
      this.plants.drawLayer(ctx, time, 'surface');
    }

    // 昼夜色罩（全屏氛围光，在 HUD 之前）
    if (CONFIG.daynight?.enabled) {
      this.daynight.drawOverlay(ctx, this.world);
    }

    // 天气色罩 + 雨丝（阶段 5-⑤，在昼夜罩之上）
    if (CONFIG.weather?.enabled) {
      this.weather.drawTint(ctx, this.world);
      this.weather.drawRain(ctx, this.world);
    }

    // 选中生物的高亮呼吸圈（跟随游动）
    this.panel.drawHighlight(ctx, time);

    // 「选品种」面板开着时，标出这次投放的落点
    if (this.picker?.open) {
      const { x, y } = this.picker;
      const a = 0.55 + Math.sin(time * 4) * 0.25;
      ctx.save();
      ctx.strokeStyle = `rgba(255,236,150,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // HUD
    if (this.showHelp) this._drawHelp(ctx);
    if (this.showLegend) this._drawLegend(ctx);
    if (this.showArchive) this._drawArchive(ctx);
    if (this.showStats) this._drawStats(ctx);
    this._drawToast(ctx);

    // 自测徽章（?selftest=1 时把断言结果直接画上 canvas，headless 截图可读）
    if (this._selftestResult) drawTestBadge(ctx, this._selftestResult);
  }

  /** 短暂提示条（S 存档 / Shift+S 导出等） */
  _drawToast(ctx) {
    if (!this._toastText || this._toastTimer <= 0) return;
    const life = Math.min(1, this._toastTimer / 0.35);   // 末尾 0.35s 淡出
    ctx.save();
    ctx.globalAlpha = life;
    ctx.font = '14px "Microsoft YaHei", ui-sans-serif, sans-serif';
    const padX = 18, padY = 11, lh = 20;
    const lines = this._toastText.split('\n');
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    const bw = maxW + padX * 2;
    const bh = lines.length * lh + padY * 2;
    const bx = (this.world.w - bw) / 2;
    const by = this.world.h - bh - 64;

    ctx.fillStyle = 'rgba(10,28,36,0.78)';
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#d6f0f8';
    lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + lh * (i + 0.78)));
    ctx.restore();
  }

  _drawStats(ctx) {
    ctx.save();
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const fry = this.fishes.filter((f) => !f.isAdult).length;
    const babies = this.turtles.filter((t) => !t.isAdult).length;
    const extra = [
      fry > 0 ? `鱼苗 ${fry}` : null,
      babies > 0 ? `幼龟 ${babies}` : null,
      this.eggs.length > 0 ? `蛋 ${this.eggs.length}` : null,
    ].filter(Boolean).join('  ');
    // 时段显示（昼夜开启时）
    const dn = CONFIG.daynight?.enabled ? `  |  ${this.daynight.phase.icon} ${this.daynight.phase.label}${this.daynight.speed > 1 ? ` ×${this.daynight.speed}` : ''}` : '';
    // 天气 + 生命档案计数（阶段 5-⑤⑥）
    const wx = CONFIG.weather?.enabled ? `  |  ${this.weather.summary}` : '';
    const arch = this.archive.count() > 0 ? `  |  📖 ${this.archive.count()}` : '';
    ctx.fillText(
      `FPS ${this._curFps.toFixed(0)}  |  鱼 ${this.fishes.length}  龟 ${this.turtles.length}  食物 ${this.food.aliveCount}${extra ? '  |  ' + extra : ''}${dn}${wx}${arch}${this.paused ? '  |  ⏸ 已暂停' : ''}`,
      12, this.world.h - 12
    );
    ctx.restore();
  }

  _drawHelp(ctx) {
    const lines = [
      '🐢 乌龟水塘',
      '',
      '左键点鱼/龟 → 查看信息卡（可改名）',
      '左键点空白  →  投喂饲料 + 弹出「选品种」',
      '  面板上点品种 = 放 1 只（可连点）',
      '移动鼠标  →  鱼群避让 / 乌龟好奇',
      'Esc       →  关闭信息卡',
      '右键 / H  →  显示/隐藏帮助',
      '空格      →  暂停 / 继续',
      'F         →  全屏',
      '1~6       →  按品种添加小鱼',
      'T         →  增加乌龟',
      'A         →  选品种面板（加鱼/龟/草）',
      'L         →  物种列表',
      'P         →  显示/隐藏植物',
      'N         →  时间快进 ×25（看昼夜）',
      'W         →  切换天气（晴/雨/雨后）',
      'O         →  生命档案（逝者纪念册）',
      'M         →  静音 / 开声音（首次会解锁音频）',
      'G         →  视觉打磨开关（阴影/景深/焦散）',
      'S         →  立即存档',
      'Shift+S   →  导出存档 JSON 文件',
      'Shift+R   →  重新开始（清档，可撤销）',
      '',
      '🌿 鱼吃饱繁殖鱼苗，龟上岸产蛋孵化',
      '📖 逝者留下遗骸（螺蛳清理），记入生命档案',
      '💾 关掉壁纸再打开，继续上次的水塘',
      '🔊 音效默认关闭，按 M 或到壁纸设置里开启',
    ];
    this._panel(ctx, lines, 16, 16);
  }

  /** 物种列表面板：显示当前各品种数量 */
  _drawLegend(ctx) {
    const pop = this.population();
    const lines = ['📋 当前水塘物种', ''];
    for (const [id, n] of Object.entries(pop.fish)) {
      const sp = FISH_SPECIES[id];
      lines.push(`· ${sp?.label ?? id}  ×${n}`);
    }
    const fishTotal = this.fishes.length;
    lines.push(`  小鱼合计  ×${fishTotal}`);
    lines.push('');
    for (const [id, n] of Object.entries(pop.turtle)) {
      const sp = TURTLE_SPECIES[id];
      const hab = HABITAT_LABELS[sp?.habitat ?? 'semi'] ?? '';
      lines.push(`· ${sp?.label ?? id}［${hab}］ ×${n}`);
    }
    if (this.turtles.length === 0) lines.push('  （暂无乌龟）');
    this._panel(ctx, lines, 16, this.world.h - 40 - lines.length * 21, '#a8d8f0');
  }

  /** 生命档案面板（阶段 5-⑥） */
  _drawArchive(ctx) {
    const entries = this.archive.list();
    const lines = [`📖 生命档案（共 ${entries.length} 位）`, ''];
    if (entries.length === 0) {
      lines.push('（还没有居民离世，水塘一片祥和）');
    } else {
      const shown = entries.slice(0, 10);
      for (const e of shown) {
        const cause = CAUSE_LABELS[e.cause] ?? e.cause;
        const kind = KIND_LABELS[e.kind] ?? e.kind;
        lines.push(`· ${e.name}  ${e.species}·${kind} 第${e.gen}代  ${cause}  享年 ${this._fmtAge(e.age)}`);
      }
      if (entries.length > shown.length) lines.push(`… 其余 ${entries.length - shown.length} 条见 pond.archive()`);
    }
    lines.push('');
    lines.push('O 键关闭');
    this._panel(ctx, lines, Math.max(16, this.world.w - 470), 16, '#e8c8a8');
  }

  /** 秒数 → 可读时长 */
  _fmtAge(s) {
    if (s < 60) return `${Math.round(s)}秒`;
    if (s < 3600) return `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`;
    return `${(s / 3600).toFixed(1)}小时`;
  }

  /** 通用面板绘制 */
  _panel(ctx, lines, bx, by, accentColor = '#a8e6b0') {
    ctx.save();
    ctx.font = '13px "Microsoft YaHei", ui-sans-serif, sans-serif';
    const padX = 16, padY = 12, lh = 21;
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    const bw = maxW + padX * 2;
    const bh = lines.length * lh + padY * 2;

    ctx.fillStyle = 'rgba(10,28,36,0.62)';
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();

    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? accentColor : 'rgba(220,240,248,0.9)';
      ctx.fillText(l, bx + padX, by + padY + lh * (i + 0.8));
    });
    ctx.restore();
  }
}

// 启动
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);

  // ?fresh=1 → 忽略存档，开一口新水塘（不影响已有存档，下次打开照常恢复）
  const fresh = params.get('fresh') === '1';

  window.pondApp = new PondApp(DEFAULT_POPULATION, { resume: !fresh });

  // URL 参数 ?selftest=1 → 运行内置自测（断言 + 结果画上 canvas + 自动扫鼠标尾迹）
  // 单脚本内完成（无第二 <script>），规避 headless 下多脚本页截图卡死的怪癖
  if (params.get('selftest') === '1') {
    const app = window.pondApp;
    app.showHelp = false;
    // 同步执行：headless --timeout 截图可能在 load 后立刻触发，等不到 setTimeout
    try {
      app._selftestResult = runSelfTest(app);
    } catch (e) {
      app._selftestResult = { pass: 0, fail: 1, log: ['CRASH ' + (e.message ?? e)] };
    }
    // 之后每 2s 自动划一次鼠标，制造可见尾迹（供截图验收）
    let sweeps = 0;
    const timer = setInterval(() => {
      if (++sweeps > 3) { clearInterval(timer); return; }
      const y0 = app.world.bankLineAt(app.world.w / 2) + 80;
      for (let i = 0; i <= 40; i++) {
        setTimeout(() => {
          window.dispatchEvent(new MouseEvent('mousemove', {
            clientX: app.world.w * 0.12 + (app.world.w * 0.76) * (i / 40),
            clientY: y0 + Math.sin(i * 0.45) * 34,
          }));
        }, i * 16);
      }
    }, 2000);
  }

  // URL 参数 ?t=0.85 → 直接跳到指定时刻（调试/分享用，0=黎明 0.3=白天 0.56=黄昏 0.85=夜晚）
  const tParam = parseFloat(params.get('t'));
  if (!Number.isNaN(tParam) && window.pondApp.daynight) {
    window.pondApp.daynight.setDayT(Math.min(1, Math.max(0, tParam)));
  }
  // URL 参数 ?w=rain → 直接切到指定天气（调试用：sunny / rain / afterRain）
  const wParam = params.get('w');
  if (wParam && window.pondApp.weather) {
    window.pondApp.weather.set(wParam);
  }

  // 控制台 API（也供将来 Lively 扩展调用）
  window.pond = {
    app: () => window.pondApp,
    /** 加鱼：pond.addFish(3, 'koi') 或 pond.addFish(1, 'koi', {baby:true}) */
    addFish: (n = 1, id = null, opts = {}) => window.pondApp.addFish(n, id, opts),
    /** 加龟：pond.addTurtle('redear') 或 pond.addTurtle('redear', {baby:true}) */
    addTurtle: (id = null, opts = {}) => window.pondApp.addTurtle(id, opts),
    /** 指定位置投放（选品种面板用）：pond.spawnAt('plant','lotus', 800, 400) */
    spawnAt: (kind, id, x, y) => window.pondApp.spawnAt(kind, id, x, y),
    /** 选品种面板：pond.picker(true) 打开 / pond.picker(false) 关闭 */
    picker: (on = true) => (on ? window.pondApp.picker.showAt(
      window.pondApp.world.w / 2, window.pondApp.world.h / 2) : window.pondApp.picker.close()),
    /** 看当前物种：pond.population() */
    population: () => window.pondApp.population(),
    /** 看有哪些品种：pond.species() */
    species: () => window.pondApp.speciesList(),
    /** 看乌龟栖息类型分布：pond.habitats() */
    habitats: () => window.pondApp.habitatStats(),
    /** 植物统计：pond.plants() */
    plants: () => window.pondApp.plantPopulation(),
    /** 植物品种：pond.plantSpecies() */
    plantSpecies: () => window.pondApp.plantSpeciesList(),
    /** 重建植物：pond.setPlants({ lotus: 6, reed: 20 }) */
    setPlants: (p) => window.pondApp.setPlants(p),
    /** 开关植物显示：pond.togglePlants() */
    togglePlants: () => window.pondApp.togglePlants(),
    /** 生态统计：pond.eco() → 种群/苗/蛋数量 */
    eco: () => ({
      fish: window.pondApp.fishes.length,
      fry: window.pondApp.fishes.filter((f) => !f.isAdult).length,
      turtle: window.pondApp.turtles.length,
      babyTurtle: window.pondApp.turtles.filter((t) => !t.isAdult).length,
      eggs: window.pondApp.eggs.length,
      caps: { fish: CONFIG.growth.fishCap, turtle: CONFIG.growth.turtleCap },
    }),
    /** 昼夜时间：pond.time() → 当前时段/光强；pond.setTime(0.65) 跳到夜晚 */
    time: () => ({
      dayT: +window.pondApp.daynight.dayT.toFixed(3),
      phase: window.pondApp.daynight.phase.label,
      icon: window.pondApp.daynight.phase.icon,
      light: +window.pondApp.daynight.light.toFixed(2),
      speed: window.pondApp.daynight.speed,
    }),
    setTime: (t) => window.pondApp.daynight.setDayT(t),
    /** 重建种群：pond.setPopulation({fish:{koi:5}, turtle:{redear:2}}) */
    setPopulation: (p) => window.pondApp.setPopulation(p),
    /** 投喂：pond.feed(x, y) */
    feed: (x, y) => window.pondApp.food.feed(x, y),
    /** 天气：pond.weather() / pond.setWeather('rain') */
    weather: () => ({
      state: window.pondApp.weather.state,
      summary: window.pondApp.weather.summary,
      drops: window.pondApp.weather.drops.length,
    }),
    setWeather: (s) => window.pondApp.weather.set(s),
    /** 生命档案：pond.archive() / pond.archiveDetail('墨墨') / pond.archiveStats() */
    archive: () => window.pondApp.archive.list(),
    archiveDetail: (name) => window.pondApp.archive.detail(name),
    archiveStats: () => window.pondApp.archive.stats(),
    /** 分解者与遗骸：pond.scavengers() → { snails, shrimps, remains } */
    scavengers: () => ({
      ...window.pondApp.scavengers.population(),
      remains: window.pondApp.remains.length,
    }),
    pause: () => { window.pondApp.paused = true; },
    play: () => { window.pondApp.paused = false; },
    /** 视觉打磨（阶段 5-⑧）：pond.fx() 看开关；pond.setFx('shadow', false) 单独关 */
    fx: () => ({ ...CONFIG.fx }),
    setFx: (key, on) => {
      if (key === 'enabled') CONFIG.fx.enabled = !!on;
      else if (key in CONFIG.fx) CONFIG.fx[key] = !!on;
      return { ...CONFIG.fx };
    },
    /** 音效（阶段 5-⑨）：pond.audio() 看状态；pond.mute(false) 开声；pond.volume(0.5) */
    audio: () => window.pondApp.audio.status(),
    mute: (m = true) => { window.pondApp.audio.unlock(); window.pondApp.audio.setMuted(m); return window.pondApp.audio.status(); },
    volume: (v) => { window.pondApp.audio.unlock(); window.pondApp.audio.setVolume(v); return window.pondApp.audio.status(); },
    /** 试听音效：pond.sfx('feed'|'splash'|'frog') */
    sfx: (name) => {
      const a = window.pondApp.audio;
      a.unlock();
      if (name === 'splash') a.playSplash();
      else if (name === 'frog') a.playFrog();
      else a.playFeed();
      return a.status();
    },

    // ── 存档（阶段 6-①）───────────────────────────────
    /** 立即存档：pond.save() */
    save: () => window.pondApp.saveNow(),
    /** 存档状态：pond.saveInfo() → 是否有档 / 上次存档时间 / 世界概要 */
    saveInfo: () => window.pondApp.saveInfo(),
    /** 导出存档为 JSON 文件（浏览器下载） */
    exportSave: () => window.pondApp.exportSave(),
    /** 导入存档文本：pond.importSave(jsonString) → 刷新后生效 */
    importSave: (text) => window.pondApp.importSave(text),
    /** 重新开始（清档，可恢复）：pond.newGame() */
    newGame: (wipeArchive = false) => window.pondApp.newGame(wipeArchive),
    /** 撤销清档：pond.undoReset() */
    undoReset: () => window.pondApp.undoReset(),
    /** 完成「重新开始」后彻底丢弃可恢复的旧档 */
    dropTrash: () => { window.pondApp.save.dropTrash(); return true; },
    /** 本次是否读档继续 */
    resumed: () => window.pondApp.resumed,
  };
  console.log('[🐢 乌龟水塘] 控制台 API 已就绪，试试：pond.species() / pond.addFish(3, "koi")');
});

// ── Lively Wallpaper 属性接口 ─────────────────────────────
// Lively 会读取 LivelyProperties.json，并在用户调节控件时调用此函数
// （首次加载时也会以当前保存值调用一遍）
window.livelyPropertyListener = function (name, val) {
  const app = window.pondApp;
  if (!app) return;
  switch (name) {
    case 'fishCount': {
      const cur = app.fishes.length;
      if (val > cur) app.addFish(val - cur);
      else if (val < cur) app.removeFish(cur - val);
      break;
    }
    case 'turtleCount': {
      const cur = app.turtles.length;
      if (val > cur) {
        for (let i = cur; i < val; i++) app.addTurtle();
      } else if (val < cur) {
        app.removeTurtle(cur - val);
      }
      break;
    }
    case 'duckweedCount': {
      app.duckweed = new DuckweedField(app.world, val);
      app.save.touch();
      break;
    }
    case 'waterTop':
      CONFIG.colors.waterTop = val;
      break;
    case 'waterBottom':
      CONFIG.colors.waterBottom = val;
      break;
    case 'quality':
      app.setQuality(val);
      break;
    case 'showFps':
      app.showStats = !!val;
      break;
    case 'showPlants':
      app.plantsEnabled = !!val;
      break;
    case 'daynightEnabled':
      CONFIG.daynight.enabled = !!val;
      break;
    case 'dayLength':
      if (CONFIG.daynight) CONFIG.daynight.dayLength = val;
      if (app.daynight) app.daynight.dayLength = val;
      break;
    case 'weatherEnabled':
      CONFIG.weather.enabled = !!val;
      break;
    // ── 视觉打磨 / 音效（阶段 5-⑧⑨）────────────────────
    case 'fxEnabled':
      CONFIG.fx.enabled = !!val;
      break;
    case 'audioEnabled': {
      // 打开声音：需要用户手势解锁，Lively 面板操作算手势
      if (val) app.audio.unlock();
      app.audio.setMuted(!val);
      break;
    }
    case 'masterVolume':
      CONFIG.audio.masterVolume = val;
      app.audio.setVolume(val);
      break;
    case 'frogSound':
      CONFIG.audio.frogSound = !!val;
      break;

    // ── 存档相关（阶段 6-①）────────────────────────────
    // Lively 每次加载都会把全部属性以当前值回调一遍。
    // 关键是"只在值真的变化时"才动手，否则每次打开壁纸都会清档。
    case 'saveEnabled':
      app.settings.saveEnabled = !!val;
      break;
    case 'resetPond':
      // 勾选 → 清档并重启；取消勾选 → 撤销清档
      if (val) {
        if (app._resetHandled) break;         // 同一次会话只执行一次
        app._resetHandled = true;
        const r = app.newGame(false);
        console.info('[存档] 重新开始：', r);
        setTimeout(() => location.reload(), 300);
      } else {
        app._resetHandled = false;
        if (app.save.hasTrash()) {
          app.undoReset();
          console.info('[存档] 已撤销清档');
          setTimeout(() => location.reload(), 300);
        }
      }
      break;
  }
};
