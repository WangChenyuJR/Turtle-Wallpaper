/**
 * 天气系统 —— 阶段 5-⑤
 *
 * 三状态随机轮换：
 *
 *   sunny 晴天 ──(35%)──► rain 小雨 ──► afterRain 雨后 ──► sunny
 *      ▲                                                          │
 *      └──────────────────────────────────────────────────────────┘
 *
 * 效果：
 *   · rain：雨丝下落 + 水面密集涟漪 + 阴天色罩 + 每隔几秒"雨水冲落"天然食物
 *   · afterRain：清新淡罩 + 余波涟漪渐稀
 *   · 龟雨天不晒背（env.rain 传入状态机）
 */

import { CONFIG } from './config.js';
import { rand } from './utils.js';

export const WEATHER_LABELS = {
  sunny: '晴天', rain: '小雨', afterRain: '雨后',
};
export const WEATHER_ICONS = {
  sunny: '☀️', rain: '🌧️', afterRain: '💧',
};

export class Weather {
  constructor(initialState = null) {
    this.state = initialState ?? 'sunny';
    this.timer = this._duration(this.state);
    this.intensity = rand(0.55, 1.0);     // 雨强（影响雨滴数量）
    this.drops = [];                      // 活动雨滴
    this._foodTimer = 0;                  // 雨天天然投喂计时
    // 每帧由 main 更新的回调（雨天掉食物用）
    this.onRainFoodDrop = null;
  }

  _duration(state) {
    switch (state) {
      case 'rain':      return rand(60, 180);
      case 'afterRain': return rand(120, 300);
      default:          return rand(240, 600);   // sunny
    }
  }

  /** 外部强制切换（W 键 / URL 参数 / 控制台） */
  set(state) {
    if (!WEATHER_LABELS[state]) return false;
    if (state === 'rain') this._spawnCloudSeeds();
    this.state = state;
    this.timer = this._duration(state);
    return true;
  }

  _spawnCloudSeeds() {
    this.intensity = rand(0.55, 1.0);
    this.drops.length = 0;
  }

  update(dt, world) {
    this.timer -= dt;
    if (this.timer <= 0) this._transition();

    if (this.state === 'rain') {
      // 生成雨滴（强度 × 密度）
      const spawnN = Math.round(9 * this.intensity);
      for (let i = 0; i < spawnN; i++) {
        this.drops.push(this._newDrop(world));
      }
      // 雨滴下落 + 撞水面
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const waterLine = world.bankLineAt(d.x) + 4;
        if (d.y >= waterLine) {
          // 落水：小涟漪（不频繁，控制成本）
          if (Math.random() < 0.25) world.addRipple(d.x, d.y, 0.4);
          this.drops.splice(i, 1);
        }
      }
      if (this.drops.length > 220) this.drops.splice(0, this.drops.length - 220);

      // 雨水冲落天然食物
      this._foodTimer -= dt;
      if (this._foodTimer <= 0 && this.onRainFoodDrop) {
        this._foodTimer = CONFIG.weather.rainFoodDropInterval * rand(0.7, 1.3);
        const fx = rand(world.w * 0.1, world.w * 0.9);
        if (world.isWater(fx, world.bankLineAt(fx) + 24)) {
          this.onRainFoodDrop(fx);
        }
      }
    } else {
      // 非雨天清空雨滴
      this.drops.length = 0;
    }
  }

  _newDrop(world) {
    return {
      x: rand(-40, world.w + 40),
      y: rand(-60, -4),
      vx: rand(-90, -50),                 // 微斜
      vy: rand(430, 560),
      len: rand(7, 13),
    };
  }

  _transition() {
    switch (this.state) {
      case 'sunny':
        if (Math.random() < 0.35) {
          this.state = 'rain';
          this._spawnCloudSeeds();
        }
        this.timer = this._duration(this.state);
        break;
      case 'rain':
        this.state = 'afterRain';
        this.timer = this._duration('afterRain');
        break;
      default:
        this.state = 'sunny';
        this.timer = this._duration('sunny');
        break;
    }
  }

  // ── 渲染 ─────────────────────────────────────────────
  /** 阴天/雨后色罩（在昼夜罩之后调用） */
  drawTint(ctx, world) {
    if (this.state === 'rain') {
      ctx.fillStyle = 'rgba(38,48,68,0.26)';
      ctx.fillRect(0, 0, world.w, world.h);
    } else if (this.state === 'afterRain') {
      ctx.fillStyle = 'rgba(38,48,68,0.07)';
      ctx.fillRect(0, 0, world.w, world.h);
    }
  }

  /** 雨丝（在最上层内容之上画） */
  drawRain(ctx, world) {
    if (this.state !== 'rain' || this.drops.length === 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(205,225,245,0.38)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (const d of this.drops) {
      const t = d.vy / 500;             // 斜率随速度
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.vx * (d.len / d.vy) * 2.2, d.y + d.len);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 状态栏摘要 */
  get summary() {
    return `${WEATHER_ICONS[this.state]} ${WEATHER_LABELS[this.state]}`;
  }
}
