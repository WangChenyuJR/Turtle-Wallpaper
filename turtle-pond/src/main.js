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
import { DuckweedField } from './duckweed.js';
import { FoodManager } from './food.js';
import { PlantField, PLANT_SPECIES, DEFAULT_PLANTS } from './plants.js';
import {
  DEFAULT_POPULATION, FISH_SPECIES, TURTLE_SPECIES,
  pickFishSpecies, pickTurtleSpecies, listSpecies, HABITAT_LABELS,
} from './species.js';
import { dist2 } from './utils.js';

class PondApp {
  constructor(population = DEFAULT_POPULATION) {
    this.canvas = document.getElementById('pond');
    this.ctx = this.canvas.getContext('2d');
    this.world = new World(window.innerWidth, window.innerHeight);

    this.fishes = [];
    this.turtles = [];
    this.eggs = [];               // 龟蛋（阶段 5-③）
    this.duckweed = new DuckweedField(this.world, CONFIG.duckweed.count);
    this.food = new FoodManager(this.world);
    // 植物（阶段 5-②）：岸边/浮叶/沉水三类
    this.plants = new PlantField(this.world, DEFAULT_PLANTS);
    this.plantsEnabled = CONFIG.plants?.enabled ?? true;
    this.time = 0;

    this.cursor = { x: 0, y: 0, active: false };
    this.paused = false;
    this.showHelp = true;
    this.showStats = true;
    this.showLegend = false;
    this.lastTime = performance.now();
    this.visible = true;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._curFps = 60;

    this._initScene(population);
    this._bindEvents();

    requestAnimationFrame((t) => this._loop(t));
  }

  /** 依据种群配置生成生物（阶段 3：数据驱动） */
  _initScene(population = DEFAULT_POPULATION) {
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
      // 光标划过水面产生涟漪
      if (Math.random() < 0.04) this.world.addRipple(e.clientX, e.clientY, 0.5);
    });
    window.addEventListener('mouseleave', () => { this.cursor.active = false; });

    // 左键投喂
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.food.feed(e.clientX, e.clientY);
      } else if (e.button === 2) {
        this.showHelp = !this.showHelp;
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // 键盘
    window.addEventListener('keydown', (e) => {
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
        case 'l':
          this.showLegend = !this.showLegend;
          break;
        case 'p':
          this.plantsEnabled = !this.plantsEnabled;
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
    this._initScene(pop);
  }

  setQuality(level) {
    this._quality = level;
  }

  // ── 植物接口（阶段 5-②）─────────────────────────────
  /** 重建植物群落：pond.setPlants({ lilypad: 12, reed: 30 }) */
  setPlants(pop) {
    this.plants.build(pop);
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
    this._render(now / 1000);

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt, time) {
    this.time = time;
    // 鱼群先算行为（需要彼此信息）
    const plantRef = this.plantsEnabled ? this.plants : null;
    for (const f of this.fishes) {
      f.flock(this.fishes, this.cursor, this.food.items, dt, plantRef);
    }
    for (const f of this.fishes) f.update(dt);

    // 乌龟
    for (const t of this.turtles) {
      t.update(dt, this.food.items, this.cursor, this.turtles);
    }

    // 食物
    this.food.update(dt);

    // ── 繁殖系统（阶段 5-③）──────────────────────────
    this._reproduce(dt);

    // 浮萍（被生物推开）
    const movers = [...this.turtles, ...this.fishes.map(f => ({ x: f.x, y: f.y, size: f.size }))];
    this.duckweed.update(dt, movers);

    // 植物（浮叶被推开 + 摇摆）
    this.plants.update(dt, time, movers);

    // 世界（涟漪）
    this.world.update(dt);
  }

  /** 鱼群繁殖判定：成年 + 饱食 + 同种邻近 + 冷却结束 + 上限内 */
  _reproduce(dt) {
    const G = CONFIG.growth;

    // ── 鱼：成对繁殖 ─────────────────────────────────
    if (this.fishes.length < G.fishCap) {
      for (const f of this.fishes) {
        if (!f.isAdult || f.hunger > G.reproHungerMax || f.reproCooldown > 0) continue;
        // 每秒约 fishReproChance 的概率（按 dt 折算到帧）
        if (Math.random() > G.fishReproChance * dt) continue;
        // 找同种成年邻居
        let mate = null;
        for (const o of this.fishes) {
          if (o === f || !o.isAdult || o.hunger > G.reproHungerMax) continue;
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

  _render(time) {
    const ctx = this.ctx;
    const { w, h } = this.world;

    ctx.clearRect(0, 0, w, h);

    // 背景天空（岸边之上）
    ctx.fillStyle = CONFIG.colors.sky;
    ctx.fillRect(0, 0, w, this.world.bankY);

    // 场景三区
    this.world.draw(ctx, time);

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

    // 生物
    for (const t of this.turtles) t.draw(ctx);
    for (const f of this.fishes) f.draw(ctx);

    // 3) 水面浮叶（睡莲/荷花）—— 画在生物之上，形成遮罩层次
    if (this.plantsEnabled) {
      this.plants.drawLayer(ctx, time, 'surface');
    }

    // HUD
    if (this.showHelp) this._drawHelp(ctx);
    if (this.showLegend) this._drawLegend(ctx);
    if (this.showStats) this._drawStats(ctx);
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
    ctx.fillText(
      `FPS ${this._curFps.toFixed(0)}  |  鱼 ${this.fishes.length}  龟 ${this.turtles.length}  食物 ${this.food.aliveCount}${extra ? '  |  ' + extra : ''}${this.paused ? '  |  ⏸ 已暂停' : ''}`,
      12, this.world.h - 12
    );
    ctx.restore();
  }

  _drawHelp(ctx) {
    const lines = [
      '🐢 乌龟水塘',
      '',
      '左键点击  →  投喂饲料',
      '移动鼠标  →  鱼群避让 / 乌龟好奇',
      '右键 / H  →  显示/隐藏帮助',
      '空格      →  暂停 / 继续',
      'F         →  全屏',
      '1~6       →  按品种添加小鱼',
      'T         →  增加乌龟',
      'L         →  物种列表',
      'P         →  显示/隐藏植物',
      '',
      '🌿 鱼吃饱会繁殖鱼苗，龟上岸会产蛋孵化',
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
  window.pondApp = new PondApp();

  // 控制台 API（也供将来 Lively 扩展调用）
  window.pond = {
    app: () => window.pondApp,
    /** 加鱼：pond.addFish(3, 'koi') 或 pond.addFish(1, 'koi', {baby:true}) */
    addFish: (n = 1, id = null, opts = {}) => window.pondApp.addFish(n, id, opts),
    /** 加龟：pond.addTurtle('redear') 或 pond.addTurtle('redear', {baby:true}) */
    addTurtle: (id = null, opts = {}) => window.pondApp.addTurtle(id, opts),
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
    /** 重建种群：pond.setPopulation({fish:{koi:5}, turtle:{redear:2}}) */
    setPopulation: (p) => window.pondApp.setPopulation(p),
    /** 投喂：pond.feed(x, y) */
    feed: (x, y) => window.pondApp.food.feed(x, y),
    pause: () => { window.pondApp.paused = true; },
    play: () => { window.pondApp.paused = false; },
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
  }
};
