# 🐢 乌龟水塘 · Turtle Pond

动态桌面壁纸原型 —— 一个有岸边、水面、泥沼三区的小水塘，乌龟和小鱼在里面生活。
配合 [Lively Wallpaper](https://github.com/rocksdanister/lively) 使用，即可作为 Windows 动态壁纸运行。

![预览](_shot.png)

## 功能

| 功能 | 说明 |
|------|------|
| 三区场景 | 岸边（沙地/草丛/石头）+ 水面 + 泥沼（气泡/浑浊） |
| 鱼群 Boids | 分离/对齐/凝聚 + 避墙 + 避光标，4 个品种（鲫鱼/锦鲤/青鱼/白鲦） |
| 乌龟状态机 | 水面游动 → 追食物 → 爬上岸 → 晒太阳/爬行 → 回水 |
| 投喂系统 | 点击水面撒 10 颗饲料，下沉、被抢食、超时溶解 |
| 浮萍 | 漂浮植物，被生物推开 |
| 涟漪 | 光标划过水面 / 投喂时产生 |
| 性能策略 | 页面不可见自动暂停；帧率统计 |
| Lively 属性面板 | 小鱼数/乌龟数/浮萍密度/水色/画质/帧率显示 |

## 本地预览

ES Module 需要通过 HTTP 访问（直接双击 index.html 会被 CORS 拦）：

```bash
cd turtle-pond
python -m http.server 8777
# 浏览器打开 http://127.0.0.1:8777
```

## 设为桌面壁纸（Lively）

1. 打开 Lively Wallpaper
2. 把**整个 `turtle-pond` 文件夹**拖进 Lively 窗口（或点 `+ Add Wallpaper` → 选文件夹）
3. 选中它 → 壁纸生效
4. 右键壁纸 → **自定义**，可调节小鱼数量、乌龟数量、水色等（对应 `LivelyProperties.json`）

> Lively 用 WebView2 的虚拟主机映射加载本地文件，ES Module 可以正常工作。

## 操作（浏览器/壁纸通用）

| 按键 | 作用 |
|------|------|
| 左键点击 | 投喂饲料 |
| 移动鼠标 | 鱼群避让、乌龟好奇跟随 |
| 右键 / H | 显示/隐藏帮助 |
| 空格 | 暂停/继续 |
| F | 全屏 |
| + / - | 增/减小鱼 |
| T | 增加乌龟 |

## 项目结构

```
turtle-pond/
├── index.html              # 入口
├── LivelyProperties.json   # Lively 设置面板定义
├── src/
│   ├── main.js             # 主循环 + 交互 + Lively 属性接口
│   ├── config.js           # 所有可调参数集中于此
│   ├── world.js            # 三区地形 + 涟漪 + 渲染
│   ├── fish.js             # 鱼群 Boids
│   ├── turtle.js           # 乌龟状态机
│   ├── duckweed.js         # 浮萍
│   ├── food.js             # 饲料系统
│   └── utils.js            # 数学工具
└── assets/                 # （预留）美术素材
```

## 下一阶段（对应工作文档）

- [ ] 阶段 3：配置文件驱动物种系统（运行时增删品种）
- [ ] 阶段 4：桌面图标互动（Python 读图标坐标 → WebSocket → 场景）
- [ ] 阶段 5：生态循环（成长/繁殖）、昼夜天气、音效
- [ ] 3D 升级（可选）：复用 deskworlds 场景
