import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const original = readFileSync(new URL('../src/30_shaders.js', import.meta.url), 'utf8');
const adapterURL = new URL('../sky-patrol/35_autumn_pixels.js', import.meta.url);
// 与正式新版构建使用相同的可变 shader 声明。
const mutable = original.replace(/^const (SCENE_FS|CLOUD_FS|POST_FS|MESH_VS|MESH_FS) =/gm, 'let $1 =');
const result = '({ FULLSCREEN_VS, SCENE_FS, CLOUD_FS, POST_FS, MESH_VS, MESH_FS })';
const baseline = vm.runInNewContext(`${mutable}; ${result}`);
function adapter() {
  assert.ok(existsSync(adapterURL), 'Missing implementation: sky-patrol/35_autumn_pixels.js must transform the real WebGL shaders');
  return readFileSync(adapterURL, 'utf8');
}
function transformed() {
  return vm.runInNewContext(`${mutable}\n${adapter()}\n${result}`);
}
function block(source, anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `Missing shader block: ${anchor}`);
  const opening = source.indexOf('{', start);
  let depth = 1, end = opening + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  assert.equal(depth, 0, `Unbalanced shader block: ${anchor}`);
  return source.slice(start, end);
}

test('adapter transforms the landscape and tree materials without altering the aircraft vertex branch', () => {
  new vm.Script(adapter(), { filename: fileURLToPath(adapterURL) });
  new vm.Script(`${mutable}\n${adapter()}`, { filename: 'standalone-autumn-shaders.js' });
  const actual = transformed();
  for (const name of ['SCENE_FS', 'CLOUD_FS', 'POST_FS']) {
    assert.notEqual(actual[name], baseline[name], `${name} must actually change at load time`);
    assert.match(actual[name], /^#version 300 es\n/);
    assert.doesNotMatch(actual[name], /\$\{|undefined|NaN/);
  }
  assert.equal(actual.FULLSCREEN_VS, baseline.FULLSCREEN_VS);
  assert.notEqual(actual.MESH_FS, baseline.MESH_FS, '近景叶面应在三角形内部产生叶簇，不是纯色宝石面');
  assert.notEqual(actual.MESH_VS, baseline.MESH_VS, '同一张网格需按树林和单株配色');
  const rigidMeshes = code => code.slice(code.indexOf('  } else {\n    wp = uModel'));
  assert.equal(rigidMeshes(actual.MESH_VS), rigidMeshes(baseline.MESH_VS), '飞机和其它非实例网格必须逐字保留原变换、光照和发光');
});

test('real terrain intersection, water depth, normals, cloud density and depth writes survive unchanged', () => {
  const actual = transformed();
  for (const anchor of ['float heightAt(', 'vec4 auxAt(', 'float cloudDensity(', 'float terrainNoise(', 'for (int i = 0; i < 130; i++)']) {
    assert.equal(block(actual.SCENE_FS, anchor), block(baseline.SCENE_FS, anchor), anchor);
  }
  const normal = source => source.slice(source.indexOf('  float e = 10.0;'), source.indexOf('  float slope ='));
  assert.equal(normal(actual.SCENE_FS), normal(baseline.SCENE_FS));
  assert.match(actual.SCENE_FS, /waterShade\(vec3\(hp\.x, 0\.0, hp\.z\), rd, -hitH,/);
  for (const name of ['SCENE_FS', 'CLOUD_FS']) {
    assert.ok(actual[name].includes('gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);'));
  }
  assert.equal(block(actual.CLOUD_FS, 'float cloudDensity('), block(baseline.CLOUD_FS, 'float cloudDensity('));
  for (const line of ['const int STEPS = 34;', 'float d = cloudDensity(p);', 'float alpha = 1.0 - exp(-d * stepLen * 0.038);', 'float dSun = cloudDensity(p + uSunDir * 85.0);', 'acc += cc * alpha * trans;', 'trans *= (1.0 - alpha);']) {
    assert.ok(actual.CLOUD_FS.includes(line), `Preserve volumetric integration: ${line}`);
  }
});

test('material bands and final color steps do not introduce screen-space white speckles', () => {
  const { SCENE_FS: scene, CLOUD_FS: cloud, POST_FS: post } = transformed();
  assert.ok(scene.includes('float dith = 0.5;'));
  assert.ok(cloud.includes('float jitter = 0.5;'));
  const water = block(scene, 'vec3 waterShade(');
  assert.doesNotMatch(water, /gl_FragCoord|bayer4\(|\buTime\b|pow\([^;]*,\s*(?:64|128|256)\.0/);
  assert.match(water, /terrainNoise\(/, '水面纹理随世界坐标平滑变化');
  assert.match(water, /reflect\(-normalize\(uSunDir\), vec3\(0\.0, 1\.0, 0\.0\)\)/, 'specular reflection uses the real light vector');
  assert.doesNotMatch(water, /\bfloat t\s*=\s*uTime|\bt\s*\*\s*0\.\d+/);
  assert.match(water, /warmedRipple/);
  assert.match(water, /reflectionRay/);
  assert.doesNotMatch(block(scene, 'vec3 terrainShade(') + water, /gl_FragCoord|bayer4\(/, '地表和水波不能锁在屏幕上');
  const sky = block(scene, 'vec3 skyColor(');
  assert.match(sky, /floor\(c \* 31\.0 \+ 0\.5\)/, 'sunset sky has stable palette bands');
  assert.match(sky, /acos\(clamp\(dot\(rd, normalize\(uSunDir\)\)/, 'sun disc follows normalized, arbitrary solar direction');
  assert.match(scene, /length\(horizontal\) > 1e-4/, 'vertical sun vectors must not produce undefined sky colors');
  assert.match(block(cloud, 'vec4 marchClouds('), /floor\(lit \* 3\.0 \+ 0\.5\)/, 'cloud light has discrete pixel-art steps');
  assert.doesNotMatch(scene + cloud + post, /bayer4\(gl_FragCoord|fract\(sin\(|\bdither\s*=/);
  assert.match(block(post, 'void main()'), /floor\([^;]*\* 31\.0 \+ 0\.5\) \/ 31\.0/);
  for (const line of ['edge * uDamage * 0.75', 'uCloudWhite', 'uFade']) assert.ok(post.includes(line), `Preserve post effect: ${line}`);
});

test('missing or duplicated source anchors throw a named diagnostic instead of silently missing', () => {
  const code = adapter();
  const mutations = [
    ['MESH_VS', source => source.replace('base = aCol * uTint * aVariation.w', 'base = aCol * aVariation.w')],
    ['SCENE_FS', source => source.replace('vec3 alpineHaze(vec3 rd)', 'vec3 renamedHaze(vec3 rd)')],
    ['SCENE_FS', source => `${source}\n${block(source, 'vec3 alpineHaze(')}`],
    ['SCENE_FS', source => source.replace('vec3 shallow = vec3(0.15, 0.31, 0.34);', 'vec3 shallow = vec3(0.1);')],
    ['CLOUD_FS', source => source.replace('vec3 cLow = vec3(0.28, 0.33, 0.42);', 'vec3 cLow = vec3(0.1);')],
    ['POST_FS', source => source.replace('c = pow(c, vec3(1.06, 1.04, 1.00));', 'c = pow(c, vec3(1.0));')],
  ];
  for (const [name, mutate] of mutations) {
    const context = vm.createContext({ changed: mutate(baseline[name]) });
    vm.runInContext(`${mutable}\n${name} = changed;`, context);
    const before = vm.runInContext(result, context);
    assert.throws(() => vm.runInContext(code, context), error => error.message.includes(name) && /exactly one|expected 1|命中/.test(error.message), `${name} source drift must fail loudly`);
    const after = vm.runInContext(result, context);
    for (const key of Object.keys(before)) assert.equal(after[key], before[key], 'Failed transformations must not partially apply');
  }
});

test('a second load fails loudly rather than double-grading shader strings', () => {
  const context = vm.createContext({});
  vm.runInContext(`${mutable}\n${adapter()}`, context);
  const before = vm.runInContext(result, context);
  assert.throws(() => vm.runInContext(adapter(), context), /(?:MESH_VS|SCENE_FS).*(?:exactly one|expected 1|命中)/);
  const after = vm.runInContext(result, context);
  for (const key of Object.keys(before)) assert.equal(after[key], before[key]);
});

test('WebGL2 compiles/links all transformed shaders and renders the intended palette and stable steps', { timeout: 60000 }, () => {
  const shaders = transformed();
  // Use the existing dependency-free CDP driver; GLSL must compile on WebGL2, not just parse as JS strings.
  const script = `
    const sources = ${JSON.stringify(shaders)};
    const sharedMesh = ${JSON.stringify({ vs: baseline.MESH_VS, fs: baseline.MESH_FS })};
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw Error('WebGL2 is required for shader verification');
    function compile(type, source) {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) + '\\n' + source.slice(-700));
      return shader;
    }
    function program(fragment, vertex = sources.FULLSCREEN_VS) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      return p;
    }
    const compiled = ['SCENE_FS', 'CLOUD_FS', 'POST_FS'].map(name => { program(sources[name]); return name; });
    const probe = program(sources.SCENE_FS.slice(0, sources.SCENE_FS.indexOf('void main() {')) + \`
      uniform vec3 uProbeDir; uniform vec3 uProbePos; uniform int uProbeKind; uniform float uProbeDepth; uniform float uProbeFootprint;
      void main() {
        float disc, glit; vec3 c;
        if (uProbeKind == 0) c = skyColor(normalize(uProbeDir), disc);
        else if (uProbeKind == 1) c = alpineHaze(normalize(uProbeDir));
        else if (uProbeKind == 2) c = waterShade(vec3(uProbePos.x, 0.0, uProbePos.z), normalize(uProbeDir), uProbeDepth, uProbeFootprint, glit);
        else c = terrainShade(uProbePos, uProbePos.y, uProbeFootprint, 0.5);
        fragColor = vec4(c, uProbeKind == 0 ? disc : 1.0);
      }\`);
    gl.useProgram(probe); gl.bindVertexArray(gl.createVertexArray()); gl.viewport(0, 0, 8, 8);
    const direction = (az, elevation) => [Math.sin(az) * Math.cos(elevation), Math.sin(elevation), -Math.cos(az) * Math.cos(elevation)];
    const sun = direction(-0.05, 0.11);
    const turnedSun = direction(1.45, 0.23);
    function scalar(p, name, value) { gl.uniform1f(gl.getUniformLocation(p, name), value); }
    function vector(p, name, value) { gl.uniform3fv(gl.getUniformLocation(p, name), value); }
    function pixel4() { gl.drawArrays(gl.TRIANGLES, 0, 3); const out = new Uint8Array(4); gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return Array.from(out); }
    function pixel() { return pixel4().slice(0, 3); }
    function probeTerrain(x, z, footprint = 0.05, sunDir = sun, h = 150) {
      gl.useProgram(probe); gl.uniform1i(gl.getUniformLocation(probe, 'uProbeKind'), 3);
      vector(probe, 'uProbeDir', [0, -1, 0]); vector(probe, 'uProbePos', [x, h, z]); vector(probe, 'uSunDir', sunDir);
      scalar(probe, 'uProbeFootprint', footprint); return pixel();
    }
    function probeWater(x, z, angle, sunDir = sun, viewSun = sunDir, footprint = 0.05) {
      gl.useProgram(probe); gl.uniform1i(gl.getUniformLocation(probe, 'uProbeKind'), 2);
      const az = Math.atan2(viewSun[0], -viewSun[2]);
      const dir = direction(az + angle, -Math.asin(viewSun[1]));
      vector(probe, 'uSunDir', sunDir); vector(probe, 'uProbePos', [x, 0, z]); vector(probe, 'uProbeDir', dir);
      scalar(probe, 'uProbeDepth', 25); scalar(probe, 'uProbeFootprint', footprint); return pixel();
    }
    vector(probe, 'uSunDir', sun);
    scalar(probe, 'uWorldSize', 8192); scalar(probe, 'uCloudBase', 1300); scalar(probe, 'uCloudTop', 2200); scalar(probe, 'uCloudSize', 8192);
    let auxTexture;
    for (const [unit, name, bytes] of [[0, 'uHeight', [0, 0, 0, 255]], [1, 'uAux', [0, 0, 128, 255]]]) {
      gl.activeTexture(gl.TEXTURE0 + unit); const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      if (name === 'uAux') auxTexture = texture;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(bytes));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(gl.getUniformLocation(probe, name), unit);
    }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(probe, 'uCloud'), 2);
    function sample(kind, direction, depth = 0) {
      gl.uniform1i(gl.getUniformLocation(probe, 'uProbeKind'), kind);
      vector(probe, 'uProbeDir', direction); scalar(probe, 'uProbeDepth', depth);
      if (kind === 2) vector(probe, 'uProbePos', [0, 0, 0]);
      if (kind === 3) vector(probe, 'uProbePos', [100, 150, 200]);
      return pixel4();
    }
    const tangent = [sun[2] / Math.hypot(sun[0], sun[2]), 0, -sun[0] / Math.hypot(sun[0], sun[2])];
    const offset = angle => sun.map((n, i) => n * Math.cos(angle) + tangent[i] * Math.sin(angle));
    const samples = {
      sun: sample(0, sun), sunEdge: sample(0, offset(0.065)), outsideSun: sample(0, offset(0.09)),
      horizon: sample(0, [sun[0], 0.02, sun[2]]), zenith: sample(0, [0, 1, 0]),
      horizonAway: sample(0, direction(Math.PI - 0.05, 0.02)), midSky: sample(0, direction(Math.PI - 0.05, 0.38)),
      haze: sample(1, [-sun[0], 0.02, -sun[2]]), shallow: sample(2, [0, -1, 0], 0.1), deep: sample(2, [0, -1, 0], 25),
      meadow: sample(3, [0, -1, 0]),
    };
    samples.discNear = sample(0, offset(0.078))[3] / 255;
    samples.discFar = sample(0, offset(0.090))[3] / 255;
    samples.groundLit = probeTerrain(173.25, 231.75);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, auxTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 128, 255]));
    samples.groundShadow = probeTerrain(173.25, 231.75);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 128, 170]));
    samples.crownShadow = probeTerrain(173.25, 231.75);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 128, 255]));
    const fleckedGround = Array.from({ length: 256 }, (_, i) => probeTerrain(100.0 + (i % 16) * 16.0, 200.0 + Math.floor(i / 16) * 16.0));
    const luma = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    samples.fleckStats = { unique: new Set(fleckedGround.map(c => c.join(','))).size, range: Math.max(...fleckedGround.map(luma)) - Math.min(...fleckedGround.map(luma)) };
    // 平坦草坡和反光水面上，横跨旧 8/16/32 米格线仅 0.1 米，不应普遍发生整块跳色。
    samples.edgeJumps = [];
    for (const paint of [probeTerrain, (x, z) => probeWater(x, z, 0)]) {
      const jumps = [];
      for (let i = 0; i < 128; i++) {
        const line = 32 * (1 + i % 16), along = 303.7 + (i % 11) * 17.43;
        const pair = delta => i & 1 ? paint(line + delta, along) : paint(along, line + delta);
        jumps.push(Math.abs(luma(pair(0.05)) - luma(pair(-0.05))));
      }
      samples.edgeJumps.push(jumps.sort((a, b) => a - b)[Math.floor(jumps.length * 0.90)]);
    }
    const patchGround = Array.from({ length: 144 }, (_, i) => probeTerrain(100 + (i % 12) * 50, 200 + Math.floor(i / 12) * 50, 24.0));
    samples.groundPalette = { unique: new Set(patchGround.map(c => c.join(','))).size, range: Math.max(...patchGround.map(luma)) - Math.min(...patchGround.map(luma)) };
    const autumnFields = Array.from({ length: 256 }, (_, i) => probeTerrain(80 + i % 16 * 100, 192 + Math.floor(i / 16) * 104, 6));
    samples.meadowHues = {
      olive: autumnFields.filter(([r,g,b]) => g > r + 8 && g > b + 22).length,
      straw: autumnFields.filter(([r,g,b]) => r > g + 12 && g > b + 25).length,
      russet: autumnFields.filter(([r,g,b]) => r > g + 18 && b > g - 13).length,
    };
    // 同一片几米见方的草坪／林底，分别从能看清笔触和笔触已小于一像素的距离取样。
    const cloth = program(sources.SCENE_FS.slice(0, sources.SCENE_FS.indexOf('void main() {')) + \`
      uniform vec2 uOrigin; uniform float uFoot;
      void main() {
        vec2 p = uOrigin + (gl_FragCoord.xy - vec2(0.5)) * 0.25;
        fragColor = vec4(terrainShade(vec3(p.x,150.0,p.y),150.0,uFoot,0.5),1.0);
      }\`);
    const tile = 64; canvas.width = canvas.height = tile; gl.viewport(0,0,tile,tile); gl.useProgram(cloth);
    for (const [name,unit] of [['uHeight',0],['uAux',1],['uCloud',2]]) gl.uniform1i(gl.getUniformLocation(cloth,name),unit);
    scalar(cloth,'uWorldSize',8192); scalar(cloth,'uCloudBase',1300); vector(cloth,'uSunDir',sun);
    const groundTile = (forest,foot,x=173.25,z=231.75) => {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,auxTexture);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,forest,128,255]));
      gl.uniform2f(gl.getUniformLocation(cloth,'uOrigin'),x,z); scalar(cloth,'uFoot',foot);
      gl.drawArrays(gl.TRIANGLES,0,3); const img=new Uint8Array(tile*tile*4); gl.readPixels(0,0,tile,tile,gl.RGBA,gl.UNSIGNED_BYTE,img); return img;
    };
    samples.groundCloth = [0,255].map(forest => {
      const near=groundTile(forest,.25), far=groundTile(forest,22), wrap=groundTile(forest,.25,173.25+8192,231.75-8192);
      const delta=(img,dx) => {
        const list=[]; for(let y=0;y<tile;y++)for(let x=0;x<tile-dx;x++){
          const i=(y*tile+x)*4,j=i+dx*4;
          list.push(Math.max(...[0,1,2].map(c=>Math.abs(img[i+c]-img[j+c]))));
        }
        return list.sort((a,b)=>a-b)[Math.floor(list.length*.8)];
      };
      const shifts=Array.from({length:tile*tile},(_,i)=> (near[i*4]-near[i*4+1])-(far[i*4]-far[i*4+1])).sort((a,b)=>a-b);
      return {metre:delta(near,4),fourMetres:delta(near,16),far:delta(far,4),quarter:delta(near,1),warm:shifts[3686],cool:shifts[409],wrap:Math.max(...near.map((v,i)=>Math.abs(v-wrap[i])))};
    });
    groundTile(0,.25); canvas.width=canvas.height=8; gl.viewport(0,0,8,8);
    samples.worldCellRepeat = [probeTerrain(173.25, 231.75), probeTerrain(173.25 + 8192.0, 231.75 - 8192.0)];
    samples.waterBase = probeWater(500.0, 500.0, 0.31);
    const reflectedHotspots = Array.from({ length: 1024 }, (_, i) => probeWater(500.0 + (i % 32) * 16.0, 500.0 + Math.floor(i / 32) * 16.0, 0.0));
    const isGold = c => c[0] > c[2] * 1.35 && luma(c) > luma(samples.waterBase) + 40;
    samples.reflectionPeak = Math.max(...reflectedHotspots.map(luma));
    samples.reflectionHotCount = reflectedHotspots.filter(isGold).length;
    const distantWater = Array.from({ length: 128 }, (_, i) => probeWater(500 + (i % 16) * 32, 500 + Math.floor(i / 16) * 32, 0, sun, sun, 48));
    samples.distantGold = distantWater.filter(c => c[0] > c[2] + 18).length;
    const hotIndex = reflectedHotspots.findIndex(isGold);
    if (hotIndex >= 0) {
      const x = 500 + (hotIndex % 32) * 16, z = 500 + Math.floor(hotIndex / 32) * 16;
      samples.brightWater = reflectedHotspots[hotIndex];
      samples.shiftedWater = probeWater(x + 8192, z - 8192, 0);
      samples.offAxisWater = probeWater(x, z, 0.31);
      samples.grazingWater = probeWater(x, z, 0, sun, direction(-0.05, 0.28));
      samples.turnedWater = probeWater(x, z, 0, turnedSun);
      samples.oldAxisWater = probeWater(x, z, 0, turnedSun, sun);
      samples.zenithWater = probeWater(x, z, 0, [0, 1, 0]);
      samples.grazingZenithWater = probeWater(x, z, 0, [0, 1, 0], sun);
    }
    vector(probe, 'uSunDir', turnedSun);
    samples.turnedDisc = sample(0, turnedSun)[3];
    samples.oldDisc = sample(0, sun)[3];
    vector(probe, 'uSunDir', [0, 1, 0]);
    samples.verticalDisc = sample(0, [0, 1, 0]);
    const blueRipples = Array.from({ length: 192 }, (_, i) => probeWater(500 + (i % 16) * 7, 500 + Math.floor(i / 16) * 7, 0.31));
    samples.blueRippleCount = new Set(blueRipples.map(c => c.join(','))).size;
    samples.blueRippleRange = Math.max(...blueRipples.map(luma)) - Math.min(...blueRipples.map(luma));
    scalar(probe, 'uTime', 231.0); samples.waterLater = probeWater(500.0, 500.0, 0.31);
    samples.staticWater = [samples.waterBase, samples.waterLater];
    samples.goldenMeadow = probeTerrain(100.0, 200.0, 10.0, [0, 1, 0]);
    // 同一片高处背光山肩，只隔十余米的岩面也应有笔触；大像素足迹必须滤掉细纹。
    const rockContrast = footprint => {
      const deltas = [];
      for (let i = 0; i < 160; i++) {
        const x = 700 + (i % 20) * 87, z = 450 + Math.floor(i / 20) * 113;
        const at = (dx, dz) => luma(probeTerrain(x + dx, z + dz, footprint, sun, 960));
        deltas.push(Math.abs(at(0, 0) - at(10, 8)));
      }
      return deltas.sort((a, b) => a - b)[128];
    };
    samples.ridgeContrast = [rockContrast(5), rockContrast(80)];
    // 取一小块连续天空而非固定云像素。先喂空云体作天空底，再换同一张有实有缺的 3D 云纹理。
    const sw = 128, sh = 52;
    const skyPatch = program(sources.SCENE_FS.slice(0, sources.SCENE_FS.indexOf('void main() {')) + \`
      void main() {
        float az = -0.80 + gl_FragCoord.x / 128.0 * 2.60;
        float el = 0.015 + gl_FragCoord.y / 52.0 * 0.43;
        float disc; fragColor = vec4(skyColor(vec3(sin(az)*cos(el), sin(el), -cos(az)*cos(el)), disc), 1.0);
      }\`);
    canvas.width = sw; canvas.height = sh; gl.viewport(0, 0, sw, sh); gl.useProgram(skyPatch);
    gl.uniform1i(gl.getUniformLocation(skyPatch, 'uCloud'), 2); scalar(skyPatch, 'uWorldSize', 8192);
    scalar(skyPatch, 'uCloudSize', 6400); scalar(skyPatch, 'uCloudBase', 1200); scalar(skyPatch, 'uCloudTop', 1670);
    vector(skyPatch, 'uCamPos', [4990, 638, 7100]); vector(skyPatch, 'uSunDir', direction(-1.5, 0.12));
    const patch = () => { gl.drawArrays(gl.TRIANGLES, 0, 3); const p = new Uint8Array(sw * sh * 4); gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const clear = patch(), dim = 32;
    const weather = Uint8Array.from({length: dim**3}, (_, k) => {
      const x = (k % dim) * Math.PI * 2 / dim, y = (Math.floor(k / dim) % dim) * Math.PI * 2 / dim, z = Math.floor(k / dim**2) * Math.PI * 2 / dim;
      return Math.round(123 + 44 * Math.sin(3*x+2*z+y) + 36 * Math.cos(5*z-2*x+2*y) + 25 * Math.sin(7*x - 6*z));
    });
    gl.activeTexture(gl.TEXTURE2); gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, dim, dim, dim, 0, gl.RED, gl.UNSIGNED_BYTE, weather);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const sky = patch(); vector(skyPatch, 'uWind', [0.04, 0, -0.07]); const moved = patch();
    let cool = 0, warm = 0, gaps = 0, windy = 0, stacked = 0, longEdge = 0;
    const masks = new Int8Array(sw * sh);
    for (let i = 0; i < masks.length; i++) {
      const a = i * 4, d = c => sky[a+c]-clear[a+c];
      const change = d(0) * 0.299 + d(1) * 0.587 + d(2) * 0.114;
      if (change < -13 && sky[a] <= sky[a+1] && sky[a+1] <= sky[a+2]) { masks[i] = -1; cool++; }
      else if (change > 14 && sky[a] > sky[a+1] && sky[a+1] > sky[a+2] + 7) { masks[i] = 1; warm++; }
      if (Math.abs(d(0))+Math.abs(d(1))+Math.abs(d(2)) < 5) gaps++;
      if (Math.abs(moved[a+1]-sky[a+1]) > 12) windy++;
    }
    for (let x = 0; x < sw; x++) for (let y = 4; y < sh; y++) {
      if (masks[y*sw+x] !== 1) continue;
      for (let k = 1; k <= 4; k++) if (masks[(y-k)*sw+x] === -1) { stacked++; break; }
    }
    for (let y = 0; y < sh; y++) {
      let start = 0;
      for (let x = 0; x < sw; x++) { if (!masks[y*sw+x]) start = x + 1; else longEdge = Math.max(longEdge, x-start+1); }
    }
    samples.farCloud = { cool, warm, gaps, windy, stacked, longEdge };
    canvas.width = canvas.height = 8; gl.viewport(0, 0, 8, 8);
    const post = program(sources.POST_FS); gl.useProgram(post);
    gl.uniform2f(gl.getUniformLocation(post, 'uRes'), 8, 8);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([145, 130, 99, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    samples.post = pixel(); scalar(post, 'uTime', 123.0); samples.postLater = pixel();
    const adjacent = new Uint8Array(16); gl.readPixels(3, 3, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, adjacent);
    samples.adjacent = Array.from(adjacent);
    // 提交同一个树冠面到生产网格程序，只改所处林斑。逆平移使它一直覆盖取色点。
    const meshProgram = program(sources.MESH_FS, sources.MESH_VS);
    gl.useProgram(meshProgram); gl.bindVertexArray(gl.createVertexArray());
    const tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttrib3f(1, 0, 1, 0); gl.vertexAttrib3f(2, 0.83, 0.67, 0.37); gl.vertexAttrib4f(5, 1, 0, 1, 1);
    vector(meshProgram, 'uSunDir', sun); vector(meshProgram, 'uTint', [1, 1, 1]);
    scalar(meshProgram, 'uInstanced', 1); scalar(meshProgram, 'uAlpha', 1);
    const foliageAt = (x, z, mark = -1) => {
      gl.vertexAttrib1f(3, mark); gl.vertexAttrib4f(4, x, 0, z, 1);
      vector(meshProgram, 'uCamPos', [x, 0, z]);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'uVP'), false, new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,-x,0,-z,1]));
      return pixel();
    };
    const foliage = Array.from({ length: 216 }, (_, i) => foliageAt(1475 + i % 18 * 43, 2240 + Math.floor(i / 18) * 41));
    samples.leafRatios = [0.60, 0.84].map((limit, i) => foliage.filter(([r,g]) => i ? g / r > limit : g / r < limit).length);
    samples.leafPeriod = [foliageAt(1647, 2240), foliageAt(1647 + 8192, 2240 - 8192)];
    samples.bark = [foliageAt(1475,2240,0), foliageAt(1719,2493,0)];
    // 同一个纯色冠面放大到 12×12 米，比较一行内的叶簇，而不是靠不同面法线制造假阳性。
    const sharedProgram = program(sharedMesh.fs, sharedMesh.vs), side = 64;
    canvas.width = canvas.height = side; gl.viewport(0, 0, side, side);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-6,9,0, 18,9,0, -6,33,0]), gl.STATIC_DRAW);
    const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const leafPanel = (prog, distance, mark = -1, instanced = 1, dx = 0) => {
      gl.useProgram(prog); vector(prog, 'uTint', [1,1,1]); vector(prog, 'uSunDir', sun);
      scalar(prog, 'uInstanced', instanced); scalar(prog, 'uAlpha', 1); scalar(prog, 'uRim', 1);
      gl.vertexAttrib1f(3, mark); gl.vertexAttrib4f(4, 0,0,0,1); vector(prog, 'uCamPos', [0,15,distance]);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, identity);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uVP'), false, new Float32Array([1/6,0,0,0, 0,1/6,0,0, 0,0,1,0, dx*2/side,-2.5,0,1]));
      gl.drawArrays(gl.TRIANGLES,0,3); const img = new Uint8Array(side * side * 4); gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,img); return img;
    };
    const canopy = leafPanel(meshProgram, 50), distant = leafPanel(meshProgram, 1200);
    const shiftedCrown = leafPanel(meshProgram, 50, -1, 1, 4);
    const diff = (a,b) => a.reduce((sum, v, i) => sum + (v !== b[i]), 0);
    const l = (p,x,y) => luma(p.subarray(4*(y*side+x),4*(y*side+x)+3));
    const contrast = (p,dx) => {
      const v = []; for(let y=2;y<62;y++) for(let x=2;x<62-dx;x++) v.push(Math.abs(l(p,x+dx,y)-l(p,x,y)));
      return v.sort((a,b)=>a-b)[Math.floor(v.length*0.80)];
    };
    let slide = 0; for(let y=1;y<63;y++) for(let x=1;x<59;x++) slide += Math.abs(l(canopy,x,y)-l(shiftedCrown,x+4,y));
    const upper = r => { let t=0; for(let y=r;y<r+12;y++) for(let x=2;x<62;x++) t+=l(canopy,x,y); return t/720; };
    samples.leafDetail = { onePixel: contrast(canopy,1), twoMetres: contrast(canopy,10), far: contrast(distant,10),
      upper: upper(50), lower: upper(2), slide: slide/(58*62),
      barkDiff: diff(leafPanel(meshProgram,50,0), leafPanel(sharedProgram,50,0)),
      planeDiff: diff(leafPanel(meshProgram,50,0,0), leafPanel(sharedProgram,50,0,0)),
      lampDiff: diff(leafPanel(meshProgram,50,0.6,0), leafPanel(sharedProgram,50,0.6,0)) };
    // 直接俯看水平的冠顶面，考察一米内是否有多团次级明暗，而不只是相互平行的长亮条。
    gl.bindBuffer(gl.ARRAY_BUFFER,tri); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-6,20,-6,18,20,-6,-6,20,18]),gl.STATIC_DRAW);
    gl.useProgram(meshProgram); gl.vertexAttrib1f(3,-1); scalar(meshProgram,'uInstanced',1); vector(meshProgram,'uCamPos',[0,80,0]);
    gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram,'uVP'),false,new Float32Array([1/6,0,0,0, 0,0,0,0, 0,1/6,0,0, 0,0,0,1]));
    gl.drawArrays(gl.TRIANGLES,0,3); const roof = new Uint8Array(side*side*4); gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,roof);
    const axes = [0,1].map(axis=>{const counts=[];for(let k=2;k<62;k++){
      let turns=0,trend=0,extreme=0;for(let j=1;j<63;j++){
        const v=axis?l(roof,k,j):l(roof,j,k);if(j===1){extreme=v;continue;}
        if(!trend){if(Math.abs(v-extreme)>6){trend=Math.sign(v-extreme);extreme=v;}}
        else if(trend*(v-extreme)>0)extreme=v;
        else if(trend*(v-extreme)<-6){turns++;trend=-trend;extreme=v;}
      } counts.push(turns);
    }return counts.sort((a,b)=>a-b)[30];});
    samples.leafDetail.topTurns=axes;
    gl.vertexAttrib1f(3,-2); gl.vertexAttrib3f(2,.36,.44,.30); gl.drawArrays(gl.TRIANGLES,0,3);
    const pineRoof = new Uint8Array(side*side*4); gl.readPixels(0,0,side,side,gl.RGBA,gl.UNSIGNED_BYTE,pineRoof);
    samples.leafDetail.pine = {contrast:contrast(pineRoof,6), warm:Array.from({length:side*side},(_,i)=>pineRoof[i*4]>pineRoof[i*4+1]+2).filter(Boolean).length};
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw Error('WebGL error: ' + error);
    return { compiled, samples };
  `;
  const browser = spawnSync(process.execPath, [fileURLToPath(new URL('./cdp.mjs', import.meta.url)), 'run', 'about:blank', script, '--width=320', '--height=180'], { encoding: 'utf8', timeout: 50000, maxBuffer: 2_000_000 });
  assert.equal(browser.status, 0, browser.stderr || browser.stdout);
  assert.doesNotMatch(browser.stdout, /\[evalerror\]|\[pageerror\]/, browser.stdout);
  const output = browser.stdout.match(/\[evalresult\] ([\s\S]*)/);
  assert.ok(output, browser.stdout);
  const { compiled, samples: s } = JSON.parse(output[1]);
  assert.deepEqual(compiled, ['SCENE_FS', 'CLOUD_FS', 'POST_FS']);
  assert.ok(s.sun[0] >= 245 && s.sun[1] >= 225 && s.sun[2] >= 175 && s.sun[2] < 225, `Cream, not white sun: ${s.sun}`);
  assert.ok(s.sunEdge[3] > 245 && s.outsideSun[3] === 0 && s.discFar === 0, `Enlarged but bounded sun disc: ${JSON.stringify(s)}`);
  assert.ok(s.sun[1] > s.sunEdge[1] && s.sunEdge[1] > s.outsideSun[1], `Soft angular sun edge: ${JSON.stringify(s)}`);
  assert.ok(s.horizon[0] > s.horizon[1] && s.horizon[1] > s.horizon[2], `Warm peach horizon: ${s.horizon}`);
  for (const name of ['horizonAway', 'midSky', 'zenith', 'haze']) {
    const [r, g, b] = s[name];
    assert.ok(g >= r + 8 && b >= g + 5, `Blue-grey ${name}: ${s[name]}`);
  }
  for (const name of ['shallow', 'deep']) assert.ok(s[name][2] > s[name][0] && s[name][1] > s[name][0], `Blue-cyan ${name}: ${s[name]}`);
  assert.ok(s.shallow[1] > s.deep[1] + 35, `Readable pale shallows: ${s.shallow}, ${s.deep}`);
  assert.ok(s.meadow[0] > s.meadow[2] * 1.3 && s.meadow[1] > s.meadow[2] * 1.3, `Ochre-green ground: ${s.meadow}`);
  assert.ok(s.meadow[0] * 0.299 + s.meadow[1] * 0.587 + s.meadow[2] * 0.114 > 62, `Readable bright ground rather than black terrain: ${s.meadow}`);
  const luminance = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  assert.ok(luminance(s.groundShadow) >= luminance(s.groundLit) * 0.78, `Baked terrain shadow remains readable: lit ${s.groundLit}, shaded ${s.groundShadow}`);
  assert(Object.values(s.meadowHues).every(n => n >= 12), `同一片开阔谷地不应只有一色黄草，橄榄绿、浅金、褐红草斑的采样数：${JSON.stringify(s.meadowHues)}`);
  assert(s.crownShadow[2] / s.crownShadow[1] > s.groundLit[2] / s.groundLit[1] + 0.23 && luminance(s.crownShadow) < luminance(s.groundLit) * 0.85,
    `树冠投影须转入暗紫冷色，而不是把暖草坪乘黑：${s.groundLit} / ${s.crownShadow}`);
  assert(s.leafRatios.every(n => n >= 15), `同片林地的阔叶有整冠赤红也有浅金而非只有明暗：红金数 ${s.leafRatios}`);
  assert.deepEqual(s.leafPeriod[0], s.leafPeriod[1], '树冠在周期地图的副本上保持同色');
  assert.deepEqual(s.bark[0], s.bark[1], '树皮不随叶色转红或发黄');
  const leaves = s.leafDetail;
  assert(leaves.pine.warm===0 && leaves.pine.contrast>=6, `近松冠应看出绿色针叶簇，不可染成秋金色：${JSON.stringify(leaves.pine)}`);
  assert(leaves.topTurns.every(n=>n>=5) && s.groundCloth.every(p=>p.metre>=10 && p.fourMetres>=12 && p.quarter < p.metre*.8 && p.far<4 && p.warm-p.cool >= 5 && p.wrap<=1),
    `冠顶应有双轴错落的哑光叶团，近草坪与林底要有米级冷暖簇、远处滤去且整图周期一致：${JSON.stringify({topTurns:leaves.topTurns,ground:s.groundCloth})}`);
  assert(leaves.twoMetres >= 13 && leaves.onePixel < leaves.twoMetres * 0.40 && leaves.far < 2,
    `一片近叶面的 2m 范围应有团状明暗；不是独立像素噪点，远景应淡掉：${JSON.stringify(leaves)}`);
  assert(leaves.upper > leaves.lower + 8 && leaves.slide < 0.2, `上冠接光、下冠暗，移动投影不应移动冠斑：${JSON.stringify(leaves)}`);
  assert.deepEqual([leaves.barkDiff, leaves.planeDiff, leaves.lampDiff], [0,0,0], '树干、飞机色面和飞机发光部位与共享着色的实际像素一致');
  assert.ok(s.edgeJumps.every(jump => jump < 5), `跨世界轴线的亮度跳变（90 分位，草坡/金光水面）：${s.edgeJumps}`);
  assert.ok(s.fleckStats.unique >= 20 && s.fleckStats.range >= 18, `近景应有可辨的自然色块，不靠方格边缘：${JSON.stringify(s.fleckStats)}`);
  assert.ok(s.groundPalette.unique >= 20 && s.groundPalette.range >= 12, `Visible world-anchored patchwork survives at broad terrain footprints: ${JSON.stringify(s.groundPalette)}`);
  assert.deepEqual(s.worldCellRepeat[0], s.worldCellRepeat[1], 'Material flecks repeat at world period and stay world-anchored');
  const bank = s.farCloud;
  assert(bank.cool > 95 && bank.warm > 65 && bank.stacked > 35 && bank.longEdge >= 9 && bank.gaps > 2600 && bank.windy > 190,
    `横向云堤应在多列有淡金顶缘和蓝灰底，留够晴空并响应风。128×52 GPU 采样 ${JSON.stringify(bank)}`);
  assert(s.ridgeContrast[0] > 8 && s.ridgeContrast[1] < s.ridgeContrast[0] * 0.55, `山肩短距岩纹需要分明，远层应安静，不是整坡平紫或满屏噪点：${s.ridgeContrast}`);
  assert.ok(s.reflectionHotCount >= 2 && s.reflectionHotCount < 700 && s.reflectionPeak > luminance(s.waterBase) + 40, `Sun produces sparse broken golden water glints: base ${s.waterBase}, hotspots ${s.reflectionHotCount}, peak ${s.reflectionPeak}`);
  assert(s.distantGold >= 4 && s.distantGold < 95, `远处水面应有成段的暖反光，不能全消失或铺满：${s.distantGold} / 128`);
  assert.deepEqual(s.brightWater, s.shiftedWater, 'Golden ripples repeat at world period, not screen position');
  assert.ok(luminance(s.brightWater) > luminance(s.offAxisWater) + 30, `Gold path follows real sun azimuth: ${s.brightWater}, ${s.offAxisWater}`);
  assert.ok(luminance(s.brightWater) > luminance(s.grazingWater) + 15, 'Reflection falls off away from the reflected solar elevation');
  assert.ok(luminance(s.turnedWater) > luminance(s.oldAxisWater) + 30, 'Rotated solar direction moves the golden reflection');
  assert.ok(luminance(s.zenithWater) > luminance(s.grazingZenithWater) + 30, 'Overhead sunlight reflects straight up regardless of azimuth');
  assert.ok(s.turnedDisc === 255 && s.oldDisc === 0 && s.verticalDisc[3] === 255 && s.verticalDisc[0] > 245, 'Sun disc handles arbitrary solar directions, including the zenith');
  assert.ok(luminance(s.deep) >= 64, `Deep water stays readable blue/mauve, not navy-black: ${s.deep}`);
  assert.ok(s.blueRippleCount >= 12 && s.blueRippleRange >= 8, `Off-axis lake has world-colored ripples rather than broad flat bands: ${s.blueRippleCount}, ${s.blueRippleRange}`);
  assert.deepEqual(s.staticWater[0], s.staticWater[1], 'World-anchored water material does not shimmer over time');
  assert.ok(s.goldenMeadow[0] > s.meadow[0] && s.goldenMeadow[1] > s.meadow[1], `Directional golden lighting must brighten real terrain: ${s.goldenMeadow} vs ${s.meadow}`);
  for (const c of s.post) assert.ok(Math.abs(c / 255 * 31 - Math.round(c / 255 * 31)) < 0.065, `32 controlled channel levels: ${s.post}`);
  assert.deepEqual(s.postLater, s.post, 'Color steps must not shimmer over time');
  for (let i = 0; i < 16; i += 4) assert.deepEqual(s.adjacent.slice(i, i + 3), s.post, 'Uniform material must not acquire a white-pixel pattern');
  console.log(`WebGL2 PASS: scene/cloud/post/mesh compiled and linked; GPU palette samples ${JSON.stringify(s)}`);
});
