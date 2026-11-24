// 独立入口的夕照像素材质；精确锚点令共享 shader 漂移时明确失败。
{
  const __skyReplaceExactlyOnce = (source, before, after, shader) => {
    const first = source.indexOf(before);
    if (first < 0 || first !== source.lastIndexOf(before)) {
      throw new Error(`[autumn pixels] ${shader}: expected exactly one source anchor; shader changed`);
    }
    return source.slice(0, first) + after + source.slice(first + before.length);
  };
  let __skyScene = SCENE_FS;
  let __skyCloud = CLOUD_FS;
  let __skyPost = POST_FS;
  let __skyMesh = __skyReplaceExactlyOnce(MESH_VS, `out float vEmi;`, `out float vEmi;
out vec4 vLeaf;`, 'MESH_VS');
  __skyMesh = __skyReplaceExactlyOnce(__skyMesh, `  vec3 base;`, `  vec3 base;
  vLeaf = vec4(0.0);`, 'MESH_VS');
  __skyMesh = __skyReplaceExactlyOnce(__skyMesh,
    `    base = aCol * uTint * aVariation.w * treeTone * canopyOcclusion;`,
    `    vec3 leafColor = aCol;
    if (aEmi < -0.5) {
      float nearLeaves = 1.0 - smoothstep(270.0, 920.0, distance(wp.xyz, uCamPos));
      vLeaf = vec4(aPos, aEmi < -1.5 ? -nearLeaves : nearLeaves);
    }
    if (aEmi < -0.5 && aEmi > -1.5) {
      // 只读实例的周期坐标；斜穿山坡的一片枫林从赤红过渡到铜橙和浅金。
      vec2 cell = floor(mod(aInstance.xz, vec2(8192.0)) / 20.48);
      float grove = 0.50 + 0.24 * sin(dot(cell, vec2(3.0, 2.0)) * 0.0314159265)
                         + 0.18 * sin(dot(cell, vec2(-2.0, 7.0)) * 0.0314159265)
                         + 0.10 * sin(dot(cell, vec2(8.0, -3.0)) * 0.0314159265);
      grove += (aVariation.w - 0.96) * 1.20 + aVariation.y * 0.04;
      vec3 pigment = mix(vec3(0.91, 0.37, 0.63), vec3(1.02, 0.82, 0.76), smoothstep(0.22, 0.52, grove));
      pigment = mix(pigment, vec3(1.01, 1.18, 0.98), smoothstep(0.50, 0.76, grove));
      leafColor *= pigment;
    }
    base = leafColor * uTint * aVariation.w * treeTone * canopyOcclusion;`, 'MESH_VS');
  let __skyMeshFrag = __skyReplaceExactlyOnce(MESH_FS, `in float vEmi;`, `in float vEmi;
in vec4 vLeaf;
float leafHash(vec2 i) {
  vec3 p = fract(vec3(i.xyx) * vec3(0.1031, 0.1137, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float leafLobes(vec2 q) {
  vec2 i = floor(q), t = fract(q);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(leafHash(i), leafHash(i + vec2(1,0)), t.x),
             mix(leafHash(i + vec2(0,1)), leafHash(i + vec2(1)), t.x), t.y);
}`, 'MESH_FS');
  __skyMeshFrag = __skyReplaceExactlyOnce(__skyMeshFrag, `  fragColor = vec4(vCol, uAlpha);`,
    `  vec3 color = vCol;
  if (abs(vLeaf.w) > 0.01) {
    // 在树自己的斜轴上画叶簇；色阶只有在团边才变化，不在天空或树皮上播噪点。
    vec2 uv = vec2(vLeaf.x + 0.42 * vLeaf.z + 0.28 * vLeaf.y, vLeaf.z - 0.42 * vLeaf.x + 0.68 * vLeaf.y);
    float footprint = max(fwidth(uv.x), fwidth(uv.y));
    float coverage = 1.0 - smoothstep(0.75, 2.8, footprint);
    vec2 dab = (floor(uv * 2.0) + .5) * .5;
    float broad = leafLobes(uv * .26 + vec2(11.7, 4.1));
    float blade = leafLobes(dab * .90 + broad * 1.8);
    float clump = broad + (blade - .5) * .90 * (1.0 - smoothstep(.42, 1.35, footprint));
    float notch = 1.0 - smoothstep(0.29, 0.40, clump);
    float tips = smoothstep(0.59, 0.69, clump + 0.09 * smoothstep(10.0, 23.0, vLeaf.y));
    vec3 ink = mix(vCol * .92, vCol * vec3(.59,.57,.74) + vec3(.018,.009,.022), notch);
    vec3 light = vLeaf.w > 0.0 ? vec3(.080,.057,.028) : vec3(.043,.070,.041);
    ink = mix(ink, vCol * vec3(1.07,1.07,1.01) + light, tips);
    ink *= .88 + .22 * smoothstep(8.0, 23.0, vLeaf.y);
    color = mix(vCol, ink, abs(vLeaf.w) * coverage);
  }
  fragColor = vec4(color, uAlpha);`, 'MESH_FS');

  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `vec3 alpineHaze(vec3 rd) {
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  vec2 sa = normalize(uSunDir.xz);
  float face = pow(dot(az, sa) * 0.5 + 0.5, 2.0);
  vec3 away = vec3(0.44, 0.52, 0.60);
  vec3 lit  = vec3(0.65, 0.72, 0.77);
  vec3 c = mix(away, lit, face * 0.7);
  c = mix(c, vec3(0.56, 0.64, 0.72), smoothstep(0.0, 0.30, rd.y) * 0.24);
  return c;
}`,
    `// 天顶光没有水平分量，避免 normalize(vec2(0)) 污染整片天空。
vec2 autumnSunAz() {
  vec2 horizontal = uSunDir.xz;
  return length(horizontal) > 1e-4 ? normalize(horizontal) : vec2(0.0, -1.0);
}

vec3 alpineHaze(vec3 rd) {
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  float face = pow(dot(az, autumnSunAz()) * 0.5 + 0.5, 2.0);
  vec3 c = mix(vec3(0.51, 0.59, 0.66), vec3(0.74, 0.68, 0.59), face * face * 0.78);
  return mix(c, vec3(0.61, 0.69, 0.75), smoothstep(0.0, 0.28, rd.y) * 0.22);
}`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `vec3 skyColor(vec3 rd, out float disc) {
  float el = rd.y;
  float sunDot = max(dot(rd, uSunDir), 0.0);
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  vec2 sa = normalize(uSunDir.xz);`,
    `// 远云只占天空深度；用世界方位沿同一云体取样，近处可穿过的积云仍由体积通道绘制。
vec3 autumnCloudBank(vec3 sky, vec2 az, float elevation, float level, float reach, float thickness, float face) {
  vec2 q = uCamPos.xz / uWorldSize + az * reach + uWind.xz;
  float mass = texture(uCloud, vec3(q.x, level, q.y)).r;
  float billow = texture(uCloud, vec3(q.x * 2.0 + 0.31, level + 0.19, q.y * 2.0 - 0.17)).r;
  float body = smoothstep(0.36, 0.61, mass * 0.75 + billow * 0.25);
  float base = level - uCamPos.y / 22000.0 + (mass - 0.5) * 0.030 + (billow - 0.5) * 0.009;
  float depth = 0.006 + thickness * body * (0.61 + 0.70 * billow);
  float h = (elevation - base) / depth;
  float cover = smoothstep(-0.05, 0.08, h) * (1.0 - smoothstep(0.88, 1.03, h)) * smoothstep(0.07, 0.40, body);
  vec3 underside = mix(vec3(0.46, 0.52, 0.59), vec3(0.58, 0.60, 0.63), face);
  vec3 middle = mix(underside, vec3(0.86, 0.84, 0.79), 0.65);
  vec3 crest = mix(vec3(0.93, 0.90, 0.84), vec3(1.0, 0.91, 0.74), face);
  vec3 cloud = mix(underside, middle, smoothstep(0.14, 0.53, h + (billow - 0.5) * 0.20));
  cloud = mix(cloud, crest, smoothstep(0.50, 0.77, h + (billow - 0.5) * 0.35));
  return mix(sky, cloud, cover * 0.92);
}

vec3 skyColor(vec3 rd, out float disc) {
  float el = rd.y;
  float sunDot = max(dot(rd, normalize(uSunDir)), 0.0);
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  vec2 sa = autumnSunAz();`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  // cold alpine sky: pale blue-grey at the horizon, deep slate overhead.
  // No sun disc and no warm band anywhere.
  vec3 horizon = mix(vec3(0.50, 0.58, 0.66), vec3(0.68, 0.74, 0.79), face);
  vec3 midcol  = mix(vec3(0.32, 0.41, 0.52), vec3(0.44, 0.53, 0.62), pow(dot(az, sa) * 0.5 + 0.5, 1.6));
  vec3 zenith  = vec3(0.13, 0.19, 0.30);
  float up = max(el, 0.0);
  vec3 c = mix(horizon, midcol, smoothstep(0.0, 0.19, up));
  c = mix(c, zenith, smoothstep(0.13, 0.72, up));

  // pale grey cloud shelf layered over the horizon
  float band = smoothstep(0.02, 0.10, up) * (1.0 - smoothstep(0.20, 0.38, up));
  float streak = texture(uCloud, vec3(az.x * 0.11 + uWind.x * 3.0, 0.86 + up * 0.04, az.y * 0.11 + uWind.z * 3.0)).r;
  float hi = smoothstep(0.54, 0.74, streak + 0.10) * band;
  c = mix(c, vec3(0.72, 0.77, 0.82), hi * 0.50);

  // cold low haze, brightest toward the light azimuth only very subtly
  float haze = pow(1.0 - clamp(up, 0.0, 1.0), 9.0) * pow(dot(az, sa) * 0.5 + 0.5, 2.0);
  c = mix(c, vec3(0.66, 0.72, 0.77), haze * 0.42);
  c += vec3(0.07, 0.08, 0.09) * pow(sunDot, 6.0);

  // thin high streaks, neutral grey-blue
  float streak2 = texture(uCloud, vec3(az.x * 0.07 - 0.23, 0.93, az.y * 0.07 + 0.41)).r;
  float st = smoothstep(0.60, 0.78, streak2) * smoothstep(0.18, 0.35, up) * (1.0 - smoothstep(0.55, 0.75, up));
  c = mix(c, vec3(0.67, 0.72, 0.78), st * 0.30);

  disc = 0.0;
  return c;`,
    `  // 暖色集中在日落方向的低空，抬头逐渐进入柔和的蓝灰色。
  float warmth = face * face;
  vec3 horizon = mix(vec3(0.72, 0.79, 0.82), vec3(0.97, 0.80, 0.61), warmth);
  vec3 midcol = mix(vec3(0.48, 0.62, 0.75), vec3(0.56, 0.67, 0.77), face);
  vec3 zenith = vec3(0.34, 0.50, 0.66);
  float up = max(el, 0.0);
  vec3 c = mix(horizon, midcol, smoothstep(0.0, 0.23, up));
  c = mix(c, zenith, smoothstep(0.24, 0.90, up));
  float haze = pow(1.0 - clamp(up, 0.0, 1.0), 9.0) * warmth;
  c = mix(c, vec3(1.0, 0.84, 0.65), haze * 0.28);
  c += vec3(0.055, 0.030, 0.008) * pow(sunDot, 12.0);
  if (el > -0.09 && el < 0.44) {
    c = autumnCloudBank(c, az, el, 0.151, 0.49, 0.073, face);
    c = autumnCloudBank(c, az, el, 0.282, 0.39, 0.055, face);
  }
  c = floor(c * 31.0 + 0.5) / 31.0;

  // 大奶油色日轮跟随真实光向量，不固定在相机或屏幕上。
  float discAngle = acos(clamp(dot(rd, normalize(uSunDir)), -1.0, 1.0));
  float discCore = 1.0 - smoothstep(0.063, 0.084, discAngle);
  float discHalo = 1.0 - smoothstep(0.075, 0.125, discAngle);
  c = mix(c, vec3(1.0, 0.86, 0.67), discHalo * 0.24);
  c = mix(c, vec3(1.0, 0.92, 0.73), discCore);
  disc = discCore;
  return c;`, 'SCENE_FS');

  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  float tone = 0.62 + 0.38 * smoothstep(0.0, 0.92, ndl);`,
    `  float tone = 0.82 + 0.28 * smoothstep(0.0, 0.92, ndl);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  float snowLine = 560.0 + (tintv - 0.5) * 90.0;`,
    `  float snowLine = 9000.0 + (tintv - 0.5) * 90.0;`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  vec3 meadow = mix(vec3(0.22, 0.29, 0.17), vec3(0.30, 0.36, 0.22), meadowVar);
  meadow = mix(meadow, vec3(0.37, 0.35, 0.23), clearings * 0.16);`,
    `  // 开阔地由成片草场、晒黄的坡肩与贴坡越过林缘的红褐蕨带组成。
  vec2 fold = vec2(p.x + p.z, p.x - p.z) + vec2(h * 1.6, -h * 0.8);
  float field = terrainNoise(fold + vec2(174.0, 293.0) * broad, 34.0);
  float pasture = smoothstep(0.40, 0.60, meadowVar + (field - 0.5) * 0.20);
  vec3 meadow = mix(vec3(0.35, 0.46, 0.255), vec3(0.80, 0.68, 0.37), pasture);
  float bracken = smoothstep(0.54, 0.69, field + (middle - 0.5) * 0.12);
  meadow = mix(meadow, mix(vec3(0.52, 0.32, 0.34), vec3(0.67, 0.44, 0.32), pasture * 0.46), bracken * 0.90);
  meadow = mix(meadow, vec3(0.78, 0.70, 0.42), clearings * (1.0 - bracken) * 0.22);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  vec3 canopy = mix(vec3(0.075, 0.145, 0.085), vec3(0.145, 0.235, 0.125), canopyVar);
  float autumnGroves = smoothstep(0.72, 0.92, broad) * (0.12 + 0.10 * smoothstep(180.0, snowLine - 30.0, hj));
  canopy = mix(canopy, vec3(0.36, 0.28, 0.12), autumnGroves);`,
    `  vec3 canopy = mix(vec3(0.21, 0.32, 0.24), vec3(0.42, 0.49, 0.28), canopyVar);
  float autumnGroves = smoothstep(0.38, 0.73, broad * 0.70 + middle * 0.30 + (tintv - 0.5) * 0.32);
  canopy = mix(canopy, mix(vec3(0.56, 0.29, 0.23), vec3(0.81, 0.53, 0.24), canopyVar), autumnGroves * 0.88);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  vec3 rock = mix(vec3(0.25, 0.275, 0.28), vec3(0.39, 0.40, 0.385), rockVar);
  rock = mix(rock, vec3(0.42, 0.38, 0.30), smoothstep(0.68, 0.90, broad) * 0.12);
  vec3 sand = mix(vec3(0.40, 0.39, 0.32), vec3(0.52, 0.48, 0.37), clamp(broad + groundGrain, 0.0, 1.0));`,
    `  vec3 rock = mix(vec3(0.39, 0.33, 0.42), vec3(0.59, 0.44, 0.43), rockVar);
  rock = mix(rock, vec3(0.66, 0.48, 0.35), smoothstep(0.68, 0.90, broad) * 0.16);
  vec3 sand = mix(vec3(0.57, 0.48, 0.34), vec3(0.74, 0.63, 0.42), clamp(broad + groundGrain, 0.0, 1.0));`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  vec3 sunTint = vec3(1.04, 1.04, 1.02);
  vec3 skyFill = vec3(0.90, 0.94, 0.98);`,
    `  vec3 sunTint = vec3(1.16, 1.05, 0.84);
  vec3 skyFill = vec3(0.99, 0.98, 1.05);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  vec3 shadowTint = vec3(0.69, 0.73, 0.77);
  col = mix(col, col * shadowTint + vec3(0.004, 0.006, 0.008), sh * 0.80);`,
    `  vec3 shadowTint = vec3(0.82, 0.79, 0.93);
  col = mix(col, col * shadowTint + vec3(0.008, 0.010, 0.018), sh * 0.62);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  col *= treeVisibility;`,
    `  float crownShade = smoothstep(0.03, 0.38, 1.0 - treeVisibility);
  col = mix(col, col * vec3(0.52, 0.43, 0.66) + vec3(0.094, 0.058, 0.145), crownShade * 0.92);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  col = mix(col, col * vec3(0.60, 0.66, 0.80) + vec3(0.006, 0.010, 0.018), csh * 0.48);`,
    `  col = mix(col, col * vec3(0.78, 0.72, 0.88) + vec3(0.012, 0.010, 0.022), csh * 0.34);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  float middle = mix(0.5, terrainNoise(p.xz, 256.0), middleFade);
  float fine = mix(0.5, terrainNoise(p.xz, 1024.0), fineFade);
  float groundGrain = (middle - 0.5) * 0.10 + (fine - 0.5) * 0.035;`,
    `  // 整数斜轴维持周期，坡高让色带顺着山形走，不在世界网格边缘整块换色。
  vec2 brush = vec2(p.x - p.z, p.x + 2.0 * p.z) + vec2(h * 0.6, -h * 1.7);
  float middle = mix(0.5, terrainNoise(brush, 128.0), middleFade);
  float fine = mix(0.5, terrainNoise(brush + broad * 27.0, 512.0), fineFade);
  float groundGrain = (middle - 0.5) * 0.24 + (fine - 0.5) * 0.065;`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  float rockMask = max(smoothstep(0.24, 0.50, slope + (broad - 0.5) * 0.06), smoothstep(snowLine + 80.0, snowLine + 260.0, hj));`,
    `  float rockMask = max(smoothstep(0.12, 0.38, slope + (middle - 0.5) * 0.065),
    smoothstep(480.0, 930.0, hj + (broad - 0.5) * 160.0) * 0.82);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  col = mix(col, snowCol, snowMask);

  col *= tone;`,
    `  col = mix(col, snowCol, snowMask);

  float grass = (1.0 - rockMask) * (1.0 - forestMask) * (1.0 - sandMask);
  float tuft = smoothstep(0.53, 0.78, middle * 0.66 + fine * 0.34);
  col = mix(col, vec3(0.77, 0.65, 0.36), grass * tuft * (0.25 + 0.30 * broad));
  // 草地与覆荫林底使用不同的笔形和颜料，小于屏幕足迹时只留原有大色块。
  float cover = (1.0 - smoothstep(.7, 4.0, footprint)) * (1.0 - rockMask) * (1.0 - sandMask);
  if (cover > .001) {
    vec2 cell = (floor((mod(p.xz, vec2(uWorldSize)) + vec2(7.35, 19.28)) * 2.0) + .5) * .5;
    vec2 slant = vec2(cell.x + cell.y, cell.y - cell.x);
    float bed = terrainNoise(cell, 768.0);
    float hay = terrainNoise(vec2(slant.x, slant.y * 3.0) + 6.0 * bed, 1536.0);
    float drift = terrainNoise(vec2(slant.y, 2.0 * cell.x + cell.y) - 9.0 * bed, 2048.0);
    float woods = max(forestMask, smoothstep(.06, .38, 1.0 - aux.a));
    float straw = smoothstep(.44, .69, hay + .30 * (bed - .5));
    float litter = smoothstep(.43, .70, drift + .38 * (1.0 - bed) - .13);
    vec3 loam = mix(col * vec3(.78,.85,.76), vec3(.27,.22,.28), woods * .48);
    vec3 thatch = mix(loam, vec3(.73,.64,.40), straw * (.60 - .32 * woods));
    vec3 ochre = mix(vec3(.51,.34,.26), vec3(.74,.45,.27), bed);
    col = mix(col, mix(thatch, ochre, litter * (.37 + .40 * woods)), cover);
  }
  // 林线之上的露岩按坡高断续成带，远到分不清笔触时保留山脊剪影。
  vec2 ledgeUV = vec2(p.x + p.z + h * 1.6, p.x - p.z - h * 2.3);
  float strata = terrainNoise(ledgeUV, 196.0);
  float exposed = max(rockMask * 0.88, smoothstep(175.0, 530.0, hj) * 0.68) * (1.0 - forestMask * 0.88);
  float strokes = smoothstep(0.50, 0.82, strata + (broad - 0.5) * 0.42) * (1.0 - smoothstep(9.0, 48.0, footprint));
  vec3 ledge = mix(vec3(0.65, 0.49, 0.48), vec3(0.84, 0.72, 0.54), broad);
  col = mix(col, ledge, exposed * strokes * 0.81);
  float leeside = smoothstep(0.04, 0.43, -dot(n, uSunDir));
  col = mix(col, vec3(0.41, 0.31, 0.45), leeside * (0.19 + rockMask * 0.23));
  col *= tone;`, 'SCENE_FS');

  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `vec3 waterShade(vec3 p, vec3 rd, float depth, float dith, out float glit) {
  glit = 0.0;
  vec2 q = p.xz;
  float t = uTime;
  float d = max(depth, 0.0);
  vec3 shallow = vec3(0.15, 0.31, 0.34);
  vec3 middle = vec3(0.065, 0.17, 0.24);
  vec3 deep = vec3(0.022, 0.060, 0.125);
  vec3 c = mix(shallow, middle, smoothstep(0.2, 3.2, d));
  c = mix(c, deep, smoothstep(4.0, 18.0, d));

  // Broad world-space wave bands add gentle water structure without pixel glitter.
  float waveA = 0.5 + 0.5 * sin(q.x * 0.014 + q.y * 0.009 + t * 0.42);
  float waveB = 0.5 + 0.5 * sin(q.x * 0.007 - q.y * 0.012 - t * 0.28);
  float wave = waveA * 0.58 + waveB * 0.42;
  c += vec3(0.010, 0.019, 0.026) * (wave - 0.5);

  float shore = 1.0 - smoothstep(0.2, 2.4, d);
  float foamBand = shore * smoothstep(0.76, 0.94, wave);
  c = mix(c, vec3(0.46, 0.58, 0.63), foamBand * 0.10);
  return c;
}`,
    `vec3 waterShade(vec3 p, vec3 rd, float depth, float footprint, out float glit) {
  glit = 0.0;
  float d = max(depth, 0.0);
  vec3 shallow = vec3(0.28, 0.61, 0.61);
  vec3 middle = vec3(0.22, 0.43, 0.53);
  vec3 deep = vec3(0.16, 0.32, 0.45);
  vec3 c = mix(shallow, middle, smoothstep(0.2, 4.5, d));
  c = mix(c, deep, smoothstep(6.0, 24.0, d));
  float broadWater = terrainNoise(p.xz, 32.0);
  c = mix(c, vec3(0.44, 0.38, 0.50), smoothstep(0.43, 0.82, broadWater) * 0.44);

  // 两个方向的水纹被长波扭弯；远处只保留宽波色带，不显示亚像素高光。
  vec2 waveUV = vec2(p.x + p.z, 3.0 * p.z - p.x) + vec2(35.0, 59.0) * broadWater;
  float swell = terrainNoise(waveUV, 64.0);
  float crests = terrainNoise(waveUV + swell * 19.0, 256.0);
  float fineWater = 1.0 - smoothstep(4.0, 20.0, footprint);
  float ripple = smoothstep(0.56, 0.85, crests) * fineWater;
  c += (swell - 0.5) * vec3(0.028, 0.048, 0.057);
  c = mix(c, vec3(0.37, 0.58, 0.62), ripple * 0.34);

  // 真实入射光关于水平面反射，再与朝向相机的水面光线比较。
  vec3 reflected = reflect(-normalize(uSunDir), vec3(0.0, 1.0, 0.0));
  vec3 reflectionRay = -normalize(rd);
  vec2 viewAz = reflectionRay.xz / max(length(reflectionRay.xz), 1e-4);
  vec2 reflectionAz = reflected.xz / max(length(reflected.xz), 1e-4);
  float azimuthPath = smoothstep(0.976, 0.9995, dot(viewAz, reflectionAz));
  float elevationPath = 1.0 - smoothstep(0.025, 0.18, abs(reflectionRay.y - reflected.y));
  // 天顶附近方位角不稳定，平滑改用反射线的夹角。
  float overheadPath = smoothstep(0.976, 0.9995, dot(reflectionRay, reflected));
  float sunPath = mix(overheadPath, azimuthPath * elevationPath, smoothstep(0.0, 0.20, length(reflected.xz)))
    * smoothstep(-0.03, 0.05, reflected.y);
  // 宽金色底光与稀疏短波纹并存，不把所有波纹染成发白的高光。
  c = mix(c, vec3(0.65, 0.47, 0.40), sunPath * 0.36);
  float farCrest = smoothstep(0.54, 0.83, swell) * 0.44 * (1.0 - smoothstep(50.0, 130.0, footprint));
  float warmedRipple = sunPath * (ripple * smoothstep(0.36, 0.66, swell) + (1.0 - fineWater) * farCrest);
  c = mix(c, vec3(1.0, 0.82, 0.46), warmedRipple * 0.84);

  float paleShore = 1.0 - smoothstep(0.8, 5.0, d);
  c = mix(c, vec3(0.66, 0.78, 0.70), paleShore * 0.38);
  return c;
}`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `waterShade(vec3(hp.x, 0.0, hp.z), rd, -hitH, dith, glit)`,
    `waterShade(vec3(hp.x, 0.0, hp.z), rd, -hitH, footprint, glit)`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `col = mix(col, hz, fog * 0.66);`,
    `col = mix(col, hz, fog * 0.86);`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `vec3 sunDiscColor() { return vec3(1.0, 0.97, 0.84); }`,
    `vec3 sunDiscColor() { return vec3(1.0, 0.92, 0.73); }`, 'SCENE_FS');
  __skyScene = __skyReplaceExactlyOnce(__skyScene,
    `  // alpine grade: cool shadows, neutral highlights, no warm cast
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.93, 0.97, 1.07), (1.0 - clamp(lum, 0.0, 1.0)) * 0.24);`,
    `  // 阴面保留淡紫环境光，而不是把青蓝水和草地一并压暗。
  col = mix(col, col * vec3(1.03, 0.98, 1.05), (1.0 - clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0)) * 0.12);
  col = min(col, vec3(1.0));`, 'SCENE_FS');

  __skyCloud = __skyReplaceExactlyOnce(__skyCloud,
    `      vec3 cLow = vec3(0.28, 0.33, 0.42);
      vec3 cMid = vec3(0.47, 0.53, 0.61);
      vec3 cHi  = vec3(0.73, 0.78, 0.84);
      vec3 cHot = vec3(0.88, 0.90, 0.93);`,
    `      vec3 cLow = vec3(0.41, 0.47, 0.53);
      vec3 cMid = vec3(0.63, 0.68, 0.73);
      vec3 cHi  = vec3(0.87, 0.84, 0.78);
      vec3 cHot = vec3(1.00, 0.93, 0.80);`, 'CLOUD_FS');
  __skyCloud = __skyReplaceExactlyOnce(__skyCloud,
    `      float lit = clamp(0.18 + hf * 0.86 - dSun * 0.95 + d * 0.14, 0.0, 1.0);`,
    `      float lit = clamp(0.18 + hf * 0.86 - dSun * 0.95 + d * 0.14, 0.0, 1.0);
      lit = floor(lit * 3.0 + 0.5) / 3.0;`, 'CLOUD_FS');
  __skyCloud = __skyReplaceExactlyOnce(__skyCloud,
    `  col = mix(col, vec3(0.55, 0.62, 0.70), fog * 0.6);`,
    `  col = mix(col, vec3(0.64, 0.72, 0.79), fog * 0.48);`, 'CLOUD_FS');

  __skyPost = __skyReplaceExactlyOnce(__skyPost,
    `  c = mix(c, vec3(0.70, 0.75, 0.81), uCloudWhite * 0.42);`,
    `  c = mix(c, vec3(0.92, 0.92, 0.89), uCloudWhite * 0.32);`, 'POST_FS');
  __skyPost = __skyReplaceExactlyOnce(__skyPost,
    `  // alpine grade: cool shadows, neutral highlights, restrained contrast
  c = max(c, vec3(0.0));
  c = pow(c, vec3(1.06, 1.04, 1.00));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 1.06);
  c = (c - 0.5) * 1.03 + 0.5;
  c = max(c, vec3(0.0));

  // Keep the grade smooth: screen-space ordered dithering created dense
  // bright speckles over large, nearly uniform terrain regions.
  c = mix(c, vec3(0.030, 0.040, 0.060), uFade);`,
    `  // 统一有限色阶；不附加屏幕空间白点或随时间闪烁的抖色。
  c = max(c, vec3(0.0));
  c = pow(c, vec3(1.02, 1.00, 0.98));
  c = (c - 0.5) * 1.025 + 0.5;
  c += vec3(0.008, 0.003, 0.004);
  c = clamp(c, 0.0, 1.0);
  c = floor(c * 31.0 + 0.5) / 31.0;
  c = mix(c, vec3(0.045, 0.035, 0.065), uFade);`, 'POST_FS');

  // 全部锚点成功后一次提交，失败时不留下半更新的材质。
  SCENE_FS = __skyScene;
  CLOUD_FS = __skyCloud;
  POST_FS = __skyPost;
  MESH_VS = __skyMesh;
  MESH_FS = __skyMeshFrag;
}
