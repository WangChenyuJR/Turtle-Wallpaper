/**
 * turtle-sprite.js — AI 拆件骨骼装配渲染器（paper-doll rig）
 *
 * 素材：assets/creatures/turtle/sprites/<species>/<view>/{head,shell,tail,legFL,...}.png + manifest.json
 * manifest 由 _sprite_cut.mjs 生成：每件含 bbox（在原姿势图中的位置）与 anchor（关节点，原图坐标）。
 *
 * 设计要点：
 *  - 帧间零漂移：没有"帧"，动画全部由关节旋转/平移参数化，状态机直接驱动
 *  - loadImage 可注入（Node 侧诊断用桩），默认浏览器 Image
 *  - 绘制顺序 = 拼装层级：远层肢体 → 壳 → 头（壳盖住肢根与颈根接缝）
 *  - size 参数 = 壳长（像素）；姿态参数全部可选，缺省为 idle
 */

const PART_DRAW_ORDER = {
  top:  ['tail', 'legHL', 'legHR', 'legFL', 'legFR', 'head', 'shell'],
  side: ['tail', 'legHL', 'legHR', 'legFL', 'legFR', 'shell', 'head'],
};

const TAU = Math.PI * 2;

/** 已有拆件素材的品种目录名（新增品种切件后在此登记）——当前覆盖全部内置龟种 */
export const SPRITE_SPECIES = [
  'yellowthroat', 'helmetedSideNeck', 'caramelSlider',
  'goldLineReeves', 'redbellySideNeck', 'terrapin',
  'redear', 'yellowpond', 'chinese',
  'softshell', 'mapTurtle', 'mata', 'burmese',
];

/**
 * 全局精灵注册表：预加载 + 同步查询（未就绪返回 null，调用方降级到程序化画法）
 */
export const TurtleSprites = {
  _map: new Map(),          // key: `${species}/${view}` -> TurtleSprite | 'failed'
  _jobs: new Map(),         // key -> 加载 Promise（重复 preload 复用同一个，避免"还没加载完就以为完了"）
  /**
   * 预加载一批品种的部件。可安全重复调用（已加载/加载中跳过）。
   * 若该 key 正在加载，返回的是**同一个** Promise（调用方可以借此在就绪后补画）。
   * @param {string[]} speciesList 品种目录名
   * @param {string|string[]} views 'top'|'side' 或数组
   * @param {object} [opts] 透传 TurtleSprite（loadImage 桩等，Node 诊断用）
   */
  preload(speciesList, views = 'side', opts = {}) {
    const vs = Array.isArray(views) ? views : [views];
    const jobs = [];
    for (const sp of speciesList) for (const v of vs) {
      const key = `${sp}/${v}`;
      if (this._map.has(key)) {
        const pending = this._jobs.get(key);
        if (pending) jobs.push(pending);   // 已在加载中：把同一个 Promise 还给调用方
        continue;
      }
      const sprite = new TurtleSprite({ species: sp, view: v, ...opts });
      this._map.set(key, sprite);   // 先占位，防止重复启动
      const job = sprite.load().catch((e) => {
        console.warn('[turtle-sprite] 部件加载失败，降级程序化画法:', key, e?.message || e);
        this._map.set(key, 'failed');
      });
      this._jobs.set(key, job);
      jobs.push(job);
    }
    return Promise.all(jobs);
  },
  /** 同步取已就绪的精灵；未加载/加载中/失败/未就绪 → null */
  get(species, view = 'side') {
    const s = this._map.get(`${species}/${view}`);
    return s && s !== 'failed' && s.ready ? s : null;
  },
};

export class TurtleSprite {
  /**
   * @param {object} opts
   * @param {string} opts.species  品种目录名，如 'yellowthroat'
   * @param {string} opts.view     'top' | 'side'
   * @param {string} [opts.base]   素材根路径，默认 'assets/creatures/turtle/sprites/'
   * @param {function} [opts.loadImage] (url) => Promise<{width,height,img}> 可注入桩
   */
  constructor(opts) {
    this.species = opts.species;
    this.view = opts.view;
    this.base = opts.base || 'assets/creatures/turtle/sprites/';
    this.loadImage = opts.loadImage || ((url) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res({ width: im.naturalWidth, height: im.naturalHeight, img: im });
      im.onerror = () => rej(new Error('img load fail: ' + url));
      im.src = url;
    }));
    this.parts = {};        // name -> {img, w, h, ax, ay, ox, oy}（ax/ay=关节在部件图内坐标；ox/oy=部件左上角在身体坐标系中的位置，原点=壳锚点）
    this.shellAnchor = [0, 0];
    this.shellLen = 0;      // 壳部件原始宽度（用于 size 归一化）
    this.bbox = null;       // 身体坐标系包围盒（原图像素，原点=壳锚点）→ fitInto 用
    this.ready = false;
  }

  async load() {
    const dir = `${this.base}${this.species}/${this.view}/`;
    const res = await fetch(dir + 'manifest.json');
    const manifest = await res.json();
    // 先并发加载全部部件图，再统一计算坐标（ox/oy 依赖壳锚点，与加载完成顺序无关）
    const entries = Object.entries(manifest.parts);
    const loaded = await Promise.all(entries.map(([name, info]) =>
      this.loadImage(dir + info.file).then((r) => ({ name, info, r }))));
    this.parts = {};
    const shellEntry = loaded.find(e => e.name === 'shell');
    if (shellEntry) {
      this.shellAnchor = shellEntry.info.anchor.slice();
      this.shellLen = shellEntry.info.bbox[2] - shellEntry.info.bbox[0] + 1;
    }
    this.rig = manifest.rig || 'inplace';
    for (const { name, info, r } of loaded) {
      // 关节应落点（身体坐标系，原点=壳锚点）：
      //  inplace：部件在原姿势图原位 → 关节 = anchor − 壳锚点
      //  explode：部件在空中 → 关节对齐到壳上挂点 slot − 壳锚点
      const useSlot = this.rig === 'explode' && info.slot;
      const jx = useSlot ? info.slot[0] : info.anchor[0];
      const jy = useSlot ? info.slot[1] : info.anchor[1];
      this.parts[name] = {
        img: r.img, w: r.width, h: r.height,
        ax: info.anchor[0] - info.bbox[0],
        ay: info.anchor[1] - info.bbox[1],
        jpx: jx - this.shellAnchor[0],
        jpy: jy - this.shellAnchor[1],
      };
    }
    // 中立姿态下全部部件的并集包围盒（原图像素，原点=壳锚点）
    // 面板缩略图据此自适应缩放/居中；姿态摆动幅度远小于 fitInto 的留白
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of Object.values(this.parts)) {
      bx0 = Math.min(bx0, p.jpx - p.ax);
      by0 = Math.min(by0, p.jpy - p.ay);
      bx1 = Math.max(bx1, p.jpx - p.ax + p.w);
      by1 = Math.max(by1, p.jpy - p.ay + p.h);
    }
    this.bbox = Number.isFinite(bx0) ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null;
    this.ready = true;
    return this;
  }

  /**
   * 把整只龟按"并集包围盒"缩放居中进 w×h 的矩形（面板图鉴格用）。
   * 返回可直接喂给 draw() 的 { x, y, size }；未就绪返回 null。
   * @param {number} w 目标宽（px）
   * @param {number} h 目标高（px）
   * @param {number} [pad] 四周留白比例（0.88 = 内容占 88%）
   */
  fitInto(w, h, pad = 0.88) {
    if (!this.ready || !this.bbox || !this.shellLen) return null;
    const b = this.bbox;
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const fit = Math.min(w * pad / bw, h * pad / bh);   // 原图像素 → 画布像素
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { size: this.shellLen * fit, x: w / 2 - cx * fit, y: h / 2 - cy * fit };
  }

  /**
   * 绘制一只龟
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} p
   *   x, y        身体中心（壳 anchor）落点
   *   size        壳长（px）
   *   angle       朝向（弧度，0 = 朝右；top 视图 0 = 头朝右）
   *   time        秒
   *   state       'swim' | 'walk' | 'idle' | 'eat'
   *   speed       0~1 运动强度（影响摆幅与频率）
   *   neckExt     0~1 伸颈（吃食）
   *   bite        0~1 咬食动作相位
   *   headScale   头部额外缩放（幼体大头）
   *   alpha       整体透明度
   */
  draw(ctx, p) {
    if (!this.ready) return;
    const parts = this.parts;
    const k = p.size / (this.shellLen || 1);
    const t = p.time || 0;
    const state = p.state || 'idle';
    const speed = p.speed ?? 1;

    // ── 各状态的动作参数 ──
    let legFreq, legAmp, tailFreq, tailAmp, headAmp;
    if (state === 'swim') {
      legFreq = 1.7; legAmp = 0.42; tailFreq = 0.9; tailAmp = 0.22; headAmp = 0.05;
    } else if (state === 'walk') {
      legFreq = 0.8; legAmp = 0.26; tailFreq = 0.5; tailAmp = 0.10; headAmp = 0.07;
    } else if (state === 'eat') {
      legFreq = 0.4; legAmp = 0.10; tailFreq = 0.4; tailAmp = 0.08; headAmp = 0;
    } else {
      legFreq = 0.25; legAmp = 0.04; tailFreq = 0.3; tailAmp = 0.05; headAmp = 0.02;
    }
    const ph = p.phase !== undefined
      ? p.phase                       // 相位直通：由调用方状态机积分驱动（flipperPhase/stridePhase）
      : t * legFreq * TAU * (0.4 + 0.6 * speed);
    const tp = p.tailPhase !== undefined ? p.tailPhase : t * tailFreq * TAU;
    const breathe = state === 'idle' ? 1 + 0.012 * Math.sin(t * 1.1) : 1;

    // 前爪对摆（俯视） / 同摆（侧视：部件已含近远爪成对）；legAmp = 外部调幅乘子（潜水/上浮等）
    const ampMul = p.legAmp ?? 1;
    const swing = (offset) => Math.sin(ph + offset) * legAmp * (0.35 + 0.65 * speed) * ampMul;
    const legRot = {
      legFL: state === 'walk' ? swing(0) : swing(0),
      legFR: state === 'walk' ? swing(Math.PI) : swing(Math.PI),
      legHL: state === 'walk' ? swing(Math.PI) : swing(Math.PI * 0.9),
      legHR: state === 'walk' ? swing(0) : swing(-0.1 * Math.PI),
    };
    const tailRot = Math.sin(tp) * tailAmp * (0.4 + 0.6 * speed);
    const neckExt = Math.max(0, Math.min(1, p.neckExt || 0));
    const bite = Math.max(0, Math.min(1, p.bite || 0));
    // 头部微摆相位：可直通（headPhase，与腿/尾同源的状态机相位）；缺省用真实时间
    const hp = p.headPhase !== undefined ? p.headPhase : t * 1.3;
    const headRot = Math.sin(hp) * headAmp
      + (this.view === 'side' ? -0.28 * neckExt + 0.18 * Math.sin(bite * Math.PI) * neckExt : 0);
    // 伸颈平移：部件坐标系（原图像素）中向上(-y)伸出；外层已有 scale(k)，不再乘 k
    const headDx = 0;
    const headDy = -neckExt * 0.05 * this.shellLen;

    // ── 变换组装 ──
    ctx.save();
    if (p.alpha !== undefined) ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle || 0);
    ctx.scale(k * breathe, k * breathe);

    for (const name of PART_DRAW_ORDER[this.view]) {
      const part = parts[name];
      if (!part) continue;
      ctx.save();
      // 部件关节应落点（shell 恰为原点 0,0）；旋转/平移都绕关节
      ctx.translate(part.jpx, part.jpy);
      if (name === 'head') {
        ctx.translate(headDx, headDy);
        ctx.rotate(headRot);
        const hs = p.headScale || 1;
        if (hs !== 1) ctx.scale(hs, hs);
      } else if (name === 'tail') {
        ctx.rotate(tailRot);
      } else if (legRot[name] !== undefined) {
        ctx.rotate(legRot[name]);
      }
      ctx.translate(-part.ax, -part.ay);
      ctx.drawImage(part.img, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
