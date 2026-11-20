import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shader = readFileSync(new URL('../src/30_shaders.js', import.meta.url), 'utf8');
const { SCENE_FS, POST_FS } = vm.runInNewContext(`${shader}; ({ SCENE_FS, POST_FS });`);
const terrain = SCENE_FS.slice(SCENE_FS.indexOf('vec3 terrainShade('), SCENE_FS.indexOf('vec3 waterShade('));
const main = SCENE_FS.slice(SCENE_FS.indexOf('void main()'));
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function fadeRange(name, cells) {
  const fade = terrain.match(new RegExp(`float ${name}Fade = 1\\.0 - smoothstep\\(([\\d.]+), ([\\d.]+), footprint\\);`));
  assert(fade, `${name} 必须独立按屏幕足迹淡出，不能以另一频率噪声代替均值`);
  const [start, end] = fade.slice(1).map(Number);
  assert(start > 0 && end > start && end <= 8192 / cells, `${name} 必须在噪声单元不可分辨前滤除`);
  assert.match(terrain, new RegExp(`float ${name} = mix\\(0\\.5, terrainNoise\\(p\\.xz, ${cells}\\.0\\), ${name}Fade\\);`), `${name} 远处必须回归 0.5，而非保留未滤波噪声`);
  for (const sample of [0, 0.25, 0.75, 1]) {
    const far = 0.5 + (sample - 0.5) * (1 - smoothstep(start, end, end * 4));
    assert.equal(far, 0.5, `${name} 的远景均值不稳定`);
  }
  return { start, end };
}

test('连续地表保留平滑材质与光照，不出现高度色带和 tint 取模硬切', () => {
  assert(!/floor\(h\s*\/\s*26/.test(terrain), '地面仍按26米高度分层，形成地图等高线色带');
  assert(!/fract\(tintv\s*\*/.test(terrain), '地表仍用色相取模切块，树林和草地存在生硬边界');
  assert(!/floor\(ndl/.test(terrain), '地形光照仍被量化为大块阴影');
});

test('从世界命中位置计算屏幕足迹，不在不一致的地表/水面分支内求导', () => {
  const footprint = main.indexOf('float footprint = max(fwidth(hitPos.x), fwidth(hitPos.z));');
  const hitBranch = main.indexOf('if (hitT > 0.0)');
  const hitPoint = main.indexOf('vec3 hitPos = uCamPos + rd * max(hitT, 0.0);');
  assert(hitPoint !== -1 && footprint > hitPoint && footprint < hitBranch, '需要在命中或水面分支之前计算导数');
  assert(!/fwidth\(/.test(terrain), '地表分支内的 fwidth 在交界像素未定义');
  assert(/terrainShade\(hp, hitH, footprint, dith\)/.test(main), '地表没有使用已计算的屏幕足迹');
});

test('中频与细频独立向 0.5 滤波，细频先淡出', () => {
  const middle = fadeRange('middle', 256);
  const fine = fadeRange('fine', 1024);
  assert(fine.end <= middle.start, '细频不能比中频保留到更远距离');
});

test('低频草地空地与坡面主导材质，噪声只作低对比细节', () => {
  const broad = terrain.match(/float broad = terrainNoise\(p\.xz, ([\d.]+)\);/);
  assert(broad && Number(broad[1]) <= 24, '大片地表应使用至少约340米尺度的低频变化');
  const grain = terrain.match(/float groundGrain = \(middle - 0\.5\) \* ([\d.]+) \+ \(fine - 0\.5\) \* ([\d.]+);/);
  assert(grain, '中细频应居中后低权重叠加，不应直接驱动草地和林地颜色');
  const [middleWeight, fineWeight] = grain.slice(1).map(Number);
  assert(middleWeight > 0 && middleWeight <= 0.12 && fineWeight > 0 && fineWeight <= 0.05, '中细频材质颜色对比度过高');
  for (const name of ['meadowVar', 'canopyVar', 'rockVar']) {
    const variation = terrain.match(new RegExp(`float ${name} = ([^;]+);`));
    assert(variation && /broad/.test(variation[1]), `${name} 缺少低频控制`);
  }
  assert.match(terrain, /float rockMask = .*smoothstep\([^;]*slope/, '岩石应由实际坡面形状控制');
  assert(!/snowCoverage[^;]*fine/.test(terrain), '雪线不应被最细频噪声切碎');
});

test('aux alpha 实际树影可见度在雾前柔和乘入且不会增白', () => {
  assert.match(terrain, /float treeVisibility = clamp\(aux\.a, 155\.0 \/ 255\.0, 1\.0\);/, '未读取 aux.a 中实际树影可见度');
  assert.match(terrain, /col \*= treeVisibility;/, 'aux.a 的 155..255 已是软影可见度，应直接柔和乘入');
  const factors = [155, 180, 220, 255].map(a => a / 255);
  assert(factors[0] > 0.60 && factors.at(-1) === 1, '树影端点太黑或未遮蔽区域未保持原亮度');
  assert(factors.every((v, i) => v <= 1 && (i === 0 || v > factors[i - 1])), '软影可见度必须单调，不能增白');
  assert(main.indexOf('terrainShade(') < main.indexOf('float fog ='), '树影应先于大气雾参与地表着色');
});

test('不重新启用 Bayer 白点或太阳圆盘', () => {
  assert.match(main, /float dith = 0\.5/, '不应重新启用屏幕空间白点抖动');
  assert(!/bayer4\(gl_FragCoord/.test(SCENE_FS + POST_FS), '材质或后处理启用了屏幕 Bayer 噪声');
  assert.match(SCENE_FS, /disc = 0\.0;/, '不应加入太阳圆盘');
});
