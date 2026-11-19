import * as THREE from 'three';
import {
    ULTRA_SKY_VERTEX,
    ULTRA_SKY_FRAGMENT,
    enhanceGroundMaterialShader,
    createInstancedSteppeGrass
} from '../gfx/ultra_shaders.js';

const ZENITH = 0x38577a;
const MID_SKY = 0x7392b0;
const HORIZON = 0xcbbca6;
const GROUND_BOUNCE = 0x4a4236;
const SUN_GLOW = 0xffdca4;

const GROUND_SIZE = 600;
const GROUND_TILE = 7;
const FOG_REACH = 1.65;
const ENV_INTENSITY = 1.32;
const HEMI_WITH_IBL = 0.90;
const HEMI_NO_IBL = 1.40;
const EXPOSURE = 1.16;

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function noiseLayer(size, period, rand) {
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    const out = new Float32Array(size * size);
    const k = period / size;
    for (let y = 0; y < size; y++) {
        const fy = y * k;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const r0 = (y0 % period) * period;
        const r1 = ((y0 + 1) % period) * period;
        for (let x = 0; x < size; x++) {
            const fx = x * k;
            const x0 = Math.floor(fx);
            const tx = fx - x0;
            const sx = tx * tx * (3 - 2 * tx);
            const c0 = x0 % period;
            const c1 = (x0 + 1) % period;
            const a = lattice[r0 + c0];
            const b = lattice[r0 + c1];
            const c = lattice[r1 + c0];
            const d = lattice[r1 + c1];
            out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        }
    }
    return out;
}

function smooth(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

function paintGround(size) {
    const rand = mulberry32(90210);
    const layer = (period) => noiseLayer(size, Math.min(period, size >> 1), rand);
    const m1 = layer(3);
    const m2 = layer(7);
    const d1 = layer(16);
    const d2 = layer(37);
    const d3 = layer(80);
    const g1 = layer(128);
    const g2 = layer(256);

    const albedo = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
        const detail = d1[i] * 0.5 + d2[i] * 0.3 + d3[i] * 0.2;
        const grit = g1[i] * 0.55 + g2[i] * 0.45;
        const grass = smooth(0.48, 0.65, m1[i] * 0.45 + m2[i] * 0.35 + d1[i] * 0.2 + (d2[i] - 0.5) * 0.3);
        const pebble = smooth(0.68, 0.79, g1[i]) * (1 - grass);
        const speck = (grit - 0.5) * 24;

        let r = 108 + detail * 44 + speck;
        let g = 96 + detail * 38 + speck;
        let b = 76 + detail * 28 + speck * 0.9;
        r += (74 + detail * 30 + speck * 1.2 - r) * grass;
        g += (86 + detail * 34 + speck * 1.3 - g) * grass;
        b += (52 + detail * 20 + speck * 0.8 - b) * grass;
        const stone = 118 + grit * 28;
        r += (stone - r) * pebble * 0.58;
        g += (stone - 3 - g) * pebble * 0.58;
        b += (stone - 9 - b) * pebble * 0.58;

        const o = i * 4;
        albedo[o] = r;
        albedo[o + 1] = g;
        albedo[o + 2] = b;
        albedo[o + 3] = 255;
        height[i] = detail * 0.55 + grit * 0.25 + pebble * 0.55 + grass * grit * 0.35;
    }

    const normal = new Uint8ClampedArray(size * size * 4);
    const strength = size / 128;
    const mask = size - 1;
    for (let y = 0; y < size; y++) {
        const up = ((y - 1) & mask) * size;
        const down = ((y + 1) & mask) * size;
        for (let x = 0; x < size; x++) {
            const nx = (height[y * size + ((x - 1) & mask)] - height[y * size + ((x + 1) & mask)]) * strength;
            const ny = (height[up + x] - height[down + x]) * strength;
            const inv = 1 / Math.hypot(nx, ny, 1);
            const o = (y * size + x) * 4;
            normal[o] = (nx * inv * 0.5 + 0.5) * 255;
            normal[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
            normal[o + 2] = (inv * 0.5 + 0.5) * 255;
            normal[o + 3] = 255;
        }
    }
    return { albedo, normal };
}

function canvasTexture(size, pixels, srgb) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.flipY = false;
    texture.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function applyGroundQuality(material, engine) {
    if (!material || !material.userData.groundNormal) return;
    const profile = engine.quality.profile;
    const max = engine.renderer.capabilities.getMaxAnisotropy();
    const anisotropy = Math.min(max, Math.max(4, profile.textures.anisotropy * 2));
    for (const texture of [material.map, material.userData.groundNormal]) {
        if (texture.anisotropy !== anisotropy) {
            texture.anisotropy = anisotropy;
            texture.needsUpdate = true;
        }
    }
    if (material.normalMap !== material.userData.groundNormal) {
        material.normalMap = material.userData.groundNormal;
        material.needsUpdate = true;
    }
}

export function createGroundMaterial(engine) {
    const size = engine.quality.preset === 'low' ? 384 : 512;
    const { albedo, normal } = paintGround(size);
    const material = new THREE.MeshStandardMaterial({
        map: canvasTexture(size, albedo, true),
        normalScale: new THREE.Vector2(0.88, 0.88),
        roughness: 0.92,
        metalness: 0.04,
        envMapIntensity: 1.35
    });
    material.name = 'ProvingGroundUltra';
    material.userData.groundNormal = canvasTexture(size, normal, false);
    enhanceGroundMaterialShader(material);
    applyGroundQuality(material, engine);
    return material;
}

export function createGroundApronGeometry(outer = 2400) {
    const inner = GROUND_SIZE / 2;
    const stops = [-outer, -inner, inner, outer];
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let iz = 0; iz < 3; iz++) {
        for (let ix = 0; ix < 3; ix++) {
            if (ix === 1 && iz === 1) continue;
            const base = positions.length / 3;
            const corners = [[stops[ix], stops[iz]], [stops[ix], stops[iz + 1]], [stops[ix + 1], stops[iz + 1]], [stops[ix + 1], stops[iz]]];
            for (const [x, z] of corners) {
                positions.push(x, 0, z);
                normals.push(0, 1, 0);
                uvs.push(x / GROUND_SIZE + 0.5, 0.5 - z / GROUND_SIZE);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
}

export function createEnvironment(engine) {
    const { scene, renderer } = engine;
    const horizonColor = new THREE.Color(HORIZON);
    const sunDirection = new THREE.Vector3(95, 42, -85).normalize();
    let sky = null;
    let envTarget = null;
    let envFailed = false;
    let steppeGrass = null;

    function createSky() {
        const sun = engine.sunLight;
        if (sun) sunDirection.copy(sun.position).sub(sun.target.position).normalize();
        const material = new THREE.ShaderMaterial({
            name: 'UltraAtmosphericSky',
            defines: { SKY_CLOUDS: 1 },
            uniforms: {
                uZenith: { value: new THREE.Color(ZENITH) },
                uMidSky: { value: new THREE.Color(MID_SKY) },
                uHorizon: { value: horizonColor },
                uGround: { value: new THREE.Color(GROUND_BOUNCE) },
                uSunColor: { value: new THREE.Color(SUN_GLOW) },
                uSunDir: { value: sunDirection },
                uTime: { value: 0 }
            },
            vertexShader: ULTRA_SKY_VERTEX,
            fragmentShader: ULTRA_SKY_FRAGMENT,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
        dome.name = 'sky';
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        dome.renderOrder = 1000;
        return dome;
    }

    function buildEnvironmentMap() {
        const material = sky.material.clone();
        material.defines = { SKY_CLOUDS: 1 };
        material.depthTest = false;
        const envScene = new THREE.Scene();
        const dome = new THREE.Mesh(sky.geometry, material);
        dome.frustumCulled = false;
        envScene.add(dome);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const target = pmrem.fromScene(envScene, 0.02);
        pmrem.dispose();
        material.dispose();
        return target;
    }

    function enhanceAssetPBR(template) {
        if (!template || !template.scene) return;
        template.scene.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const mat of mats) {
                if (!mat || !mat.isMeshStandardMaterial) continue;
                if (mat.userData.ultraPbrTuned) continue;
                mat.userData.ultraPbrTuned = true;
                mat.envMapIntensity = 1.25;
                if (typeof mat.metalness === 'number' && mat.metalness > 0.45) {
                    mat.roughness = Math.min(mat.roughness, 0.62);
                }
                if (mat.color && mat.color.r < 0.06 && mat.color.g < 0.06 && mat.color.b < 0.06) {
                    mat.color.setRGB(0.08, 0.085, 0.09);
                }
            }
        });
    }

    function applyQuality() {
        const profile = engine.quality.profile;
        scene.fog.density = FOG_REACH / profile.drawDistance;

        if (engine.sunLight) {
            sunDirection.copy(engine.sunLight.position).sub(engine.sunLight.target.position).normalize();
        }

        let useEnv = !envFailed;
        if (useEnv && !envTarget) {
            try {
                envTarget = buildEnvironmentMap();
            } catch (err) {
                console.warn('[environment] environment map unavailable:', err.message);
                envFailed = true;
                useEnv = false;
            }
        }
        scene.environment = useEnv ? envTarget.texture : null;
        scene.environmentIntensity = ENV_INTENSITY;
        if (engine.hemiLight) engine.hemiLight.intensity = useEnv ? HEMI_WITH_IBL : HEMI_NO_IBL;
        for (const template of engine.assets.templates.values()) enhanceAssetPBR(template);

        if (!sky.material.defines.SKY_CLOUDS) {
            sky.material.defines.SKY_CLOUDS = 1;
            sky.material.needsUpdate = true;
        }
        applyGroundQuality(engine.groundMaterial, engine);
    }

    const mod = {
        name: 'environment',
        horizonColor,
        sunDirection,
        sky: null,

        install() {
            sky = createSky();
            mod.sky = sky;
            scene.add(sky);
            if (scene.background && scene.background.isColor) scene.background.copy(horizonColor);
            scene.fog = new THREE.FogExp2(horizonColor.getHex(), FOG_REACH / engine.quality.profile.drawDistance);
            renderer.toneMappingExposure = EXPOSURE;

            const grassCount = engine.quality.preset === 'low' ? 1600 : 2800;
            steppeGrass = createInstancedSteppeGrass(scene, grassCount);
            mod.steppeGrass = steppeGrass;

            applyQuality();
            engine.events.on('quality:changed', applyQuality);
            engine.events.on('assets:progress', ({ key }) => {
                enhanceAssetPBR(engine.assets.getTemplate(key));
            });
        },

        update(dt) {
            if (sky && sky.material.uniforms.uTime) {
                sky.material.uniforms.uTime.value = engine.time || (sky.material.uniforms.uTime.value + dt);
            }
            if (steppeGrass) {
                steppeGrass.update(engine.time || 0);
            }
        },

        setGridVisible(on) {
            if (engine.debugGrid) engine.debugGrid.visible = Boolean(on);
        }
    };
    return mod;
}
