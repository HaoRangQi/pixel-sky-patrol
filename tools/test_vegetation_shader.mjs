import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/30_shaders.js', import.meta.url), 'utf8');
const { MESH_VS: mesh } = vm.runInNewContext(`${source}; ({ MESH_VS });`);
const branch = mesh.match(/if \(uInstanced > 0\.5\) \{([\s\S]*?)\} else \{([\s\S]*?)\n  \}/);
const tree = branch?.[1] ?? '';
const ordinary = branch?.[2] ?? '';
const normalize = v => v.map(x => x / Math.hypot(...v));
const close = (actual, expected) => actual.forEach((n, i) => assert(Math.abs(n - expected[i]) < 1e-9, `${actual} != ${expected}`));

// Execute the shader's scalar transform expressions, not a second reference implementation.
function components(expression, scope) {
  return expression.split(',').map(component => vm.runInNewContext(component, scope));
}
function vector(name, scope) {
  const expression = tree.match(new RegExp(`vec[23] ${name} = (?:normalize\\()?vec[23]\\(([\\s\\S]*?)\\);`));
  assert(expression, `缺少 ${name} 实例变换`);
  return components(expression[1].replace(/\)\s*$/, ''), scope);
}
function xyz(v) { return { x: v[0], y: v[1], z: v[2] }; }

test('实例属性与 uniform 保持跨 renderer/forest 的 location4/5 契约', () => {
  assert(/layout\(location\s*=\s*4\) in vec4 aInstance;/.test(mesh), '缺少 location4 的世界坐标/相对高度属性');
  assert(/layout\(location\s*=\s*5\) in vec4 aVariation;/.test(mesh), '缺少 location5 的朝向/冠宽/亮度属性');
  assert(/uniform float uInstanced;/.test(mesh), '缺少 uInstanced 开关');
  assert(branch, '实例树与普通网格必须分离变换和光照');
});

test('世界尺寸树仅乘相对 heightScale/冠宽，先缩放再按约定方向绕 Y 旋转', () => {
  assert(/vec3 local = aPos \* instanceScale;/.test(tree), '树模型不是单位高度，不能再乘模型高度');
  assert(/wp = vec4\(rotated\.x \+ aInstance\.x, local\.y \+ aInstance\.y, rotated\.y \+ aInstance\.z, 1\.0\);/.test(tree), '实例坐标必须直接进入世界空间');
  assert(!/uModel/.test(tree), '实例树不能再乘 uModel');
  for (const heightScale of [0.8, 1.25]) {
    const scope = { aInstance: { w: heightScale }, aVariation: { x: 0, y: 1, z: 0.7 } };
    const scale = vector('instanceScale', scope);
    close(scale, [heightScale * 0.7, heightScale, heightScale * 0.7]);
    scope.local = xyz([2, 38, 3].map((x, i) => x * scale[i]));
    const rotated = vector('rotated', scope);
    close(rotated, [3 * heightScale * 0.7, -2 * heightScale * 0.7]);
    assert(scope.local.y >= 30 && scope.local.y <= 48, '世界尺寸模型被重复放大或错当单位模型');
  }
});

test('非均匀冠宽缩放使用逆缩放法线，再做相同的 Y 旋转', () => {
  assert(/vec3 localNormal = aNor \/ instanceScale;/.test(tree), '法线必须用非均匀缩放的逆变换');
  assert(/n = normalize\(rotatedNormal\);/.test(tree), '旋转后的法线必须归一化');
  const scale = [0.56, 0.8, 0.56];
  const localNormal = [1 / scale[0], 1 / scale[1], 0];
  const rotated = vector('rotatedNormal', {
    aVariation: { x: 0, y: 1 }, localNormal: xyz(localNormal)
  });
  close(normalize(rotated), normalize([0, 1 / 0.8, -1 / 0.56]));
  const tangent = [0, 0.8, 0.56];
  assert(Math.abs(rotated.reduce((sum, x, i) => sum + x * tangent[i], 0)) < 1e-9, '变换法线与表面不再正交');
});

test('树只用底色调制的中性光照，4~30米局部高度产生冠底遮蔽而非根部 rim', () => {
  assert(/smoothstep\(4\.0, 30\.0, aPos\.y\)/.test(tree), '冠底遮蔽应使用模型米制局部高度，而非单位高度或世界海拔');
  assert(/base = aCol \* uTint \* aVariation\.w \* treeTone \* canopyOcclusion;/.test(tree), '树光照必须保留底色并应用实例亮度');
  assert(!/base\s*\+=|rim|vec3\(0\.045|vec3\(0\.32/.test(tree), '树分支仍叠加白蓝填充或根部 rim');
  assert(/vCol = mix\(base, emissive, aEmi \* \(1\.0 - uInstanced\)\);/.test(mesh), '树实例不能混入普通网格的自发光加色');
  assert(!/floor\(/.test(tree), '树光照应平滑而非色阶高光');
});

test('普通飞机继续使用原 uModel、色阶、发光与受 uRim 控制的边缘光', () => {
  assert(/wp = uModel \* vec4\(aPos, 1\.0\);/.test(ordinary), '普通网格 uModel 路径丢失');
  assert(/n = normalize\(mat3\(uModel\) \* aNor\);/.test(ordinary), '普通网格法线行为被改动');
  assert(/float q = floor\(clamp\(ndl \* 0\.5 \+ 0\.5, 0\.0, 1\.0\) \* 3\.0\) \/ 2\.0;/.test(ordinary), '飞机原有色阶着色被改动');
  assert(/base \+= vec3\(0\.32, 0\.39, 0\.50\) \* rim \* 0\.75 \* uRim;/.test(ordinary), 'uRim 必须实际控制普通网格边缘光');
  assert(/base \+= vec3\(0\.08, 0\.08, 0\.07\) \* warm;/.test(ordinary), '飞机原有直接光被改动');
  assert(/base \+= vec3\(0\.045, 0\.050, 0\.080\);/.test(ordinary), '飞机原有填充光被改动');
  assert(/vCol = mix\(base, emissive, aEmi \* \(1\.0 - uInstanced\)\);/.test(mesh), '普通网格应保留原发光混合，同时抑制树实例自发光');
  assert(/gl_Position = uVP \* wp;/.test(mesh), '缺少世界到裁剪空间变换');
});
