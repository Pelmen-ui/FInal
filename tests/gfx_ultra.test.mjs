import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    SHADER_PRESETS,
    computePostFxParams,
    projectSunToScreen,
    ULTRA_SKY_VERTEX,
    ULTRA_SKY_FRAGMENT,
    ULTRA_POSTFX_SHADER
} from '../src/gfx/ultra_shaders.js';

test('computePostFxParams scales sharpening, god rays, anamorphic streaks, and SSAO across quality tiers', () => {
    const ultra = computePostFxParams('ultra', 'bodycam');
    const high = computePostFxParams('high', 'bodycam');
    const medium = computePostFxParams('medium', 'bodycam');
    const low = computePostFxParams('low', 'bodycam');

    assert.equal(ultra.ssaoEnabled, true);
    assert.equal(high.ssaoEnabled, false);
    assert.equal(medium.ssaoEnabled, false);
    assert.equal(low.ssaoEnabled, false);

    assert.ok(ultra.sharpen > high.sharpen && high.sharpen > medium.sharpen);
    assert.ok(ultra.godRayStrength > high.godRayStrength && high.godRayStrength > medium.godRayStrength);
    assert.equal(low.godRayStrength, 0);
    assert.ok(ultra.anamorphicStrength > high.anamorphicStrength && medium.anamorphicStrength === 0);

    const cine = computePostFxParams('ultra', 'cinematic');
    assert.ok(cine.saturation > ultra.saturation);
    assert.ok(cine.distort < ultra.distort);
    assert.equal(SHADER_PRESETS.cinematic.exposure, cine.exposure);
});

test('projectSunToScreen tracks sun visibility accurately when facing vs facing away', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.position.set(0, 1.7, 0);
    camera.lookAt(0, 1.7, -10);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const sunInFront = new THREE.Vector3(0.25, 0.35, -0.90).normalize();
    const front = projectSunToScreen(camera, sunInFront, { x: 0, y: 0, visibility: 0 });
    assert.ok(front.visibility > 0.5, `expected strong sun visibility in front, got ${front.visibility}`);
    assert.ok(front.x > 0.5 && front.x < 1.0, `expected right-of-center sun x, got ${front.x}`);
    assert.ok(front.y > 0.5 && front.y < 1.0, `expected upper-half sun y, got ${front.y}`);

    const sunBehind = new THREE.Vector3(0, 0.3, 0.95).normalize();
    const behind = projectSunToScreen(camera, sunBehind, { x: 0, y: 0, visibility: 1 });
    assert.equal(behind.visibility, 0);
});

test('Ultra GLSL shaders contain required uniforms, volumetric clouds, CAS sharpen, god rays, and tone mapping', () => {
    assert.ok(ULTRA_SKY_VERTEX.includes('gl_Position = clip.xyww'));
    assert.ok(ULTRA_SKY_FRAGMENT.includes('uniform vec3 uMidSky'));
    assert.ok(ULTRA_SKY_FRAGMENT.includes('SKY_CLOUDS'));
    assert.ok(ULTRA_SKY_FRAGMENT.includes('fbm('));
    assert.ok(ULTRA_SKY_FRAGMENT.includes('#include <tonemapping_fragment>'));

    const frag = ULTRA_POSTFX_SHADER.fragmentShader;
    assert.ok(frag.includes('uniform vec2 uSunScreenPos'));
    assert.ok(frag.includes('uniform float uGodRayStrength'));
    assert.ok(frag.includes('uniform float uSharpen'));
    assert.ok(frag.includes('uniform float uAnamorphicStrength'));
    assert.ok(frag.includes('uniform float uTrauma'));
    assert.ok(frag.includes('#include <tonemapping_fragment>'));
    assert.ok(frag.includes('#include <colorspace_fragment>'));
});
