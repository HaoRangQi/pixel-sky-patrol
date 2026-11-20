// ---------------------------------------------------------------------------
// GLSL shaders — WebGL2 (GLSL ES 3.00). Low-res, dithered, no AA.
// ---------------------------------------------------------------------------
const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAYER_GLSL = `
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  const float B[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  return (B[i] + 0.5) / 16.0;
}`;

const CLOUD_GLSL = `
float cloudDensity(vec3 p) {
  if (p.y < uCloudBase - 2.0 || p.y > uCloudTop + 2.0) return 0.0;
  float hf = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
  vec3 q1 = vec3(p.x / uCloudSize + uWind.x, hf * 0.42 + 0.06, p.z / uCloudSize + uWind.z);
  float c1 = texture(uCloud, q1).r;
  vec3 q2 = vec3(p.x / 2280.0 - uWind.x * 1.6 + 0.31, hf * 0.28 + 0.52, p.z / 2280.0 + uWind.z * 1.4 + 0.17);
  float c2 = texture(uCloud, q2).r;
  float n = c1 * 0.76 + c2 * 0.24;
  float vert = smoothstep(0.0, 0.10, hf) * (1.0 - smoothstep(0.68, 1.0, hf));
  return smoothstep(0.555, 0.705, n) * vert;
}`;

const SCENE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform float uTanHalf;
uniform float uAspect;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uHeight;
uniform sampler2D uAux;
uniform sampler3D uCloud;
uniform mat4 uVP;
uniform vec3 uSunDir;
uniform float uWorldSize;
uniform float uCloudBase;
uniform float uCloudTop;
uniform float uCloudSize;
uniform vec3 uWind;
uniform float uMaxHeight;

${BAYER_GLSL}
${CLOUD_GLSL}

float heightAt(vec2 xz) { return texture(uHeight, xz / uWorldSize).r; }
vec4 auxAt(vec2 xz) { return texture(uAux, xz / uWorldSize); }

vec3 alpineHaze(vec3 rd) {
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  vec2 sa = normalize(uSunDir.xz);
  float face = pow(dot(az, sa) * 0.5 + 0.5, 2.0);
  vec3 away = vec3(0.44, 0.52, 0.60);
  vec3 lit  = vec3(0.65, 0.72, 0.77);
  vec3 c = mix(away, lit, face * 0.7);
  c = mix(c, vec3(0.56, 0.64, 0.72), smoothstep(0.0, 0.30, rd.y) * 0.24);
  return c;
}

vec3 skyColor(vec3 rd, out float disc) {
  float el = rd.y;
  float sunDot = max(dot(rd, uSunDir), 0.0);
  vec2 az = normalize(rd.xz + vec2(1e-4, 0.0));
  vec2 sa = normalize(uSunDir.xz);
  float face = pow(dot(az, sa) * 0.5 + 0.5, 2.0);

  // cold alpine sky: pale blue-grey at the horizon, deep slate overhead.
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
  return c;
}

float terrainHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float terrainNoise(vec2 xz, float cells) {
  vec2 q = fract(xz / uWorldSize) * cells;
  vec2 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  vec2 j = mod(i + 1.0, vec2(cells)), b = mod(i, vec2(cells));
  float a = terrainHash(b);
  float c = terrainHash(vec2(j.x, b.y));
  float d = terrainHash(vec2(b.x, j.y));
  float e = terrainHash(j);
  return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
}

vec3 terrainShade(vec3 p, float h, float footprint, float dith) {
  float e = 10.0;
  float hL = heightAt(p.xz - vec2(e, 0.0));
  float hR = heightAt(p.xz + vec2(e, 0.0));
  float hD = heightAt(p.xz - vec2(0.0, e));
  float hU = heightAt(p.xz + vec2(0.0, e));
  vec3 n = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
  vec4 aux = auxAt(p.xz);
  float forest = aux.g;
  float tintv = aux.b;
  float baked = aux.r;

  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
  float tone = 0.62 + 0.38 * smoothstep(0.0, 0.92, ndl);

  vec3 col;
  float hj = h;
  float snowLine = 560.0 + (tintv - 0.5) * 90.0;
  float broad = terrainNoise(p.xz, 16.0);
  float middleFade = 1.0 - smoothstep(8.0, 32.0, footprint);
  float fineFade = 1.0 - smoothstep(2.0, 8.0, footprint);
  float middle = mix(0.5, terrainNoise(p.xz, 256.0), middleFade);
  float fine = mix(0.5, terrainNoise(p.xz, 1024.0), fineFade);
  float groundGrain = (middle - 0.5) * 0.10 + (fine - 0.5) * 0.035;

  // Broad clearings and slope shapes carry the material; unresolved grain returns to its mean.
  float clearings = smoothstep(0.52, 0.82, broad);
  float forestMask = smoothstep(0.24, 0.68, forest + (broad - 0.5) * 0.12);
  forestMask *= 1.0 - clearings * 0.42;
  forestMask *= smoothstep(2.0, 18.0, hj) * (1.0 - smoothstep(snowLine + 120.0, snowLine + 300.0, hj));
  float rockMask = max(smoothstep(0.24, 0.50, slope + (broad - 0.5) * 0.06), smoothstep(snowLine + 80.0, snowLine + 260.0, hj));
  float sandMask = (1.0 - smoothstep(8.0, 40.0, hj)) * (1.0 - smoothstep(0.18, 0.42, slope));

  float meadowVar = clamp(broad + groundGrain, 0.0, 1.0);
  vec3 meadow = mix(vec3(0.22, 0.29, 0.17), vec3(0.30, 0.36, 0.22), meadowVar);
  meadow = mix(meadow, vec3(0.37, 0.35, 0.23), clearings * 0.16);

  float canopyVar = clamp(broad + groundGrain, 0.0, 1.0);
  vec3 canopy = mix(vec3(0.075, 0.145, 0.085), vec3(0.145, 0.235, 0.125), canopyVar);
  float autumnGroves = smoothstep(0.72, 0.92, broad) * (0.12 + 0.10 * smoothstep(180.0, snowLine - 30.0, hj));
  canopy = mix(canopy, vec3(0.36, 0.28, 0.12), autumnGroves);

  float rockVar = clamp(broad + (middle - 0.5) * 0.08, 0.0, 1.0);
  vec3 rock = mix(vec3(0.25, 0.275, 0.28), vec3(0.39, 0.40, 0.385), rockVar);
  rock = mix(rock, vec3(0.42, 0.38, 0.30), smoothstep(0.68, 0.90, broad) * 0.12);
  vec3 sand = mix(vec3(0.40, 0.39, 0.32), vec3(0.52, 0.48, 0.37), clamp(broad + groundGrain, 0.0, 1.0));
  col = mix(meadow, canopy, forestMask);
  col = mix(col, sand, sandMask * (1.0 - forestMask));
  col = mix(col, rock, rockMask);

  float snowCoverage = hj + (broad - 0.5) * 150.0 + (middle - 0.5) * 8.0;
  float snowMask = smoothstep(snowLine - 110.0, snowLine + 150.0, snowCoverage);
  snowMask *= 1.0 - smoothstep(0.38, 0.72, slope) * 0.42;
  snowMask *= 1.0 - forestMask * 0.48;
  vec3 snowCol = mix(vec3(0.62, 0.65, 0.68), vec3(0.76, 0.78, 0.79), clamp(broad + groundGrain * 0.25, 0.0, 1.0));
  snowCol = mix(snowCol, vec3(0.53, 0.57, 0.62), clamp(slope * 0.72, 0.0, 0.45));
  col = mix(col, snowCol, snowMask);

  col *= tone;
  // Neutral daylight preserves meadow greens and the restrained autumn groves.
  vec3 sunTint = vec3(1.04, 1.04, 1.02);
  vec3 skyFill = vec3(0.90, 0.94, 0.98);
  col *= mix(skyFill, sunTint, ndl * 0.85);

  // Baked ridge shadows stay neutral rather than washing green surfaces blue.
  float sh = smoothstep(0.12, 0.72, baked + (dith - 0.5) * 0.18);
  vec3 shadowTint = vec3(0.69, 0.73, 0.77);
  col = mix(col, col * shadowTint + vec3(0.004, 0.006, 0.008), sh * 0.80);

  // aux alpha encodes tree-shadow visibility; 155 keeps grove shadow soft.
  float treeVisibility = clamp(aux.a, 155.0 / 255.0, 1.0);
  col *= treeVisibility;

  // cumulus shadows drifting over the land
  float midY = mix(uCloudBase, uCloudTop, 0.46);
  if (p.y < midY - 20.0) {
    float tSun = (midY - p.y) / max(uSunDir.y, 0.08);
    vec3 sp = p + uSunDir * tSun;
    float cs = cloudDensity(sp);
    float csh = smoothstep(0.06, 0.6, cs);
    col = mix(col, col * vec3(0.60, 0.66, 0.80) + vec3(0.006, 0.010, 0.018), csh * 0.48);
  }
  return col;
}

vec3 waterShade(vec3 p, vec3 rd, float depth, float dith, out float glit) {
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
}

vec3 sunDiscColor() { return vec3(1.0, 0.97, 0.84); }

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  float dith = 0.5; // 固定材质阈值，避免屏幕空间 Bayer 图案形成白点噪声。

  float t = 2.0;
  float tPrev = 1.0;
  float hitT = -1.0;
  float hitH = 0.0;
  bool isWater = false;
  float maxMarch = 7600.0;

  for (int i = 0; i < 130; i++) {
    vec3 p = uCamPos + rd * t;
    if (p.y > uMaxHeight + 260.0 && rd.y > 0.0) break;
    float h = heightAt(p.xz);
    float surf = max(h, 0.0);
    if (p.y <= surf) {
      float t0 = tPrev, t1 = t;
      for (int k = 0; k < 6; k++) {
        float tm = (t0 + t1) * 0.5;
        vec3 pm = uCamPos + rd * tm;
        float hm = heightAt(pm.xz);
        if (pm.y <= max(hm, 0.0)) t1 = tm; else t0 = tm;
      }
      hitT = t1;
      vec3 hp = uCamPos + rd * hitT;
      hitH = heightAt(hp.xz);
      isWater = hitH < 0.0;
      break;
    }
    float clearance = p.y - surf;
    float stepT = max(2.2, clearance * 0.36 + t * 0.0075);
    tPrev = t;
    t += stepT;
    if (t > maxMarch) break;
  }

  vec3 col;
  vec3 hitPos = uCamPos + rd * max(hitT, 0.0);
  float footprint = max(fwidth(hitPos.x), fwidth(hitPos.z));
  if (hitT > 0.0) {
    vec3 hp = uCamPos + rd * hitT;
    if (isWater) {
      float glit;
      col = waterShade(vec3(hp.x, 0.0, hp.z), rd, -hitH, dith, glit);
    } else {
      col = terrainShade(hp, hitH, footprint, dith);
    }
    float fog = smoothstep(1200.0, 7000.0, hitT);
    vec3 hz = alpineHaze(rd);
    col = mix(col, hz, fog * 0.66);
    vec4 clip = uVP * vec4(hp, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    float disc;
    col = skyColor(rd, disc);
    gl_FragDepth = 1.0;
  }
  // alpine grade: cool shadows, neutral highlights, no warm cast
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.93, 0.97, 1.07), (1.0 - clamp(lum, 0.0, 1.0)) * 0.24);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform float uTanHalf;
uniform float uAspect;
uniform vec2 uRes;
uniform float uTime;
uniform sampler3D uCloud;
uniform mat4 uVP;
uniform vec3 uSunDir;
uniform float uCloudBase;
uniform float uCloudTop;
uniform float uCloudSize;
uniform vec3 uWind;
uniform float uCloudOn;

${BAYER_GLSL}
${CLOUD_GLSL}

vec4 marchClouds(vec3 rd, out float firstT) {
  firstT = -1.0;
  if (uCloudOn < 0.5) return vec4(0.0);
  float t0, t1;
  if (abs(rd.y) > 0.0001) {
    t0 = (uCloudBase - uCamPos.y) / rd.y;
    t1 = (uCloudTop - uCamPos.y) / rd.y;
    if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
  } else {
    if (uCamPos.y < uCloudBase || uCamPos.y > uCloudTop) return vec4(0.0);
    t0 = 0.0; t1 = 9000.0;
  }
  float tStart = max(t0, 1.0);
  float tEnd = min(t1, 7200.0);
  if (tEnd <= tStart + 2.0) return vec4(0.0);

  const int STEPS = 34;
  float stepLen = (tEnd - tStart) / float(STEPS);
  float jitter = 0.5;
  float t = tStart + stepLen * jitter;
  float trans = 1.0;
  vec3 acc = vec3(0.0);
  float firstDense = -1.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCamPos + rd * t;
    float d = cloudDensity(p);
    if (d > 0.015) {
      float alpha = 1.0 - exp(-d * stepLen * 0.038);
      float hf = clamp((p.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
      float dSun = cloudDensity(p + uSunDir * 85.0);
      float lit = clamp(0.18 + hf * 0.86 - dSun * 0.95 + d * 0.14, 0.0, 1.0);
      float idx = lit * 3.0;
      vec3 cLow = vec3(0.28, 0.33, 0.42);
      vec3 cMid = vec3(0.47, 0.53, 0.61);
      vec3 cHi  = vec3(0.73, 0.78, 0.84);
      vec3 cHot = vec3(0.88, 0.90, 0.93);
      vec3 cc;
      if (idx < 1.0) cc = mix(cLow, cMid, clamp(idx, 0.0, 1.0));
      else if (idx < 2.0) cc = mix(cMid, cHi, clamp(idx - 1.0, 0.0, 1.0));
      else cc = mix(cHi, cHot, clamp(idx - 2.0, 0.0, 1.0));
      acc += cc * alpha * trans;
      trans *= (1.0 - alpha);
      if (firstDense < 0.0 && d > 0.12) firstDense = t;
      if (trans < 0.02) break;
    }
    t += stepLen;
  }
  float a = 1.0 - trans;
  if (a < 0.015) return vec4(0.0);
  vec3 col = acc / max(a, 0.0001);
  float fog = smoothstep(2000.0, 6600.0, t);
  col = mix(col, vec3(0.55, 0.62, 0.70), fog * 0.6);
  // from far above, fade the deck so the tactical view stays legible
  float above = smoothstep(uCloudTop + 120.0, uCloudTop + 1300.0, uCamPos.y);
  a *= mix(1.0, 0.20, above);
  firstT = firstDense > 0.0 ? firstDense : tStart + stepLen;
  return vec4(col, clamp(a, 0.0, 0.96));
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  float ft;
  vec4 c = marchClouds(rd, ft);
  if (c.a < 0.015) discard;
  vec3 hit = uCamPos + rd * ft;
  vec4 clip = uVP * vec4(hit, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  fragColor = c;
}`;

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in float aEmi;
layout(location = 4) in vec4 aInstance;
layout(location = 5) in vec4 aVariation;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uTint;
uniform float uOutline;
uniform float uRim;
uniform float uInstanced;
out vec3 vCol;
out float vEmi;
void main() {
  vec4 wp;
  vec3 base;
  if (uInstanced > 0.5) {
    vec3 instanceScale = vec3(aInstance.w * aVariation.z, aInstance.w, aInstance.w * aVariation.z);
    vec3 local = aPos * instanceScale;
    vec2 rotated = vec2(aVariation.x * local.x + aVariation.y * local.z,
                        -aVariation.y * local.x + aVariation.x * local.z);
    wp = vec4(rotated.x + aInstance.x, local.y + aInstance.y, rotated.y + aInstance.z, 1.0);
    vec3 localNormal = aNor / instanceScale;
    vec3 rotatedNormal = vec3(aVariation.x * localNormal.x + aVariation.y * localNormal.z,
                              localNormal.y,
                              -aVariation.y * localNormal.x + aVariation.x * localNormal.z);
    vec3 n = normalize(rotatedNormal);
    float ndl = max(dot(n, uSunDir), 0.0);
    float treeTone = 0.76 + 0.24 * ndl;
    float canopyOcclusion = mix(0.72, 1.0, smoothstep(4.0, 30.0, aPos.y));
    base = aCol * uTint * aVariation.w * treeTone * canopyOcclusion;
  } else {
    wp = uModel * vec4(aPos, 1.0);
    vec3 n = normalize(mat3(uModel) * aNor);
    float ndl = dot(n, uSunDir);
    float q = floor(clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * 3.0) / 2.0;
    float tone = 0.67 + q * 0.33;
    base = aCol * tone * uTint;
    float warm = pow(max(ndl, 0.0), 2.2);
    base += vec3(0.08, 0.08, 0.07) * warm;
    vec3 vdir = normalize(uCamPos - wp.xyz);
    float rim = pow(1.0 - clamp(dot(n, vdir), 0.0, 1.0), 3.0);
    base += vec3(0.32, 0.39, 0.50) * rim * 0.75 * uRim;
    base += vec3(0.045, 0.050, 0.080);
  }
  gl_Position = uVP * wp;
  vec3 emissive = aCol * 1.85 + vec3(0.05, 0.02, 0.0);
  vCol = mix(base, emissive, aEmi * (1.0 - uInstanced));
  vEmi = aEmi;
  if (uOutline > 0.5) vCol = vec3(0.022, 0.028, 0.045);
  float d = distance(uCamPos, wp.xyz);
  float fog = smoothstep(1500.0, 7600.0, d);
  vCol = mix(vCol, vec3(0.54, 0.61, 0.70), fog * 0.55);
}`;

const MESH_FS = `#version 300 es
precision highp float;
uniform float uAlpha;
in vec3 vCol;
in float vEmi;
out vec4 fragColor;
void main() {
  fragColor = vec4(vCol, uAlpha);
}`;

const POST_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uDamage;
uniform float uCloudWhite;
uniform float uTime;
uniform float uFade;

${BAYER_GLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb;

  // damage flash at the edges
  float v = length((uv - 0.5) * vec2(1.0, 1.15));
  float edge = smoothstep(0.35, 0.85, v);
  c = mix(c, vec3(0.72, 0.10, 0.09), edge * uDamage * 0.75);

  // cloud whiteout when the aircraft is inside a cumulus
  c = mix(c, vec3(0.70, 0.75, 0.81), uCloudWhite * 0.42);

  // subtle vignette
  c *= 1.0 - edge * 0.24;

  // alpine grade: cool shadows, neutral highlights, restrained contrast
  c = max(c, vec3(0.0));
  c = pow(c, vec3(1.06, 1.04, 1.00));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 1.06);
  c = (c - 0.5) * 1.03 + 0.5;
  c = max(c, vec3(0.0));

  // Keep the grade smooth: screen-space ordered dithering created dense
  // bright speckles over large, nearly uniform terrain regions.
  c = mix(c, vec3(0.030, 0.040, 0.060), uFade);
  fragColor = vec4(c, 1.0);
}`;
