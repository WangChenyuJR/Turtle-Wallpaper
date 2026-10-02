/**
 * 音效系统 —— 阶段 5-⑨
 *
 * 设计原则：
 *   · 零素材依赖 —— 全部用 Web Audio API 程序化合成（噪声 + 滤波 + 包络），
 *     不引入任何 mp3/ogg 文件，壁纸包体积不增加
 *   · 默认静音 —— 桌面上突然出声是骚扰；需用户在 Lively 设置里手动打开
 *   · 手势解锁 —— 浏览器自动播放策略要求首次用户交互后才能出声，
 *     首次点击/按键时自动 resume() 音频上下文
 *
 * 四类声音：
 *   feed    投喂落水 —— 短促"啵"+ 高频气泡尾音
 *   splash  乌龟入水 —— 中频水花噪声，带快速衰减
 *   rain    雨声     —— 棕噪声 + 低通，随雨强调整音量（持续底噪）
 *   frog    蛙鸣     —— 夜里稀疏的"呱"（三角波 + 快速频率下滑）
 *   ambient 环境底噪 —— 极轻的水下低频嗡鸣，让场景"活"起来
 */

import { CONFIG } from './config.js';
import { rand } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this._nodes = {};        // 持续音源（雨声/底噪）
    this._noiseBuf = null;   // 复用的白噪声缓冲
    this._frogTimer = rand(3, 8);
    this._rainTarget = 0;
    this._lastRainVol = -1;
  }

  get enabled() { return (CONFIG.audio?.enabled ?? true) && !(CONFIG.audio?.muted ?? true); }

  // ── 生命周期 ───────────────────────────────────────
  /** 首次用户手势时调用：创建/恢复 AudioContext */
  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? (CONFIG.audio?.masterVolume ?? 0.35) : 0;
      this.master.connect(this.ctx.destination);
      this._noiseBuf = this._makeNoise();
      this.unlocked = true;
      if (this.enabled) this._startAmbient();
      return true;
    } catch (e) {
      this.ctx = null;
      return false;
    }
  }

  /** 设置总音量 / 静音（Lively 属性 & 控制台调用） */
  setVolume(v) {
    CONFIG.audio.masterVolume = Math.max(0, Math.min(1, v));
    this._applyGain();
  }

  setMuted(m) {
    CONFIG.audio.muted = !!m;
    this._applyGain();
    if (!this.enabled) this._stopAmbient();
    else if (this.ctx) this._startAmbient();
  }

  _applyGain() {
    if (!this.master || !this.ctx) return;
    const v = this.enabled ? (CONFIG.audio?.masterVolume ?? 0.35) : 0;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  // ── 合成基元 ───────────────────────────────────────
  /** 2 秒白噪声缓冲（循环复用，避免每次重建） */
  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // 轻微棕化，听感更"水"
      last = (last + 0.02 * white) / 1.02;
      d[i] = white * 0.7 + last * 3.2;
    }
    return buf;
  }

  /** 造一个噪声源节点（自动播放一次后停止） */
  _noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = loop;
    return src;
  }

  /** 简易包络：快速起音 + 指数衰减 */
  _env(node, peak, attack, decay, t0) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  // ── ① 投喂落水 ─────────────────────────────────────
  /** @param {number} [strength=1] 0.6~1.4，按投喂量微调 */
  playFeed(strength = 1) {
    if (!this.enabled || !(CONFIG.audio?.feedSound ?? true)) return;
    if (!this.unlocked) this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // "啵" —— 带快速下滑的正弦（水滴声的经典做法）
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    const f0 = rand(680, 900) * (0.9 + strength * 0.1);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.09);
    this._env(g, 0.5 * strength, 0.004, 0.11, t);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.16);

    // 水花尾音（噪声 + 带通）
    const n = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(1600, 2400);
    bp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    this._env(ng, 0.16 * strength, 0.006, 0.13, t);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 0.2);
  }

  // ── ② 乌龟入水溅声 ─────────────────────────────────
  playSplash(strength = 1) {
    if (!this.enabled || !(CONFIG.audio?.splashSound ?? true)) return;
    if (!this.unlocked) this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // 水花：宽带噪声 + 低通扫频（从"哗"到"噗"）
    const n = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.32);
    const g = this.ctx.createGain();
    this._env(g, 0.34 * strength, 0.012, 0.34, t);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.5);

    // 低频"噗"的体感
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(150, 220), t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    this._env(og, 0.2 * strength, 0.01, 0.24, t);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
  }

  // ── ③ 蛙鸣（夜晚稀疏）─────────────────────────────
  playFrog() {
    if (!this.enabled || !(CONFIG.audio?.frogSound ?? true)) return;
    if (!this.unlocked || !this.ctx) return;
    const t = this.ctx.currentTime;

    // "呱" = 三角波 + 快速下滑 + 轻微颤音，连叫 1~3 声
    const times = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < times; i++) {
      const t0 = t + i * rand(0.16, 0.26);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      const base = rand(300, 430);
      osc.frequency.setValueAtTime(base, t0);
      osc.frequency.exponentialRampToValueAtTime(base * 0.62, t0 + 0.075);
      this._env(g, 0.075, 0.008, 0.075, t0);
      osc.connect(g).connect(this.master);
      osc.start(t0); osc.stop(t0 + 0.12);
    }
  }

  // ── ④ 雨声 / 环境底噪（持续音源）───────────────────
  _startAmbient() {
    if (!this.ctx || !this.master || this._nodes.rain) return;

    // 环境底噪：极轻的低频水声
    if (CONFIG.audio?.ambientSound ?? true) {
      const n = this._noiseSource(true);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const g = this.ctx.createGain();
      g.gain.value = 0.05;
      n.connect(lp).connect(g).connect(this.master);
      n.start();
      this._nodes.ambient = { src: n, gain: g };
    }

    // 雨声：单独一条，音量随雨强起伏
    const rn = this._noiseSource(true);
    const rlp = this.ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 2600;
    const rhp = this.ctx.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 380;
    const rg = this.ctx.createGain();
    rg.gain.value = 0;
    rn.connect(rhp).connect(rlp).connect(rg).connect(this.master);
    rn.start();
    this._nodes.rain = { src: rn, gain: rg };
    this._lastRainVol = -1;
  }

  _stopAmbient() {
    for (const k of Object.keys(this._nodes)) {
      try { this._nodes[k].src.stop(); } catch (e) { /* 已停 */ }
      delete this._nodes[k];
    }
  }

  // ── 每帧推进（由主循环调用）─────────────────────────
  /**
   * @param {number} dt
   * @param {{rain:boolean, isNight:boolean, rainIntensity:number}} env
   */
  update(dt, env = {}) {
    if (!this.ctx || !this.enabled) return;

    // 雨声音量渐入渐出（避免开关瞬间爆音）
    const want = env.rain ? 0.13 * Math.min(1, (env.rainIntensity ?? 1)) : 0;
    if (this._nodes.rain && Math.abs(want - this._lastRainVol) > 0.001) {
      this._nodes.rain.gain.gain.setTargetAtTime(want, this.ctx.currentTime, 0.9);
      this._lastRainVol = want;
    }

    // 蛙鸣：只在夜里、稀疏触发
    if (env.isNight) {
      this._frogTimer -= dt;
      if (this._frogTimer <= 0) {
        this._frogTimer = rand(4, 13);
        if (Math.random() < 0.55) this.playFrog();
      }
    } else {
      this._frogTimer = rand(3, 8);
    }
  }

  /** 状态摘要（控制台/测试用） */
  status() {
    return {
      enabled: this.enabled,
      muted: !!CONFIG.audio?.muted,
      unlocked: this.unlocked,
      volume: CONFIG.audio?.masterVolume ?? 0.35,
      nodes: Object.keys(this._nodes),
      state: this.ctx?.state ?? 'none',
    };
  }
}
