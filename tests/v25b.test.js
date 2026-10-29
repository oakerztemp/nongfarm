// V25 B tests (CONTRACT_V25 §4): farm-name sign texture.
import { test, assert } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { makeSignTexture } from '../js/world3d/signText.js';

test('v25b sign texture: short / long / empty / Thai-without-spaces text do not throw', () => {
  for (const t of ['ฟาร์ม', 'ฟาร์มน้องๆ ของ หนูนา ผู้น่ารักที่สุดในโลก', '', 'ฟาร์มสุขสันต์วันนี้ไม่มีช่องว่างเลยสักนิดเดียว', null, undefined, 'x'.repeat(60)]) {
    const s = makeSignTexture(THREE, t);
    assert(s && s.texture && typeof s.setText === 'function' && typeof s.dispose === 'function', 'API');
    s.dispose();
  }
});

test('v25b sign texture: setText bumps texture.version; dispose works; options respected', () => {
  const s = makeSignTexture(THREE, 'ฟาร์มน้องๆ', { width: 256, height: 80 });
  const v = s.texture.version;
  s.setText('ชื่อใหม่ ของฟาร์ม');
  assert(s.texture.version > v, 'version increased');
  if (s.texture.image && s.texture.image.width) assert(s.texture.image.width === 256 || s.texture.image.width === 1, 'size');
  s.dispose();
  s.dispose();
});
