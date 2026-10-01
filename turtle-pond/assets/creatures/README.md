# 生物图片资源目录

存放各龟/鱼品种的图片（参考图、缩略图、可选贴图）。

## 目录

```
assets/creatures/
├── turtle/   龟类图片
└── fish/     鱼类图片
```

## 命名规范

```
<id>_<view>.png
```

- `<id>` —— 品种 id，与 `src/species.js` / `src/data/species-research.js` 一致
- `<view>` —— `top` 俯视 / `side` 侧视 / `front` 正视

**示例**
```
turtle/redear_top.png              巴西红耳龟 俯视
turtle/yellowthroat_side.png       黄喉拟水龟 侧视
turtle/terrapinOrnate_top.png      锦钻纹龟 俯视
fish/zebrafish_side.png            斑马鱼 侧视
```

## 品种 id 一览

**龟（19）**
`redear` `caramelSlider` `chinese` `goldLineReeves` `yellowthroat` `mapTurtle`
`softshell` `mata` `yellowpond` `burmese` `helmetedSideNeck` `redbellySideNeck`
`terrapin` `terrapinCarolina` `terrapinMississippi` `terrapinTexas` `terrapinOrnate`
`terrapinMangrove` `terrapinEastFlorida`

**鱼（10）**
`crucian` `koi` `grasscarp` `whitebait` `goldfish` `gambusia`
`guppy` `zebrafish` `betta` `neonTetra`

## 获取方式

见 `../../../docs/reference/图片素材获取指南.md`（含 AI 提示词模板、CC0 来源清单、版权红线）。

## 注意

- 图片放入后请在项目根 `CREDITS.md` 登记来源与协议。
- 当前项目为 Canvas 2D 矢量绘制，图片**非必需**，主要用于参考与 UI 缩略图。
