// ---------------------------------------------------------------------------
// RENDERER — WebGL2 world (raymarched), meshes, clouds, post.
// ---------------------------------------------------------------------------
const Renderer = (() => {
  let gl = null;
  let sceneProg = null, cloudProg = null, meshProg = null, postProg = null;
  let sceneU = {}, cloudU = {}, meshU = {}, postU = {};
  let emptyVAO = null;
  let sceneFBO = null, sceneTex = null, depthRB = null;
  let heightTex = null, auxTex = null, cloudTex = null;
  let fboW = 0, fboH = 0;
  let worldReady = false;
  let glLost = false;
  let currentUintAux = null;

  function compile(type, src, name) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
      throw new Error(`Shader compile failed (${name}): ${log}\n${lines}`);
    }
    return s;
  }
  function program(vsrc, fsrc, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsrc, name + '.vs'));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program link failed (${name}): ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }
  function uniforms(p, names) {
    const o = {};
    for (const n of names) o[n] = gl.getUniformLocation(p, n);
    return o;
  }
  function tex2D(w, h, internal, format, type, data, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  }

  function init(canvas) {
    gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    if (!gl) return false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); glLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { glLost = false; });

    sceneProg = program(FULLSCREEN_VS, SCENE_FS, 'scene');
    cloudProg = program(FULLSCREEN_VS, CLOUD_FS, 'cloud');
    meshProg = program(MESH_VS, MESH_FS, 'mesh');
    postProg = program(FULLSCREEN_VS, POST_FS, 'post');
    sceneU = uniforms(sceneProg, ['uCamPos', 'uCamR', 'uCamU', 'uCamF', 'uTanHalf', 'uAspect', 'uRes',
      'uTime', 'uHeight', 'uAux', 'uCloud', 'uVP', 'uSunDir', 'uWorldSize', 'uCloudBase',
      'uCloudTop', 'uCloudSize', 'uWind', 'uMaxHeight']);
    cloudU = uniforms(cloudProg, ['uCamPos', 'uCamR', 'uCamU', 'uCamF', 'uTanHalf', 'uAspect', 'uRes',
      'uTime', 'uCloud', 'uVP', 'uSunDir', 'uCloudBase', 'uCloudTop', 'uCloudSize', 'uWind', 'uCloudOn']);
    meshU = uniforms(meshProg, ['uVP', 'uModel', 'uSunDir', 'uCamPos', 'uTint', 'uOutline', 'uAlpha', 'uRim', 'uInstanced']);
    postU = uniforms(postProg, ['uScene', 'uRes', 'uDamage',
      'uCloudWhite', 'uTime', 'uFade']);

    emptyVAO = gl.createVertexArray();
    const linearFloat = !!gl.getExtension('OES_texture_float_linear');
    Renderer.linearFloat = linearFloat;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(0.04, 0.03, 0.06, 1);
    worldReady = false;
    glLost = false;
    return true;
  }

  function uploadWorld(map) {
    if (!gl) return;
    if (heightTex) gl.deleteTexture(heightTex);
    if (auxTex) gl.deleteTexture(auxTex);
    if (cloudTex) gl.deleteTexture(cloudTex);
    const filter = Renderer.linearFloat ? gl.LINEAR : gl.NEAREST;
    heightTex = tex2D(HMAP_N, HMAP_N, gl.R32F, gl.RED, gl.FLOAT, map.heights, filter);
    const aux = new Uint8Array(HMAP_N * HMAP_N * 4);
    for (let i = 0; i < HMAP_N * HMAP_N; i++) {
      aux[i * 4] = map.shadow[i];
      aux[i * 4 + 1] = map.forest[i];
      aux[i * 4 + 2] = map.tint[i];
      aux[i * 4 + 3] = map.treeShade ? map.treeShade[i] : 255;
    }
    currentUintAux = aux;
    auxTex = tex2D(HMAP_N, HMAP_N, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, aux, gl.LINEAR);
    // cloud volume
    cloudTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, cloudTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, map.cloudN, map.cloudN, map.cloudN, 0, gl.RED, gl.UNSIGNED_BYTE, map.cloudTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    worldReady = true;
  }

  function resize(w, h) {
    if (!gl) return;
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === fboW && h === fboH && sceneFBO) return;
    fboW = w; fboH = h;
    if (sceneFBO) { gl.deleteFramebuffer(sceneFBO); sceneFBO = null; }
    if (sceneTex) { gl.deleteTexture(sceneTex); sceneTex = null; }
    if (depthRB) { gl.deleteRenderbuffer(depthRB); depthRB = null; }
    sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    depthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) console.error('FBO incomplete', status);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------------------------------------------------------------- meshes
  function createMesh(data) {
    const pos = new Float32Array(data.pos);
    const nor = new Float32Array(data.nor);
    const col = new Float32Array(data.col);
    const emi = new Float32Array(data.emi);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function attr(arr, loc, n) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    }
    attr(pos, 0, 3); attr(nor, 1, 3); attr(col, 2, 3); attr(emi, 3, 1);
    gl.bindVertexArray(null);
    return { vao, count: pos.length / 3, radius: data.radius || 6, height: data.height, crownRadius: data.crownRadius, crownBase: data.crownBase };
  }

  function uploadInstances(mesh, instances) {
    if (!mesh.instanceBuffer) {
      gl.bindVertexArray(mesh.vao);
      mesh.instanceBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
      mesh.instanceCapacity = 9000;
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceCapacity * 32, gl.DYNAMIC_DRAW);
      for (const [loc, offset] of [[4, 0], [5, 16]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, offset);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instanceBuffer);
    if (instances.length / 8 > mesh.instanceCapacity) {
      mesh.instanceCapacity = instances.length / 8;
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceCapacity * 32, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances);
  }

  function scaledMatrix(out, m, s) {
    out[0] = m[0] * s; out[1] = m[1] * s; out[2] = m[2] * s; out[3] = m[3];
    out[4] = m[4] * s; out[5] = m[5] * s; out[6] = m[6] * s; out[7] = m[7];
    out[8] = m[8] * s; out[9] = m[9] * s; out[10] = m[10] * s; out[11] = m[11];
    out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15];
    return out;
  }
  const tmpMatrix = mat4();

  // --------------------------------------------------------------- render
  function render(cam, map, time, drawables, fx) {
    if (!gl || !worldReady || glLost) return;
    const W = fboW, H = fboH;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.ALWAYS);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- scene raymarch
    gl.useProgram(sceneProg);
    gl.bindVertexArray(emptyVAO);
    gl.uniform3f(sceneU.uCamPos, cam.pos.x, cam.pos.y, cam.pos.z);
    gl.uniform3f(sceneU.uCamR, cam.right.x, cam.right.y, cam.right.z);
    gl.uniform3f(sceneU.uCamU, cam.up.x, cam.up.y, cam.up.z);
    gl.uniform3f(sceneU.uCamF, cam.fwd.x, cam.fwd.y, cam.fwd.z);
    gl.uniform1f(sceneU.uTanHalf, Math.tan(cam.fov * 0.5));
    gl.uniform1f(sceneU.uAspect, W / H);
    gl.uniform2f(sceneU.uRes, W, H);
    gl.uniform1f(sceneU.uTime, time);
    gl.uniformMatrix4fv(sceneU.uVP, false, cam.vp);
    gl.uniform3f(sceneU.uSunDir, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
    gl.uniform1f(sceneU.uWorldSize, WORLD_SIZE);
    gl.uniform1f(sceneU.uCloudBase, CLOUD_BASE);
    gl.uniform1f(sceneU.uCloudTop, CLOUD_TOP);
    gl.uniform1f(sceneU.uCloudSize, CLOUD_SIZE);
    gl.uniform3f(sceneU.uWind, map.cloudDriftX, 0, map.cloudDriftZ);
    gl.uniform1f(sceneU.uMaxHeight, Math.max(1300, map.maxH));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heightTex); gl.uniform1i(sceneU.uHeight, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, auxTex); gl.uniform1i(sceneU.uAux, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, cloudTex); gl.uniform1i(sceneU.uCloud, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- meshes
    if (drawables && drawables.length) {
      gl.useProgram(meshProg);
      gl.uniformMatrix4fv(meshU.uVP, false, cam.vp);
      gl.uniform3f(meshU.uSunDir, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
      gl.uniform3f(meshU.uCamPos, cam.pos.x, cam.pos.y, cam.pos.z);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      drawables.sort((a, b) => b.dist - a.dist);
      for (const d of drawables) {
        if (!d.mesh || d.alpha === 0) continue;
        if (d.instances && d.instanceCount > 0) {
          gl.uniform1f(meshU.uInstanced, 1);
          gl.uniform1f(meshU.uRim, d.rim === false ? 0 : 1);
          gl.uniform1f(meshU.uOutline, 0);
          gl.uniform1f(meshU.uAlpha, d.alpha === undefined ? 1 : d.alpha);
          const tint = d.tint || [1, 1, 1];
          gl.uniform3f(meshU.uTint, tint[0], tint[1], tint[2]);
          gl.uniformMatrix4fv(meshU.uModel, false, d.matrix);
          uploadInstances(d.mesh, d.instances);
          gl.bindVertexArray(d.mesh.vao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, d.mesh.count, d.instanceCount);
          continue;
        }
        const dist = Math.max(8, d.dist);
        const pixWorld = 2 * dist * Math.tan(cam.fov * 0.5) / Math.max(120, H);
        const outlineScale = clamp(1 + (2.4 * pixWorld) / Math.max(2, d.mesh.radius), 1.012, 1.5);
        // outline
        if (d.outline !== false) {
          gl.uniform1f(meshU.uInstanced, 0);
          gl.uniform1f(meshU.uRim, d.rim === false ? 0 : 1);
          gl.uniform1f(meshU.uOutline, 1);
          gl.uniform1f(meshU.uAlpha, 0.95);
          gl.uniform3f(meshU.uTint, 1, 1, 1);
          scaledMatrix(tmpMatrix, d.matrix, outlineScale);
          gl.uniformMatrix4fv(meshU.uModel, false, tmpMatrix);
          // Draw the silhouette shell without writing depth: the fill that
          // follows must be able to overwrite the shell's interior, otherwise
          // the expanded shell occludes the model at close range.
          gl.depthMask(false);
          gl.bindVertexArray(d.mesh.vao);
          gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
          gl.depthMask(true);
        }
        // fill
        gl.uniform1f(meshU.uInstanced, 0);
        gl.uniform1f(meshU.uRim, d.rim === false ? 0 : 1);
        gl.uniform1f(meshU.uOutline, 0);
        gl.uniform1f(meshU.uAlpha, d.alpha === undefined ? 1 : d.alpha);
        const t = d.tint || [1, 1, 1];
        gl.uniform3f(meshU.uTint, t[0], t[1], t[2]);
        gl.uniformMatrix4fv(meshU.uModel, false, d.matrix);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
      }
    }

    // ---- volumetric cumulus, depth-tested so aircraft can slip behind clouds
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(cloudProg);
    gl.bindVertexArray(emptyVAO);
    gl.uniform3f(cloudU.uCamPos, cam.pos.x, cam.pos.y, cam.pos.z);
    gl.uniform3f(cloudU.uCamR, cam.right.x, cam.right.y, cam.right.z);
    gl.uniform3f(cloudU.uCamU, cam.up.x, cam.up.y, cam.up.z);
    gl.uniform3f(cloudU.uCamF, cam.fwd.x, cam.fwd.y, cam.fwd.z);
    gl.uniform1f(cloudU.uTanHalf, Math.tan(cam.fov * 0.5));
    gl.uniform1f(cloudU.uAspect, W / H);
    gl.uniform2f(cloudU.uRes, W, H);
    gl.uniform1f(cloudU.uTime, time);
    gl.uniformMatrix4fv(cloudU.uVP, false, cam.vp);
    gl.uniform3f(cloudU.uSunDir, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
    gl.uniform1f(cloudU.uCloudBase, CLOUD_BASE);
    gl.uniform1f(cloudU.uCloudTop, CLOUD_TOP);
    gl.uniform1f(cloudU.uCloudSize, CLOUD_SIZE);
    gl.uniform3f(cloudU.uWind, map.cloudDriftX, 0, map.cloudDriftZ);
    gl.uniform1f(cloudU.uCloudOn, fx.cloudOn === false ? 0 : 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, cloudTex); gl.uniform1i(cloudU.uCloud, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);

    // ---- post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(postProg);
    gl.bindVertexArray(emptyVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(postU.uScene, 0);
    gl.uniform2f(postU.uRes, W, H);
    gl.uniform1f(postU.uDamage, fx.damage || 0);
    gl.uniform1f(postU.uCloudWhite, fx.cloudWhite || 0);
    gl.uniform1f(postU.uTime, time);
    gl.uniform1f(postU.uFade, fx.fade || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return {
    init, uploadWorld, resize, render, createMesh,
    get gl() { return gl; },
    get ready() { return worldReady; },
    set ready(v) { worldReady = v; }
  };
})();
