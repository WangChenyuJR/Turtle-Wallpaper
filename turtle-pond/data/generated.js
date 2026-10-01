// ══════════════════════════════════════════════════════════
//  由 tools/make_species.py 从照片自动生成
//  用法：把下面的条目粘贴进 src/species.js 对应字典，
//        或在运行时调用 registerFishSpecies()/registerTurtleSpecies()
// ══════════════════════════════════════════════════════════

// ── 由照片生成的鱼品种 ──────────────────────────────
export const PHOTO_FISH_SPECIES = {
  fishSample: {
    id: 'fishSample',
    label: 'fish_sample',
    body: '#b6541a',
    fin: '#c29c78',
    stripes: 1,
    belly: '#c19b75',
    sizeScale: 1.0,
    speedScale: 1.0,
    weight: 1,
    _photo: 'fish_sample.jpg',
  },
};

// ── 由照片生成的龟品种 ──────────────────────────────
export const PHOTO_TURTLE_SPECIES = {
  turtleSample: {
    id: 'turtleSample',
    label: 'turtle_sample',
    habitat: 'terrestrial',
    shell: '#60853b',
    limb: '#526d33',
    head: '#5d7f3b',
    pattern: 'smooth',
    markColor: '#ab301f',
    shellLight: '#7b9c5b',
    sizeScale: 1.0,
    speedScale: 1.0,
    weight: 1,
    _photo: 'turtle_sample.jpg',
  },
};

// ── 一键注册（配合 registerFishSpecies / registerTurtleSpecies）──
export function registerPhotoSpecies(reg) {
  Object.values(PHOTO_FISH_SPECIES).forEach(reg.registerFishSpecies);
  Object.values(PHOTO_TURTLE_SPECIES).forEach(reg.registerTurtleSpecies);
}
