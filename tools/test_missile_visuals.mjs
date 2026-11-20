#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const core = source('10_core.js');
const mathStart = core.indexOf('const clamp =');
const mathEnd = core.indexOf('// Bayer 4x4');
assert.ok(mathStart >= 0 && mathEnd > mathStart, 'core math section must be available');
const implementation = [core.slice(mathStart, mathEnd), source('40_game.js'), source('50_ui_hud.js')].join('\n');
const VW = 604, VH = 340;

function runtime() {
  const draws = [];
  const subject = vm.runInNewContext(`${implementation}\n({ G, buildCamera, projectToScreen, computeThreats, drawMissilesAndGlows });`, {
    VW, VH, TAU: Math.PI * 2,
    AudioSys: { missileWarning() {} },
    ctx: { save() {}, restore() {}, fillRect(...args) { draws.push(args); } },
  });
  subject.G.player = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, dead: false };
  subject.G.camera = subject.buildCamera({
    pos: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 }, fov: 1,
  });
  return { ...subject, draws };
}

for (const [direction, pos] of [
  ['up', { x: 0, y: 100, z: -1000 }],
  ['down', { x: 0, y: -100, z: -1000 }],
  ['left', { x: -100, y: 0, z: -1000 }],
  ['right', { x: 100, y: 0, z: -1000 }],
]) {
  test(`visible ${direction} missile warning uses its projected screen bearing`, () => {
    const { G, projectToScreen, computeThreats } = runtime();
    const missile = { pos, owner: 'enemy', dead: false };
    G.missiles = [missile];
    const sp = {};
    assert.equal(projectToScreen(pos, sp), true, 'projection returns a boolean and fills the output object');
    assert.equal(sp.visible, true);
    computeThreats();
    assert.equal(G.threatList.length, 1);
    assert.equal(G.threatList[0].m, missile);
    const expected = Math.atan2(sp.y - VH / 2, sp.x - VW / 2);
    const actual = G.threatList[0].ang;
    const error = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
    assert.ok(Math.abs(error) < 1e-10, `${direction}: expected screen angle ${expected}, got ${actual}`);
  });
}

test('off-screen missiles retain the existing horizontal bearing fallback', () => {
  const { G, projectToScreen, computeThreats } = runtime();
  const pos = { x: 2000, y: 0, z: -1000 }, sp = {};
  G.missiles = [{ pos, owner: 'enemy', dead: false }];
  assert.equal(projectToScreen(pos, sp), true);
  assert.equal(sp.visible, false);
  computeThreats();
  assert.equal(G.threatList.length, 1);
  assert.equal(G.threatList[0].ang, Math.atan2(pos.x, -pos.z));
});

test('visible missile still draws when only its 8m orientation reference is off-screen', () => {
  const { G, projectToScreen, drawMissilesAndGlows, draws } = runtime();
  G.player = null;
  G.missiles = [{ pos: { x: 5, y: 0, z: -10 }, vel: { x: -500, y: 0, z: 0 }, owner: 'enemy' }];
  for (const x of [5, 5 + 1.255, 5 - 2.28]) {
    const sp = {};
    assert.equal(projectToScreen({ x, y: 0, z: -10 }, sp), true);
    assert.ok(sp.x > 0 && sp.x < VW && sp.y > 0 && sp.y < VH, 'center, physical tail, and nose must all be on-screen');
  }
  const reference = {};
  assert.equal(projectToScreen({ x: 13, y: 0, z: -10 }, reference), true);
  assert.equal(reference.visible, false);
  drawMissilesAndGlows();
  assert.ok(draws.length > 0, 'off-screen reference must not cull the visible missile sprite');
});

test('orientation references behind the camera remain rejected', () => {
  const { G, projectToScreen, drawMissilesAndGlows, draws } = runtime();
  G.player = null;
  G.missiles = [{ pos: { x: 0, y: 0, z: -5 }, vel: { x: 0, y: 0, z: -500 }, owner: 'enemy' }];
  const center = {};
  assert.equal(projectToScreen(G.missiles[0].pos, center), true);
  assert.equal(center.visible, true);
  assert.equal(projectToScreen({ x: 0, y: 0, z: 3 }, {}), false);
  drawMissilesAndGlows();
  assert.equal(draws.length, 0);
});

test('an off-screen missile center remains culled', () => {
  const { G, projectToScreen, drawMissilesAndGlows, draws } = runtime();
  G.player = null;
  G.missiles = [{ pos: { x: 100, y: 0, z: -10 }, vel: { x: -500, y: 0, z: 0 }, owner: 'enemy' }];
  const center = {};
  assert.equal(projectToScreen(G.missiles[0].pos, center), true);
  assert.equal(center.visible, false);
  drawMissilesAndGlows();
  assert.equal(draws.length, 0);
});
