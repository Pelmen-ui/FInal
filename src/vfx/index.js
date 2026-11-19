import * as THREE from 'three';
import { computeExplosionProfile } from '../physics/ragdoll_math.js';

const MAX_PARTICLES = 16384;
const MAX_CASINGS = 128;
const MAX_TRACERS = 160;
const MAX_LIGHTS = 8;
const ATLAS_SIZE = 1024;
const ATLAS_CELLS = 4;
const CELL_SIZE = ATLAS_SIZE / ATLAS_CELLS;

const FRAME_SMOKE = 0;
const FRAME_SMOKE_LIGHT = 1;
const FRAME_FLAME = 2;
const FRAME_FLAME_DARK = 3;
const FRAME_SPARK = 4;
const FRAME_BLOOD = 5;
const FRAME_BLOOD_DROP = 6;
const FRAME_SHOCKWAVE = 7;
const FRAME_DUST = 8;
const FRAME_MUZZLE_STAR = 9;
const FRAME_MUZZLE_JET = 10;
const FRAME_EMBER = 11;
const FRAME_DEBRIS = 12;
const FRAME_WISP = 13;
const FRAME_BLOOM = 14;
const FRAME_SHRAPNEL = 15;

/* VFX SHADERS */
const PARTICLE_VERTEX = `
attribute vec3 aOffset;
attribute vec4 aVelLife;
attribute vec4 aSizeRotFrame;
attribute vec4 aColorMax;
attribute vec4 aAux;

varying vec2 vUv;
varying float vNormLife;
varying float vFrame;
varying vec3 vColor;
varying float vAlpha;
varying float vAdditive;

void main() {
    float life = aVelLife.w;
    float maxL = max(0.02, aColorMax.w);
    float normLife = clamp(life / maxL, 0.0, 1.0);
    vNormLife = normLife;
    vFrame = aSizeRotFrame.w;
    vColor = aColorMax.rgb;
    vAlpha = aAux.x;
    vAdditive = aAux.y;

    float stretch = aAux.z;
    float growRate = aAux.w;
    float size = max(0.0, aSizeRotFrame.x * (1.0 + normLife * growRate));

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    vec2 p = position.xy;
    vec3 worldPos;

    if (stretch > 0.01) {
        vec3 vel = aVelLife.xyz;
        vec2 screenVel = vec2(dot(vel, camRight), dot(vel, camUp));
        float spd = length(screenVel);
        vec2 dir = spd > 0.001 ? (screenVel / spd) : vec2(0.0, 1.0);
        vec2 perp = vec2(-dir.y, dir.x);
        float lenScale = min(14.0, 1.0 + spd * stretch);
        vec2 rp = perp * (p.x * size) + dir * (p.y * size * lenScale);
        worldPos = aOffset + camRight * rp.x + camUp * rp.y;
    } else {
        float rot = aSizeRotFrame.y + life * aSizeRotFrame.z;
        float c = cos(rot);
        float s = sin(rot);
        vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * size;
        worldPos = aOffset + camRight * rp.x + camUp * rp.y;
    }

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    vUv = uv;
}`;

const PARTICLE_FRAGMENT = `
varying vec2 vUv;
varying float vNormLife;
varying float vFrame;
varying vec3 vColor;
varying float vAlpha;
varying float vAdditive;

uniform sampler2D uAtlas;
uniform float uCells;

void main() {
    float frame = floor(vFrame + 0.5);
    float row = floor(frame / uCells);
    float col = frame - row * uCells;
    vec2 cell = (vec2(col, uCells - 1.0 - row) + vUv) / uCells;
    vec4 tex = texture2D(uAtlas, cell);

    float fadeIn = smoothstep(0.0, 0.08, vNormLife);
    float fadeOut = 1.0 - smoothstep(0.45, 1.0, vNormLife);
    float env = (vAdditive > 0.5) ? (1.0 - smoothstep(0.18, 1.0, vNormLife)) : (fadeIn * fadeOut);
    float a = tex.a * vAlpha * env;
    if (a < 0.006) discard;

    vec3 rgb = tex.rgb * vColor;
    if (vAdditive > 0.5) {
        float hdr = mix(2.6, 0.55, vNormLife);
        gl_FragColor = vec4(rgb * a * hdr, 0.0);
    } else {
        gl_FragColor = vec4(rgb * a, a);
    }
}`;

function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function paintCloudCluster(c, s, lobes, colors, rng) {
    const cx = s * 0.5;
    const cy = s * 0.5;
    for (let i = 0; i < lobes; i++) {
        const ang = (i / lobes) * Math.PI * 2 + rng() * 0.7;
        const dist = (0.04 + rng() * 0.24) * s;
        const px = cx + Math.cos(ang) * dist;
        const py = cy + Math.sin(ang) * dist;
        const r = (0.14 + rng() * 0.18) * s;
        const g = c.createRadialGradient(px - r * 0.15, py - r * 0.15, r * 0.05, px, py, r);
        g.addColorStop(0, colors[0]);
        g.addColorStop(0.55, colors[1]);
        g.addColorStop(1, colors[2]);
        c.fillStyle = g;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fill();
    }
}

/* PROCEDURAL 1024X1024 VFX ATLAS */
function generateAtlas() {
    const canvas = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    const rng = makeRng(0x51A7BEEF);

    function drawCell(col, row, fn) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.clip();
        ctx.translate(col * CELL_SIZE, row * CELL_SIZE);
        fn(ctx, CELL_SIZE);
        ctx.restore();
    }

    drawCell(0, 0, (c, s) => {
        paintCloudCluster(c, s, 26, ['rgba(175,172,168,0.46)', 'rgba(110,108,105,0.28)', 'rgba(55,55,55,0)'], rng);
        paintCloudCluster(c, s, 12, ['rgba(215,212,208,0.34)', 'rgba(145,142,138,0.16)', 'rgba(80,80,80,0)'], rng);
    });

    drawCell(1, 0, (c, s) => {
        paintCloudCluster(c, s, 22, ['rgba(235,236,238,0.42)', 'rgba(185,188,192,0.22)', 'rgba(120,125,130,0)'], rng);
    });

    drawCell(2, 0, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        paintCloudCluster(c, s, 20, ['rgba(255,140,28,0.52)', 'rgba(215,55,8,0.28)', 'rgba(80,12,0,0)'], rng);
        const core = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.34);
        core.addColorStop(0, 'rgba(255,252,225,0.98)');
        core.addColorStop(0.38, 'rgba(255,205,85,0.88)');
        core.addColorStop(0.75, 'rgba(255,95,12,0.35)');
        core.addColorStop(1, 'rgba(120,20,0,0)');
        c.fillStyle = core;
        c.fillRect(0, 0, s, s);
    });

    drawCell(3, 0, (c, s) => {
        paintCloudCluster(c, s, 24, ['rgba(75,55,48,0.55)', 'rgba(38,28,25,0.36)', 'rgba(18,14,12,0)'], rng);
        paintCloudCluster(c, s, 14, ['rgba(255,155,36,0.68)', 'rgba(220,62,10,0.35)', 'rgba(90,15,0,0)'], rng);
    });

    drawCell(0, 1, (c, s) => {
        const cx = s * 0.5;
        const g = c.createLinearGradient(0, s * 0.08, 0, s * 0.92);
        g.addColorStop(0, 'rgba(255,120,20,0)');
        g.addColorStop(0.35, 'rgba(255,215,110,0.88)');
        g.addColorStop(0.65, 'rgba(255,252,230,1.0)');
        g.addColorStop(0.88, 'rgba(255,190,75,0.75)');
        g.addColorStop(1, 'rgba(255,90,10,0)');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(cx, s * 0.5, s * 0.13, s * 0.44, 0, 0, Math.PI * 2);
        c.fill();
    });

    drawCell(1, 1, (c, s) => {
        paintCloudCluster(c, s, 14, ['rgba(155,16,16,0.34)', 'rgba(110,10,10,0.18)', 'rgba(65,4,4,0)'], rng);
        for (let i = 0; i < 24; i++) {
            const ang = rng() * Math.PI * 2;
            const d = (0.08 + rng() * 0.34) * s;
            const r = (0.008 + rng() * 0.018) * s;
            c.fillStyle = `rgba(${105 + Math.floor(rng() * 45)},${8 + Math.floor(rng() * 10)},${8 + Math.floor(rng() * 10)},${0.55 + rng() * 0.30})`;
            c.beginPath();
            c.ellipse(s * 0.5 + Math.cos(ang) * d, s * 0.5 + Math.sin(ang) * d, r * (1 + rng() * 0.9), r, ang, 0, Math.PI * 2);
            c.fill();
        }
    });

    drawCell(2, 1, (c, s) => {
        const cx = s * 0.5;
        const g = c.createLinearGradient(0, s * 0.06, 0, s * 0.94);
        g.addColorStop(0, 'rgba(130,10,10,0)');
        g.addColorStop(0.24, 'rgba(148,14,14,0.85)');
        g.addColorStop(0.68, 'rgba(108,8,8,0.96)');
        g.addColorStop(1, 'rgba(75,4,4,0)');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(cx, s * 0.48, s * 0.11, s * 0.42, 0, 0, Math.PI * 2);
        c.fill();
    });

    drawCell(3, 1, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5, r = s * 0.46;
        const g = c.createRadialGradient(cx, cy, r * 0.56, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.55, 'rgba(255,235,195,0.68)');
        g.addColorStop(0.78, 'rgba(255,250,235,0.92)');
        g.addColorStop(1, 'rgba(255,220,165,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
    });

    drawCell(0, 2, (c, s) => {
        paintCloudCluster(c, s, 26, ['rgba(182,162,134,0.50)', 'rgba(132,115,92,0.28)', 'rgba(72,62,48,0)'], rng);
    });

    drawCell(1, 2, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const core = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.32);
        core.addColorStop(0, 'rgba(255,255,245,1)');
        core.addColorStop(0.4, 'rgba(255,210,115,0.82)');
        core.addColorStop(1, 'rgba(255,100,20,0)');
        c.fillStyle = core;
        c.fillRect(0, 0, s, s);
        for (let i = 0; i < 6; i++) {
            c.save();
            c.translate(cx, cy);
            c.rotate((i / 6) * Math.PI * 2 + 0.18);
            const len = i % 2 === 0 ? s * 0.47 : s * 0.34;
            const w = i % 2 === 0 ? s * 0.08 : s * 0.055;
            const lg = c.createLinearGradient(0, 0, len, 0);
            lg.addColorStop(0, 'rgba(255,252,225,0.98)');
            lg.addColorStop(0.5, 'rgba(255,170,50,0.72)');
            lg.addColorStop(1, 'rgba(255,80,10,0)');
            c.fillStyle = lg;
            c.beginPath();
            c.moveTo(0, -w);
            c.lineTo(len, 0);
            c.lineTo(0, w);
            c.closePath();
            c.fill();
            c.restore();
        }
    });

    drawCell(2, 2, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.45);
        g.addColorStop(0, 'rgba(255,250,210,1)');
        g.addColorStop(0.3, 'rgba(255,175,55,0.85)');
        g.addColorStop(0.65, 'rgba(255,85,15,0.34)');
        g.addColorStop(1, 'rgba(180,30,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
    });

    drawCell(3, 2, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.36);
        g.addColorStop(0, 'rgba(255,245,190,1)');
        g.addColorStop(0.35, 'rgba(255,135,24,0.9)');
        g.addColorStop(0.7, 'rgba(195,45,8,0.45)');
        g.addColorStop(1, 'rgba(90,10,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
    });

    drawCell(0, 3, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        c.fillStyle = 'rgba(145,136,126,0.98)';
        c.beginPath();
        const verts = 7;
        for (let i = 0; i < verts; i++) {
            const a = (i / verts) * Math.PI * 2;
            const r = (0.24 + rng() * 0.16) * s;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(55,50,46,0.55)';
        c.beginPath();
        c.arc(cx + s * 0.06, cy + s * 0.06, s * 0.18, 0, Math.PI * 2);
        c.fill();
    });

    drawCell(1, 3, (c, s) => {
        for (let i = 0; i < 14; i++) {
            const t = i / 13;
            const px = s * (0.5 + Math.sin(t * 5.2) * 0.12);
            const py = s * (0.85 - t * 0.70);
            const r = s * (0.08 + t * 0.14);
            const g = c.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, 'rgba(225,228,232,0.22)');
            g.addColorStop(0.6, 'rgba(185,190,196,0.10)');
            g.addColorStop(1, 'rgba(150,155,162,0)');
            c.fillStyle = g;
            c.beginPath();
            c.arc(px, py, r, 0, Math.PI * 2);
            c.fill();
        }
    });

    drawCell(2, 3, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.48);
        g.addColorStop(0, 'rgba(255,255,248,1.0)');
        g.addColorStop(0.22, 'rgba(255,232,165,0.80)');
        g.addColorStop(0.55, 'rgba(255,155,48,0.32)');
        g.addColorStop(1, 'rgba(255,80,10,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
    });

    drawCell(3, 3, (c, s) => {
        const cx = s * 0.5;
        const g = c.createLinearGradient(0, s * 0.04, 0, s * 0.96);
        g.addColorStop(0, 'rgba(255,140,30,0)');
        g.addColorStop(0.25, 'rgba(255,220,120,0.85)');
        g.addColorStop(0.6, 'rgba(255,255,245,1.0)');
        g.addColorStop(0.88, 'rgba(255,200,90,0.8)');
        g.addColorStop(1, 'rgba(255,110,20,0)');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(cx, s * 0.5, s * 0.11, s * 0.46, 0, 0, Math.PI * 2);
        c.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _eul = new THREE.Euler();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

export function createVfx(engine) {
    const scene = engine.scene;
    let atlas = null;
    let geo = null;
    let mat = null;
    let mesh = null;

    const pos = new Float32Array(MAX_PARTICLES * 3);
    const velLife = new Float32Array(MAX_PARTICLES * 4);
    const sizeRotFrame = new Float32Array(MAX_PARTICLES * 4);
    const colorMax = new Float32Array(MAX_PARTICLES * 4);
    const aux = new Float32Array(MAX_PARTICLES * 4);
    const physFlags = new Uint8Array(MAX_PARTICLES);
    let head = 0;
    let count = 0;
    let budget = 10000;

    let casingMesh = null;
    const casingData = new Float32Array(MAX_CASINGS * 11);
    let casingHead = 0;
    let casingActive = 0;

    let tracerMesh = null;
    const tracerPool = [];

    const lightPool = [];
    const smokeClouds = [];
    const burningVehicles = new Map();
    const cookOffVehicles = new Map();

    const _rng = makeRng(0xDEAD1337);

    function init() {
        budget = engine.quality?.profile?.particles?.budget ?? 10000;
        atlas = generateAtlas();
        const quadGeo = new THREE.PlaneGeometry(1, 1);

        geo = new THREE.InstancedBufferGeometry();
        geo.index = quadGeo.index;
        geo.setAttribute('position', quadGeo.getAttribute('position'));
        geo.setAttribute('uv', quadGeo.getAttribute('uv'));
        geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aVelLife', new THREE.InstancedBufferAttribute(velLife, 4).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aSizeRotFrame', new THREE.InstancedBufferAttribute(sizeRotFrame, 4).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aColorMax', new THREE.InstancedBufferAttribute(colorMax, 4).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aAux', new THREE.InstancedBufferAttribute(aux, 4).setUsage(THREE.DynamicDrawUsage));
        geo.instanceCount = 0;

        mat = new THREE.ShaderMaterial({
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            uniforms: {
                uAtlas: { value: atlas },
                uCells: { value: ATLAS_CELLS }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor
        });

        mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 40;
        mesh.name = 'vfx_particles';
        scene.add(mesh);

        const cGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.036, 6);
        cGeo.rotateZ(Math.PI * 0.5);
        const cMat = new THREE.MeshStandardMaterial({ color: 0xe2b13c, metalness: 0.88, roughness: 0.22 });
        casingMesh = new THREE.InstancedMesh(cGeo, cMat, MAX_CASINGS);
        casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        casingMesh.frustumCulled = false;
        casingMesh.count = 0;
        casingMesh.name = 'vfx_casings';
        scene.add(casingMesh);

        const tGeo = new THREE.CylinderGeometry(0.020, 0.014, 1.0, 6);
        tGeo.rotateX(Math.PI * 0.5);
        const tMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.94,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        tracerMesh = new THREE.InstancedMesh(tGeo, tMat, MAX_TRACERS);
        tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        tracerMesh.frustumCulled = false;
        tracerMesh.count = MAX_TRACERS;
        tracerMesh.name = 'vfx_tracers';
        _scale.set(0, 0, 0);
        _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
        _color.setHex(0xffd24c);
        for (let i = 0; i < MAX_TRACERS; i++) {
            tracerMesh.setMatrixAt(i, _mat4);
            tracerMesh.setColorAt(i, _color);
            const idx = i;
            const slot = {
                idx,
                active: false,
                ttl: 0,
                set(p, v, hexColor) {
                    const spd = Math.hypot(v.x, v.y, v.z) || 1;
                    const len = Math.min(9.5, Math.max(2.6, spd * 0.018));
                    _dir.set(v.x / spd, v.y / spd, v.z / spd);
                    _quat.setFromUnitVectors(_up.set(0, 0, 1), _dir);
                    _pos.set(p.x - _dir.x * len * 0.5, p.y - _dir.y * len * 0.5, p.z - _dir.z * len * 0.5);
                    _scale.set(1, 1, len);
                    _mat4.compose(_pos, _quat, _scale);
                    tracerMesh.setMatrixAt(idx, _mat4);
                    tracerMesh.instanceMatrix.needsUpdate = true;
                    if (typeof hexColor === 'number') {
                        _color.setHex(hexColor);
                        tracerMesh.setColorAt(idx, _color);
                        if (tracerMesh.instanceColor) tracerMesh.instanceColor.needsUpdate = true;
                    }
                },
                release() {
                    slot.active = false;
                    slot.ttl = 0;
                    _scale.set(0, 0, 0);
                    _mat4.compose(_pos.set(0, -100, 0), _quat.identity(), _scale);
                    tracerMesh.setMatrixAt(idx, _mat4);
                    tracerMesh.instanceMatrix.needsUpdate = true;
                }
            };
            tracerPool.push(slot);
        }
        if (tracerMesh.instanceColor) tracerMesh.instanceColor.needsUpdate = true;
        scene.add(tracerMesh);

        for (let i = 0; i < MAX_LIGHTS; i++) {
            const pt = new THREE.PointLight(0xffaa33, 0, 22);
            pt.position.set(0, -100, 0);
            scene.add(pt);
            lightPool.push({ light: pt, ttl: 0, maxTtl: 0.1, peak: 0 });
        }
    }

    function spawnLight(x, y, z, color, intensity, distance, ttl) {
        const maxLights = engine.quality?.profile?.lighting?.maxDynamicLights ?? 6;
        if (maxLights <= 0) return;
        let pick = lightPool[0];
        for (let i = 0; i < Math.min(maxLights, lightPool.length); i++) {
            if (lightPool[i].ttl <= 0) {
                pick = lightPool[i];
                break;
            }
            if (lightPool[i].ttl < pick.ttl) pick = lightPool[i];
        }
        pick.light.color.setHex(color);
        pick.light.intensity = intensity;
        pick.light.distance = distance;
        pick.light.position.set(x, y, z);
        pick.ttl = ttl;
        pick.maxTtl = ttl;
        pick.peak = intensity;
    }

    function light(opts = {}) {
        const p = opts.pos || _pos;
        spawnLight(p.x || 0, p.y || 0, p.z || 0, opts.color ?? 0xffaa33, opts.intensity ?? 16, opts.distance ?? 18, opts.ttl ?? 0.14);
    }

    function emitEx(x, y, z, vx, vy, vz, size, rot, rotSpeed, frame, maxLife, r, g, b, alpha, additive, stretch, growRate, physMode) {
        const cap = Math.min(budget, MAX_PARTICLES);
        let i;
        if (count < cap) {
            i = count;
            count++;
        } else {
            i = head % cap;
            head = (head + 1) % cap;
        }
        const o3 = i * 3;
        const o4 = i * 4;
        pos[o3] = x;
        pos[o3 + 1] = y;
        pos[o3 + 2] = z;
        velLife[o4] = vx;
        velLife[o4 + 1] = vy;
        velLife[o4 + 2] = vz;
        velLife[o4 + 3] = 0;
        sizeRotFrame[o4] = size;
        sizeRotFrame[o4 + 1] = rot;
        sizeRotFrame[o4 + 2] = rotSpeed;
        sizeRotFrame[o4 + 3] = frame;
        colorMax[o4] = r;
        colorMax[o4 + 1] = g;
        colorMax[o4 + 2] = b;
        colorMax[o4 + 3] = maxLife;
        aux[o4] = alpha;
        aux[o4 + 1] = additive;
        aux[o4 + 2] = stretch;
        aux[o4 + 3] = growRate;
        physFlags[i] = physMode;
    }

    function step(dt) {
        if (!mesh) return;
        const gravity = -9.81;
        const windX = engine.wind ? engine.wind.x : 1.4;
        const windZ = engine.wind ? engine.wind.z : 0.6;

        for (let i = 0; i < count; i++) {
            const o3 = i * 3;
            const o4 = i * 4;
            const pMode = physFlags[i];

            velLife[o4 + 3] += dt;
            const life = velLife[o4 + 3];
            const maxLife = colorMax[o4 + 3];
            if (life >= maxLife) {
                const last = count - 1;
                if (i !== last) {
                    const lo3 = last * 3;
                    const lo4 = last * 4;
                    pos[o3] = pos[lo3];
                    pos[o3 + 1] = pos[lo3 + 1];
                    pos[o3 + 2] = pos[lo3 + 2];
                    velLife[o4] = velLife[lo4];
                    velLife[o4 + 1] = velLife[lo4 + 1];
                    velLife[o4 + 2] = velLife[lo4 + 2];
                    velLife[o4 + 3] = velLife[lo4 + 3];
                    sizeRotFrame[o4] = sizeRotFrame[lo4];
                    sizeRotFrame[o4 + 1] = sizeRotFrame[lo4 + 1];
                    sizeRotFrame[o4 + 2] = sizeRotFrame[lo4 + 2];
                    sizeRotFrame[o4 + 3] = sizeRotFrame[lo4 + 3];
                    colorMax[o4] = colorMax[lo4];
                    colorMax[o4 + 1] = colorMax[lo4 + 1];
                    colorMax[o4 + 2] = colorMax[lo4 + 2];
                    colorMax[o4 + 3] = colorMax[lo4 + 3];
                    aux[o4] = aux[lo4];
                    aux[o4 + 1] = aux[lo4 + 1];
                    aux[o4 + 2] = aux[lo4 + 2];
                    aux[o4 + 3] = aux[lo4 + 3];
                    physFlags[i] = physFlags[last];
                }
                count--;
                i--;
                continue;
            }

            if (pMode === 1) {
                velLife[o4] += windX * dt * 0.52;
                velLife[o4 + 2] += windZ * dt * 0.52;
                velLife[o4 + 1] += 1.55 * dt;
                const drag = Math.max(0, 1 - dt * 1.15);
                velLife[o4] *= drag;
                velLife[o4 + 1] *= Math.max(0, 1 - dt * 0.85);
                velLife[o4 + 2] *= drag;
            } else if (pMode === 2) {
                velLife[o4 + 1] += gravity * 1.65 * dt;
                const drag = Math.max(0, 1 - dt * 0.65);
                velLife[o4] *= drag;
                velLife[o4 + 2] *= drag;
            } else if (pMode === 3) {
                velLife[o4 + 1] += gravity * 0.95 * dt;
                const drag = Math.max(0, 1 - dt * 1.45);
                velLife[o4] *= drag;
                velLife[o4 + 2] *= drag;
            } else if (pMode === 4) {
                velLife[o4] += windX * dt * 0.75;
                velLife[o4 + 2] += windZ * dt * 0.75;
                velLife[o4 + 1] += 0.65 * dt;
                const drag = Math.max(0, 1 - dt * 1.8);
                velLife[o4] *= drag;
                velLife[o4 + 1] *= drag;
                velLife[o4 + 2] *= drag;
            } else if (pMode === 5) {
                velLife[o4] += windX * dt * 0.35;
                velLife[o4 + 2] += windZ * dt * 0.35;
                velLife[o4 + 1] += 2.2 * dt;
                const drag = Math.max(0, 1 - dt * 2.1);
                velLife[o4] *= drag;
                velLife[o4 + 1] *= drag;
                velLife[o4 + 2] *= drag;
            } else {
                const drag = Math.max(0, 1 - dt * 2.2);
                velLife[o4] *= drag;
                velLife[o4 + 1] *= drag;
                velLife[o4 + 2] *= drag;
            }

            pos[o3] += velLife[o4] * dt;
            pos[o3 + 1] += velLife[o4 + 1] * dt;
            pos[o3 + 2] += velLife[o4 + 2] * dt;

            if (pos[o3 + 1] < 0.04 && (pMode === 2 || pMode === 3)) {
                pos[o3 + 1] = 0.04;
                if (pMode === 2) {
                    velLife[o4 + 1] = Math.abs(velLife[o4 + 1]) * 0.38;
                    velLife[o4] *= 0.62;
                    velLife[o4 + 2] *= 0.62;
                } else {
                    velLife[o4 + 1] = 0;
                    velLife[o4] *= 0.4;
                    velLife[o4 + 2] *= 0.4;
                }
            }
        }

        geo.instanceCount = count;
        geo.attributes.aOffset.needsUpdate = true;
        geo.attributes.aVelLife.needsUpdate = true;
        geo.attributes.aSizeRotFrame.needsUpdate = true;
        geo.attributes.aColorMax.needsUpdate = true;
        geo.attributes.aAux.needsUpdate = true;

        for (let i = 0; i < lightPool.length; i++) {
            const lp = lightPool[i];
            if (lp.ttl <= 0) continue;
            lp.ttl -= dt;
            if (lp.ttl <= 0) {
                lp.light.intensity = 0;
            } else {
                lp.light.intensity = lp.peak * Math.pow(lp.ttl / lp.maxTtl, 1.4);
            }
        }

        for (let i = 0; i < tracerPool.length; i++) {
            const tr = tracerPool[i];
            if (tr.active && tr.ttl > 0) {
                tr.ttl -= dt;
                if (tr.ttl <= 0) tr.release();
            }
        }

        if (casingActive > 0) {
            let drawIdx = 0;
            for (let i = 0; i < MAX_CASINGS; i++) {
                const o = i * 11;
                if (casingData[o + 9] <= 0) continue;
                casingData[o + 9] -= dt;
                if (casingData[o + 9] <= 0) {
                    casingActive = Math.max(0, casingActive - 1);
                    continue;
                }
                casingData[o + 4] -= 18.0 * dt;
                casingData[o] += casingData[o + 3] * dt;
                casingData[o + 1] += casingData[o + 4] * dt;
                casingData[o + 2] += casingData[o + 5] * dt;
                casingData[o + 6] += casingData[o + 7] * dt;
                casingData[o + 8] += casingData[o + 7] * 0.7 * dt;
                if (casingData[o + 1] <= 0.02) {
                    casingData[o + 1] = 0.02;
                    casingData[o + 4] = Math.abs(casingData[o + 4]) * 0.35;
                    casingData[o + 3] *= 0.68;
                    casingData[o + 5] *= 0.68;
                    if (casingData[o + 10] < 2) {
                        casingData[o + 10] += 1;
                        _pos.set(casingData[o], 0.02, casingData[o + 2]);
                        engine.events?.emit?.('casing:bounce', { pos: _pos });
                    }
                }
                _pos.set(casingData[o], casingData[o + 1], casingData[o + 2]);
                _eul.set(casingData[o + 6], casingData[o + 8], casingData[o + 6] * 0.5);
                _quat.setFromEuler(_eul);
                _scale.set(1, 1, 1);
                _mat4.compose(_pos, _quat, _scale);
                casingMesh.setMatrixAt(drawIdx++, _mat4);
            }
            casingMesh.count = drawIdx;
            casingMesh.instanceMatrix.needsUpdate = true;
        }

        for (let i = smokeClouds.length - 1; i >= 0; i--) {
            const sc = smokeClouds[i];
            sc.age += dt;
            if (sc.age >= sc.duration) {
                smokeClouds.splice(i, 1);
                continue;
            }
            sc.pos.x += windX * dt * 0.35;
            sc.pos.z += windZ * dt * 0.35;
            sc.emitTimer -= dt;
            if (sc.emitTimer <= 0 && sc.age < sc.duration - 2.5) {
                sc.emitTimer = 0.20;
                const ang = _rng() * Math.PI * 2;
                const d = _rng() * sc.radius * 0.65;
                emitEx(
                    sc.pos.x + Math.cos(ang) * d,
                    sc.pos.y + 0.4 + _rng() * 1.4,
                    sc.pos.z + Math.sin(ang) * d,
                    (_rng() - 0.5) * 1.2,
                    0.5 + _rng() * 0.7,
                    (_rng() - 0.5) * 1.2,
                    4.2 + _rng() * 4.4,
                    _rng() * 6.28,
                    (_rng() - 0.5) * 0.35,
                    FRAME_SMOKE_LIGHT,
                    4.5,
                    0.82, 0.84, 0.86, 0.72, 0, 0, 0.75, 1
                );
            }
        }

        for (const [veh, st] of burningVehicles) {
            if (!veh || !veh.chassisPos) {
                burningVehicles.delete(veh);
                continue;
            }
            st.timer -= dt;
            if (st.timer <= 0) {
                st.timer = 0.075;
                emitVehicleFireStep(veh.chassisPos, st.intensity);
            }
        }

        for (const [veh, rem] of cookOffVehicles) {
            const next = rem - dt;
            if (next <= 0 || !veh || !veh.chassisPos) {
                cookOffVehicles.delete(veh);
                continue;
            }
            cookOffVehicles.set(veh, next);
            const p = veh.chassisPos;
            const rnd = _rng;
            for (let i = 0; i < 4; i++) {
                const isSp = i < 2;
                emitEx(
                    p.x + (rnd() - 0.5) * 0.6,
                    p.y + 1.8,
                    p.z + (rnd() - 0.5) * 0.6,
                    (rnd() - 0.5) * 5.2,
                    9.5 + rnd() * 12.0,
                    (rnd() - 0.5) * 5.2,
                    isSp ? (0.09 + rnd() * 0.08) : (0.7 + rnd() * 1.1),
                    rnd() * 6.28,
                    (rnd() - 0.5) * 6,
                    isSp ? FRAME_SHRAPNEL : FRAME_FLAME,
                    isSp ? 0.85 : 0.65,
                    1.0, isSp ? 0.85 : 0.72, isSp ? 0.55 : 0.32,
                    0.95, 1, isSp ? 0.25 : 0, isSp ? -0.3 : 0.65, isSp ? 2 : 5
                );
            }
        }
    }

    function explosion(epicenter, opts = {}) {
        if (!epicenter) return;
        const x = epicenter.x, y = epicenter.y, z = epicenter.z;
        const r = opts.radius || 8;
        const prof = computeExplosionProfile(opts.kind, r);
        const scale = prof.scale;
        const cs = prof.countScale;
        const speedK = Math.sqrt(prof.visualScale);
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;

        spawnLight(
            x, y + 1.0 * prof.visualScale, z,
            0xffaa33,
            Math.min(48, r * 5.2) * prof.lightScale,
            Math.max(12, r * 3.6 * prof.visualScale),
            0.28 * Math.max(0.55, prof.lightScale)
        );

        const dustCount = Math.max(5, Math.ceil(18 * cs * emission));
        for (let i = 0; i < dustCount; i++) {
            const ang = rnd() * Math.PI * 2;
            const spd = (3.2 + rnd() * r * 0.72) * speedK;
            emitEx(
                x + Math.cos(ang) * 0.5 * prof.visualScale, y + 0.12, z + Math.sin(ang) * 0.5 * prof.visualScale,
                Math.cos(ang) * spd, (0.30 + rnd() * 0.80) * speedK, Math.sin(ang) * spd,
                (2.6 + rnd() * 3.6) * scale,
                rnd() * 6.28, (rnd() - 0.5) * 0.7,
                FRAME_DUST,
                (2.2 + rnd() * 1.6) * Math.max(0.6, prof.visualScale),
                0.76, 0.68, 0.56,
                0.58, 0, 0, 1.05, 1
            );
        }

        const smokeCount = Math.max(7, Math.ceil(26 * cs * emission));
        for (let i = 0; i < smokeCount; i++) {
            const spd = (1.6 + rnd() * 4.4) * scale;
            const ax = (rnd() - 0.5) * 2.1, ay = 1.6 + rnd() * 3.4, az = (rnd() - 0.5) * 2.1;
            const shade = 0.16 + rnd() * 0.16;
            emitEx(
                x + (rnd() - 0.5) * 1.3 * scale,
                y + 0.30 + rnd() * 0.75 * scale,
                z + (rnd() - 0.5) * 1.3 * scale,
                ax * spd, ay * spd, az * spd,
                (2.1 + rnd() * 3.4) * scale,
                rnd() * 6.28, (rnd() - 0.5) * 1.4,
                FRAME_SMOKE,
                (2.8 + rnd() * 2.2) * Math.max(0.62, prof.visualScale),
                shade, shade * 0.96, shade * 0.92,
                0.70, 0, 0, 1.30, 1
            );
        }

        emitEx(x, y + 0.30, z, 0, 0.25, 0, 1.75 * scale, 0, 0, FRAME_SHOCKWAVE, 0.18 * Math.max(0.65, prof.visualScale), 0.96, 0.92, 0.86, 0.30 * prof.lightScale, 1, 0, 4.0, 0);
        emitEx(x, y + 0.60 * prof.visualScale, z, 0, 0.35, 0, 3.7 * scale, 0, 0, FRAME_BLOOM, 0.22 * Math.max(0.65, prof.visualScale), 1.0, 0.90, 0.65, 0.94 * Math.max(0.75, prof.lightScale), 1, 0, 1.55, 0);

        const coreCount = Math.max(8, Math.ceil(26 * cs * emission));
        for (let i = 0; i < coreCount; i++) {
            const spd = (1.8 + rnd() * 4.6) * scale;
            const ax = (rnd() - 0.5) * 1.9, ay = rnd() * 1.7 + 0.9, az = (rnd() - 0.5) * 1.9;
            const isHot = i < Math.ceil(coreCount * 0.52);
            const isDark = !isHot && i % 3 === 0;
            emitEx(
                x + (rnd() - 0.5) * 1.05 * scale,
                y + 0.22 + rnd() * 1.05 * scale,
                z + (rnd() - 0.5) * 1.05 * scale,
                ax * spd, ay * spd, az * spd,
                (isHot ? (1.75 + rnd() * 2.5) : (1.45 + rnd() * 2.4)) * scale,
                rnd() * 6.28, (rnd() - 0.5) * 3.0,
                isDark ? FRAME_FLAME_DARK : FRAME_FLAME,
                ((isHot ? 0.48 : 0.68) + rnd() * 0.42) * Math.max(0.62, prof.visualScale),
                1.0, isHot ? 0.94 : (isDark ? 0.78 : 0.84), isHot ? 0.68 : (isDark ? 0.42 : 0.48),
                isHot ? 0.96 : 0.86, isDark ? 0 : 1, 0, 1.02, 5
            );
        }

        const debrisCount = Math.max(6, Math.ceil(20 * cs * emission));
        for (let i = 0; i < debrisCount; i++) {
            const spd = (5.2 + rnd() * 10.8) * Math.sqrt(scale);
            const ax = (rnd() - 0.5) * 2, ay = 0.7 + rnd() * 1.5, az = (rnd() - 0.5) * 2;
            const len = Math.hypot(ax, ay, az) || 1;
            const tone = 0.22 + rnd() * 0.25;
            emitEx(
                x + (rnd() - 0.5) * 0.8 * prof.visualScale, y + 0.22, z + (rnd() - 0.5) * 0.8 * prof.visualScale,
                (ax / len) * spd, (ay / len) * spd, (az / len) * spd,
                (0.12 + rnd() * 0.22) * Math.sqrt(scale),
                rnd() * 6.28, (rnd() - 0.5) * 14,
                FRAME_DEBRIS,
                1.3 + rnd() * 1.2,
                tone, tone * 0.9, tone * 0.78,
                0.96, 0, 0, -0.1, 2
            );
        }

        const shrapnelCount = Math.max(12, Math.ceil(36 * cs * emission));
        for (let i = 0; i < shrapnelCount; i++) {
            const spd = (11 + rnd() * 20) * Math.sqrt(scale);
            const ax = (rnd() - 0.5) * 2, ay = rnd() * 1.35 + 0.25, az = (rnd() - 0.5) * 2;
            const len = Math.hypot(ax, ay, az) || 1;
            emitEx(
                x, y + 0.30, z,
                (ax / len) * spd, (ay / len) * spd, (az / len) * spd,
                (0.08 + rnd() * 0.10) * Math.max(0.75, speedK),
                0, 0,
                i % 2 === 0 ? FRAME_SHRAPNEL : FRAME_SPARK,
                0.45 + rnd() * 0.72,
                1.0, 0.88, 0.54,
                0.98, 1, 0.30, -0.32, 2
            );
        }

        const emberCount = Math.max(5, Math.ceil(16 * cs * emission));
        for (let i = 0; i < emberCount; i++) {
            const ang = rnd() * Math.PI * 2;
            const spd = (1.5 + rnd() * 4.2) * scale;
            emitEx(
                x + Math.cos(ang) * 0.7 * prof.visualScale, y + 0.4 + rnd() * 1.2 * prof.visualScale, z + Math.sin(ang) * 0.7 * prof.visualScale,
                Math.cos(ang) * spd, (2.2 + rnd() * 4.6) * speedK, Math.sin(ang) * spd,
                0.07 + rnd() * 0.09,
                0, 0,
                FRAME_EMBER,
                1.6 + rnd() * 1.8,
                1.0, 0.65, 0.20,
                0.95, 1, 0, -0.3, 4
            );
        }
    }

    function muzzleFlash(posOrOpts, direction, isHeavy) {
        let position = posOrOpts;
        let dir = direction;
        let heavy = isHeavy;
        if (posOrOpts && posOrOpts.pos) {
            position = posOrOpts.pos;
            dir = posOrOpts.dir || _up;
            heavy = Boolean(posOrOpts.heavy || posOrOpts.kind === 'cannon' || posOrOpts.kind === 'autocannon');
        }
        if (!position || !dir) return;
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;
        const dx = dir.x, dy = dir.y, dz = dir.z;
        const scale = heavy ? 2.8 : 1.0;

        spawnLight(x, y, z, 0xffaa38, heavy ? 30 : 12, heavy ? 22 : 9.5, heavy ? 0.14 : 0.06);

        emitEx(x + dx * 0.06, y + dy * 0.06, z + dz * 0.06, dx * 1.5, dy * 1.5, dz * 1.5,
            0.34 * scale, rnd() * 6.28, 0, FRAME_MUZZLE_STAR, heavy ? 0.095 : 0.055,
            1.0, 0.92, 0.68, 0.98, 1, 0, 0.35, 0);

        emitEx(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12, dx * 2.5, dy * 2.5, dz * 2.5,
            0.46 * scale, rnd() * 6.28, 0, FRAME_BLOOM, heavy ? 0.10 : 0.05,
            1.0, 0.78, 0.42, 0.72, 1, 0, 0.45, 0);

        const gasCount = Math.ceil((heavy ? 10 : 4) * emission);
        for (let i = 0; i < gasCount; i++) {
            const spd = (4.5 + rnd() * 6.5) * scale;
            emitEx(
                x + dx * 0.07 * i, y + dy * 0.07 * i, z + dz * 0.07 * i,
                dx * spd + (rnd() - 0.5) * 1.8, dy * spd + (rnd() - 0.5) * 1.4, dz * spd + (rnd() - 0.5) * 1.8,
                (0.18 + rnd() * 0.22) * scale, rnd() * 6.28, (rnd() - 0.5) * 12,
                FRAME_MUZZLE_JET, heavy ? 0.13 : 0.065,
                1.0, 0.85, 0.52, 0.88, 1, 0, 0.6, 0
            );
        }

        const sparkCount = Math.ceil((heavy ? 12 : 6) * emission);
        for (let i = 0; i < sparkCount; i++) {
            const spd = (12 + rnd() * 18) * scale;
            emitEx(
                x, y, z,
                dx * spd + (rnd() - 0.5) * 4.5, dy * spd + (rnd() - 0.5) * 3.8, dz * spd + (rnd() - 0.5) * 4.5,
                (0.032 + rnd() * 0.038) * Math.sqrt(scale), 0, 0,
                FRAME_SPARK, 0.14 + rnd() * 0.18,
                1.0, 0.88, 0.55, 0.96, 1, 0.22, -0.35, 2
            );
        }

        const smokeCount = Math.ceil((heavy ? 8 : 3) * emission);
        for (let i = 0; i < smokeCount; i++) {
            const spd = (1.8 + rnd() * 3.2) * scale;
            emitEx(
                x + dx * 0.14, y + dy * 0.14, z + dz * 0.14,
                dx * spd + (rnd() - 0.5) * 1.4, dy * spd + 0.5 + rnd() * 0.8, dz * spd + (rnd() - 0.5) * 1.4,
                (0.28 + rnd() * 0.34) * scale, rnd() * 6.28, (rnd() - 0.5) * 2.2,
                FRAME_SMOKE_LIGHT, heavy ? 1.8 : 0.95,
                0.78, 0.78, 0.80, heavy ? 0.48 : 0.24, 0, 0, 1.5, 4
            );
        }

        if (heavy) {
            emitEx(x, y, z, 0, 0, 0, 1.4, 0, 0, FRAME_SHOCKWAVE, 0.20, 1.0, 0.92, 0.78, 0.65, 1, 0, 3.2, 0);
            for (let i = 0; i < 8; i++) {
                const ang = rnd() * Math.PI * 2;
                emitEx(x + Math.cos(ang), 0.12, z + Math.sin(ang),
                    Math.cos(ang) * 5.5, 0.5 + rnd(), Math.sin(ang) * 5.5,
                    2.2 + rnd() * 2.0, rnd() * 6.28, (rnd() - 0.5),
                    FRAME_DUST, 2.2, 0.76, 0.68, 0.56, 0.62, 0, 0, 1.1, 1);
            }
        }
    }

    function barrelSmoke(position, heat = 0.5) {
        if (!position) return;
        const rnd = _rng;
        emitEx(
            position.x + (rnd() - 0.5) * 0.02,
            position.y + 0.01,
            position.z + (rnd() - 0.5) * 0.02,
            (rnd() - 0.5) * 0.25,
            0.35 + rnd() * 0.35,
            (rnd() - 0.5) * 0.25,
            0.09 + heat * 0.12,
            rnd() * 6.28,
            (rnd() - 0.5) * 1.4,
            FRAME_WISP,
            0.85 + rnd() * 0.55,
            0.82, 0.84, 0.88,
            0.22 + heat * 0.20,
            0, 0, 1.8, 4
        );
    }

    function blood(opts = {}) {
        const p = opts.pos;
        const d = opts.dir || _up;
        if (!p) return;
        const rnd = _rng;
        const amount = Math.min(1.5, Math.max(0.45, opts.amount || 0.85));
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const pattern = Math.floor(rnd() * 4);
        const hLen = Math.hypot(d.x, d.z) || 1;
        const perpX = -d.z / hLen;
        const perpZ = d.x / hLen;
        const bias = (rnd() - 0.5) * 1.6;

        const mistBase = pattern === 1 ? 2 : (pattern === 2 ? 3 : 4);
        const mistCount = Math.max(2, Math.ceil(mistBase * amount * emission));
        for (let i = 0; i < mistCount; i++) {
            const isExitPuff = pattern === 3 && i >= Math.ceil(mistCount * 0.5);
            const sign = isExitPuff ? 1 : -1;
            const spd = 0.65 + rnd() * 1.45;
            const rCol = 0.62 + rnd() * 0.22;
            const gCol = 0.05 + rnd() * 0.05;
            emitEx(
                p.x + (isExitPuff ? d.x * 0.14 : 0) + (rnd() - 0.5) * 0.06,
                p.y + (rnd() - 0.5) * 0.06,
                p.z + (isExitPuff ? d.z * 0.14 : 0) + (rnd() - 0.5) * 0.06,
                sign * d.x * spd + perpX * (bias + (rnd() - 0.5) * 0.9),
                0.12 + rnd() * 0.72,
                sign * d.z * spd + perpZ * (bias + (rnd() - 0.5) * 0.9),
                0.09 + rnd() * 0.12,
                rnd() * 6.28, (rnd() - 0.5) * 2.2,
                FRAME_BLOOD,
                0.30 + rnd() * 0.26,
                rCol, gCol, gCol * 0.9,
                0.34 + rnd() * 0.16,
                0, 0, 0.55, 3
            );
        }

        if (opts.exit !== false) {
            const dropBase = pattern === 1 ? 10 : (pattern === 2 ? 9 : 7);
            const dropCount = Math.max(4, Math.ceil(dropBase * amount * emission));
            for (let i = 0; i < dropCount; i++) {
                const rCol = 0.58 + rnd() * 0.26;
                const gCol = 0.04 + rnd() * 0.05;
                let vx, vy, vz, sz, stretch, life;
                if (pattern === 1) {
                    const spd = 4.6 + rnd() * 6.4;
                    const spread = 0.65;
                    vx = d.x * spd + perpX * (bias * 0.8 + (rnd() - 0.5) * spread);
                    vy = d.y * spd + 0.5 + rnd() * 1.4;
                    vz = d.z * spd + perpZ * (bias * 0.8 + (rnd() - 0.5) * spread);
                    sz = 0.017 + rnd() * 0.019;
                    stretch = 0.34;
                    life = 0.32 + rnd() * 0.28;
                } else if (pattern === 2) {
                    const fan = ((i / Math.max(1, dropCount - 1)) - 0.5) * 2.4 + (rnd() - 0.5) * 0.4;
                    const spd = 2.6 + rnd() * 4.4;
                    vx = d.x * spd * 0.65 + perpX * fan * 2.2;
                    vy = 0.4 + rnd() * 1.8;
                    vz = d.z * spd * 0.65 + perpZ * fan * 2.2;
                    sz = 0.018 + rnd() * 0.022;
                    stretch = 0.16;
                    life = 0.28 + rnd() * 0.28;
                } else {
                    const spd = 3.0 + rnd() * 5.2;
                    const dirSign = (pattern === 0 && i % 3 === 0) ? -0.55 : 1.0;
                    vx = d.x * spd * dirSign + (rnd() - 0.5) * 1.9;
                    vy = d.y * spd * 0.6 + 0.35 + rnd() * 1.5;
                    vz = d.z * spd * dirSign + (rnd() - 0.5) * 1.9;
                    sz = 0.019 + rnd() * 0.023;
                    stretch = 0.22;
                    life = 0.30 + rnd() * 0.30;
                }
                emitEx(
                    p.x + (rnd() - 0.5) * 0.05,
                    p.y + (rnd() - 0.5) * 0.05,
                    p.z + (rnd() - 0.5) * 0.05,
                    vx, vy, vz,
                    sz, 0, 0,
                    FRAME_BLOOD_DROP,
                    life,
                    rCol, gCol, gCol * 0.9,
                    0.72 + rnd() * 0.18,
                    0, stretch, -0.25, 3
                );
            }
        }
    }

    function rpgBackblast(posOrOpts, direction) {
        const position = posOrOpts && posOrOpts.pos ? posOrOpts.pos : posOrOpts;
        const dir = posOrOpts && posOrOpts.dir ? posOrOpts.dir : direction;
        if (!position || !dir) return;
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;
        const bx = -dir.x, by = -dir.y, bz = -dir.z;

        emitEx(x + bx * 0.35, y + by * 0.35, z + bz * 0.35, bx * 6, by * 6, bz * 6,
            1.4, rnd() * 6.28, 0, FRAME_BLOOM, 0.14, 1.0, 0.72, 0.28, 0.95, 1, 0, 1.4, 0);

        const gasCount = Math.ceil(20 * emission);
        for (let i = 0; i < gasCount; i++) {
            const spd = 12 + rnd() * 18;
            const spread = 0.25 + rnd() * 0.35;
            emitEx(
                x + bx * 0.3, y + by * 0.3, z + bz * 0.3,
                bx * spd + (rnd() - 0.5) * spd * spread,
                by * spd + (rnd() - 0.5) * spd * spread + 1.0,
                bz * spd + (rnd() - 0.5) * spd * spread,
                0.7 + rnd() * 1.3, rnd() * 6.28, (rnd() - 0.5) * 6,
                i < 6 ? FRAME_FLAME : FRAME_SMOKE,
                i < 6 ? 0.26 : (1.8 + rnd() * 1.4),
                i < 6 ? 1.0 : 0.42, i < 6 ? 0.78 : 0.40, i < 6 ? 0.38 : 0.38,
                i < 6 ? 0.92 : 0.72, i < 6 ? 1 : 0, 0, 1.3, i < 6 ? 5 : 1
            );
        }

        const dustCount = Math.ceil(12 * emission);
        for (let i = 0; i < dustCount; i++) {
            const spd = 4 + rnd() * 10;
            emitEx(
                x + bx * 0.5, y + 0.08, z + bz * 0.5,
                bx * spd + (rnd() - 0.5) * 4, rnd() * 1.6, bz * spd + (rnd() - 0.5) * 4,
                1.6 + rnd() * 2.4, rnd() * 6.28, (rnd() - 0.5) * 2,
                FRAME_DUST, 2.2, 0.74, 0.65, 0.52, 0.64, 0, 0, 1.1, 1
            );
        }
    }

    function armorRicochet(posOrOpts, normal) {
        const position = posOrOpts && posOrOpts.pos ? posOrOpts.pos : posOrOpts;
        const norm = (posOrOpts && posOrOpts.normal ? posOrOpts.normal : normal) || _up;
        if (!position) return;
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;

        emitEx(position.x, position.y, position.z, 0, 0, 0, 0.42, 0, 0, FRAME_BLOOM, 0.08,
            1.0, 0.88, 0.55, 0.95, 1, 0, 0.4, 0);

        const sparkCount = Math.ceil(((posOrOpts && posOrOpts.count) || 20) * emission);
        for (let i = 0; i < sparkCount; i++) {
            const spd = 7 + rnd() * 16;
            const rx = norm.x * spd + (rnd() - 0.5) * 9;
            const ry = norm.y * spd + rnd() * 4.5;
            const rz = norm.z * spd + (rnd() - 0.5) * 9;
            emitEx(
                position.x, position.y, position.z,
                rx, ry, rz,
                0.042 + rnd() * 0.055, 0, 0,
                i % 3 === 0 ? FRAME_SHRAPNEL : FRAME_SPARK,
                0.28 + rnd() * 0.55,
                1.0, 0.84, 0.45, 0.98, 1, 0.28, -0.35, 2
            );
        }

        for (let i = 0; i < 3; i++) {
            emitEx(
                position.x, position.y, position.z,
                norm.x * 1.4 + (rnd() - 0.5), norm.y * 1.4 + 0.6, norm.z * 1.4 + (rnd() - 0.5),
                0.35 + rnd() * 0.45, rnd() * 6.28, (rnd() - 0.5) * 2,
                FRAME_SMOKE, 1.1, 0.35, 0.35, 0.36, 0.48, 0, 0, 1.2, 1
            );
        }
    }

    function impact(opts = {}) {
        const p = opts.pos;
        if (!p) return;
        const n = opts.normal || _up;
        const surface = opts.surface || 'dirt';
        if (opts.ricochet || surface === 'armor' || surface === 'metal') {
            armorRicochet(p, n);
            return;
        }
        if (surface === 'flesh') {
            blood({ pos: p, dir: n, amount: 1 });
            return;
        }
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const isConcrete = surface === 'concrete';
        const isWood = surface === 'wood';

        const puffCnt = Math.ceil(10 * emission);
        for (let i = 0; i < puffCnt; i++) {
            const spd = 1.4 + rnd() * 4.2;
            const r = isConcrete ? 0.78 : (isWood ? 0.68 : 0.62);
            const g = isConcrete ? 0.76 : (isWood ? 0.52 : 0.54);
            const b = isConcrete ? 0.72 : (isWood ? 0.34 : 0.42);
            emitEx(
                p.x, p.y, p.z,
                n.x * spd + (rnd() - 0.5) * 2.2,
                Math.max(0.35, n.y * spd + rnd() * 2.0),
                n.z * spd + (rnd() - 0.5) * 2.2,
                0.36 + rnd() * 0.65,
                rnd() * 6.28, (rnd() - 0.5) * 3,
                isConcrete ? FRAME_SMOKE_LIGHT : FRAME_DUST,
                0.95 + rnd() * 0.9,
                r, g, b, 0.68, 0, 0, 1.15, 1
            );
        }

        const chipCnt = Math.ceil(7 * emission);
        for (let i = 0; i < chipCnt; i++) {
            const spd = 3.5 + rnd() * 7.5;
            const tone = isConcrete ? 0.55 : (isWood ? 0.48 : 0.34);
            emitEx(
                p.x, p.y + 0.04, p.z,
                n.x * spd + (rnd() - 0.5) * 4.5,
                Math.max(1.2, n.y * spd + 1.5 + rnd() * 3.0),
                n.z * spd + (rnd() - 0.5) * 4.5,
                0.055 + rnd() * 0.08,
                rnd() * 6.28, (rnd() - 0.5) * 16,
                FRAME_DEBRIS, 0.65 + rnd() * 0.6,
                tone, tone * 0.9, tone * 0.76, 0.95, 0, 0, -0.1, 2
            );
        }

        if (isConcrete) {
            for (let i = 0; i < 3; i++) {
                const spd = 5 + rnd() * 8;
                emitEx(
                    p.x, p.y, p.z,
                    n.x * spd + (rnd() - 0.5) * 5, Math.max(0.8, n.y * spd + rnd() * 3), n.z * spd + (rnd() - 0.5) * 5,
                    0.03 + rnd() * 0.03, 0, 0,
                    FRAME_SPARK, 0.22, 1.0, 0.85, 0.55, 0.9, 1, 0.22, -0.3, 2
                );
            }
        }
    }

    function emitVehicleFireStep(position, intensity = 1) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;

        const flameCount = Math.ceil(4 * intensity * emission);
        for (let i = 0; i < flameCount; i++) {
            emitEx(
                x + (rnd() - 0.5) * 1.2, y + 1.5 + rnd() * 0.6, z + (rnd() - 0.5) * 1.2,
                (rnd() - 0.5) * 1.4, 2.2 + rnd() * 3.2, (rnd() - 0.5) * 1.4,
                0.85 + rnd() * 1.45, rnd() * 6.28, (rnd() - 0.5) * 2,
                FRAME_FLAME, 0.55 + rnd() * 0.45,
                1.0, 0.78, 0.36, 0.92, 1, 0, 0.75, 5
            );
        }

        const smokeCount = Math.ceil(3 * intensity * emission);
        for (let i = 0; i < smokeCount; i++) {
            const s = 0.14 + rnd() * 0.12;
            emitEx(
                x + (rnd() - 0.5) * 1.5, y + 2.0 + rnd(), z + (rnd() - 0.5) * 1.5,
                (rnd() - 0.5) * 0.9, 3.0 + rnd() * 2.2, (rnd() - 0.5) * 0.9,
                2.8 + rnd() * 4.4, rnd() * 6.28, (rnd() - 0.5) * 0.8,
                FRAME_SMOKE, 3.8 + rnd() * 2.0,
                s, s, s, 0.85, 0, 0, 1.25, 1
            );
        }

        if (rnd() < 0.55) {
            emitEx(
                x + (rnd() - 0.5) * 1.0, y + 1.8, z + (rnd() - 0.5) * 1.0,
                (rnd() - 0.5) * 2.0, 3.5 + rnd() * 4.0, (rnd() - 0.5) * 2.0,
                0.08 + rnd() * 0.08, 0, 0,
                FRAME_EMBER, 1.5 + rnd() * 1.4,
                1.0, 0.62, 0.18, 0.95, 1, 0, -0.3, 4
            );
        }
    }

    function vehicleFire(vehOrPos, optsOrIntensity = 1) {
        if (vehOrPos && vehOrPos.chassisPos) {
            const intensity = typeof optsOrIntensity === 'number' ? optsOrIntensity : (optsOrIntensity?.intensity || 1.2);
            burningVehicles.set(vehOrPos, { timer: 0, intensity });
            emitVehicleFireStep(vehOrPos.chassisPos, intensity);
            return;
        }
        if (vehOrPos) {
            const intensity = typeof optsOrIntensity === 'number' ? optsOrIntensity : 1;
            emitVehicleFireStep(vehOrPos, intensity);
        }
    }

    function cookOff(vehicle, seconds = 3.5) {
        if (!vehicle) return;
        cookOffVehicles.set(vehicle, seconds);
        vehicleFire(vehicle, 1.5);
    }

    function smokeScreen(posOrOpts, radius = 9) {
        let p = posOrOpts;
        let r = radius;
        let dur = 18;
        if (posOrOpts && posOrOpts.pos) {
            p = posOrOpts.pos;
            r = posOrOpts.radius || 9;
            dur = posOrOpts.duration || 18;
        }
        if (!p) return;
        smokeClouds.push({
            pos: new THREE.Vector3(p.x, p.y, p.z),
            radius: r,
            duration: dur,
            age: 0,
            emitTimer: 0
        });
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const puffCount = Math.ceil(36 * emission);
        for (let i = 0; i < puffCount; i++) {
            const ang = rnd() * Math.PI * 2;
            const dist = rnd() * r;
            const x = p.x + Math.cos(ang) * dist;
            const z = p.z + Math.sin(ang) * dist;
            emitEx(
                x, p.y + rnd() * 2, z,
                (rnd() - 0.5) * 1.5, 0.5 + rnd(), (rnd() - 0.5) * 1.5,
                4.2 + rnd() * 5.8, rnd() * 6.28, (rnd() - 0.5) * 0.3,
                FRAME_SMOKE_LIGHT, 4.2 + rnd() * 1.8,
                0.82, 0.84, 0.86, 0.74, 0, 0, 0.8, 1
            );
        }
    }

    function smokeDensity(a, b) {
        if (!smokeClouds.length || !a || !b) return 0;
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const abLenSq = abx * abx + aby * aby + abz * abz;
        if (abLenSq < 1e-6) return 0;
        let total = 0;
        for (let i = 0; i < smokeClouds.length; i++) {
            const sc = smokeClouds[i];
            const fade = sc.age < 1.2 ? (sc.age / 1.2) : (sc.age > sc.duration - 3.0 ? Math.max(0, (sc.duration - sc.age) / 3.0) : 1.0);
            if (fade <= 0.01) continue;
            const apx = sc.pos.x - a.x, apy = (sc.pos.y + 1.5) - a.y, apz = sc.pos.z - a.z;
            const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLenSq));
            const cx = a.x + abx * t - sc.pos.x;
            const cy = a.y + aby * t - (sc.pos.y + 1.5);
            const cz = a.z + abz * t - sc.pos.z;
            const dist = Math.hypot(cx, cy, cz);
            if (dist < sc.radius) {
                total += (1 - dist / sc.radius) * fade;
            }
        }
        return Math.min(1, total);
    }

    function spentCasing(posOrOpts, rightVec, playerVel) {
        let p = posOrOpts;
        let vx = 0, vy = 0, vz = 0;
        const rnd = _rng;
        if (posOrOpts && posOrOpts.pos) {
            p = posOrOpts.pos;
            const v = posOrOpts.vel || _up;
            vx = v.x; vy = v.y; vz = v.z;
        } else if (p && rightVec) {
            const spd = 2.8 + rnd() * 1.4;
            vx = rightVec.x * spd + (playerVel ? playerVel.x : 0);
            vy = rightVec.y * spd + 1.6 + rnd() * 0.9;
            vz = rightVec.z * spd + (playerVel ? playerVel.z : 0);
        } else {
            return;
        }
        const idx = casingHead;
        casingHead = (casingHead + 1) % MAX_CASINGS;
        const o = idx * 11;
        if (casingData[o + 9] <= 0) casingActive++;
        casingData[o] = p.x;
        casingData[o + 1] = p.y;
        casingData[o + 2] = p.z;
        casingData[o + 3] = vx;
        casingData[o + 4] = vy;
        casingData[o + 5] = vz;
        casingData[o + 6] = rnd() * 6.28;
        casingData[o + 7] = 14 + rnd() * 18;
        casingData[o + 8] = rnd() * 6.28;
        casingData[o + 9] = 2.4;
        casingData[o + 10] = 0;

        emitEx(
            p.x, p.y, p.z,
            vx * 0.22, vy * 0.22 + 0.35, vz * 0.22,
            0.12, rnd() * 6.28, (rnd() - 0.5) * 3,
            FRAME_WISP, 0.72, 0.85, 0.86, 0.88, 0.28, 0, 0, 1.4, 4
        );
    }

    function bulletTracer() {
        for (let i = 0; i < tracerPool.length; i++) {
            const slot = tracerPool[i];
            if (!slot.active) {
                slot.active = true;
                slot.ttl = 0;
                return slot;
            }
        }
        const fallback = tracerPool[0];
        fallback.active = true;
        fallback.ttl = 0;
        return fallback;
    }

    function tracer(startOrOpts, end, color) {
        const start = startOrOpts && startOrOpts.from ? startOrOpts.from : startOrOpts;
        const to = startOrOpts && startOrOpts.to ? startOrOpts.to : end;
        const col = typeof color === 'number' ? color : (startOrOpts && typeof startOrOpts.color === 'number' ? startOrOpts.color : 0xffd24c);
        if (!start || !to) return;
        const dx = to.x - start.x, dy = to.y - start.y, dz = to.z - start.z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.5) return;
        const slot = bulletTracer();
        slot.ttl = 0.075;
        _pos.copy(to);
        _dir.set(dx / len * 420, dy / len * 420, dz / len * 420);
        slot.set(_pos, _dir, col);
    }

    function trail(opts = {}) {
        const isRocket = opts.kind === 'rocket' || opts.kind === 'atgm';
        return {
            update(p) {
                if (!p) return;
                const rnd = _rng;
                emitEx(
                    p.x + (rnd() - 0.5) * 0.14,
                    p.y + (rnd() - 0.5) * 0.14,
                    p.z + (rnd() - 0.5) * 0.14,
                    (rnd() - 0.5) * 0.8, 0.4 + rnd() * 0.6, (rnd() - 0.5) * 0.8,
                    isRocket ? (0.58 + rnd() * 0.65) : (0.24 + rnd() * 0.24),
                    rnd() * 6.28, (rnd() - 0.5) * 2.5,
                    FRAME_SMOKE_LIGHT, isRocket ? 2.1 : 1.0,
                    0.82, 0.80, 0.78, 0.58, 0, 0, 1.3, 1
                );
                if (isRocket) {
                    emitEx(p.x, p.y, p.z, 0, 0, 0, 0.44 + rnd() * 0.25, rnd() * 6.28, 0,
                        FRAME_FLAME, 0.14, 1.0, 0.85, 0.45, 0.95, 1, 0, 0.4, 0);
                }
            },
            stop() {}
        };
    }

    function dust(opts = {}) {
        const p = opts.pos;
        if (!p) return;
        const r = opts.radius || 1.5;
        const amt = opts.amount || 1;
        const rnd = _rng;
        const cnt = Math.ceil(7 * amt);
        for (let i = 0; i < cnt; i++) {
            const ang = rnd() * Math.PI * 2;
            emitEx(
                p.x + Math.cos(ang) * r * 0.4, p.y + 0.08, p.z + Math.sin(ang) * r * 0.4,
                Math.cos(ang) * (1.2 + rnd() * 2.2), 0.3 + rnd() * 0.6, Math.sin(ang) * (1.2 + rnd() * 2.2),
                1.2 + rnd() * 1.8, rnd() * 6.28, (rnd() - 0.5),
                FRAME_DUST, 2.0, 0.74, 0.66, 0.54, 0.58, 0, 0, 0.9, 1
            );
        }
    }

    function debris(opts = {}) {
        impact({ pos: opts.pos, normal: opts.normal, surface: opts.material || 'dirt' });
    }

    const mod = {
        name: 'vfx',
        explosion,
        muzzleFlash,
        barrelSmoke,
        blood,
        backblast: rpgBackblast,
        rpgBackblast,
        sparks: armorRicochet,
        armorRicochet,
        impact,
        vehicleFire,
        cookOff,
        smokeScreen,
        smokeClouds,
        smokeDensity,
        casing: spentCasing,
        spentCasing,
        bulletTracer,
        tracer,
        trail,
        dust,
        debris,
        light,

        install() {
            init();
            engine.events.on('quality:changed', () => {
                budget = engine.quality?.profile?.particles?.budget ?? 10000;
            });
            engine.events.on('explosion', (ev) => {
                if (ev && ev.pos) explosion(ev.pos, { kind: ev.kind, radius: ev.radius });
            });
            engine.events.on('shot', (ev) => {
                if (ev && ev.pos && ev.dir) muzzleFlash(ev.pos, ev.dir, Boolean(ev.weapon?.isExplosive));
            });
            engine.events.on('vehicle:fired', (ev) => {
                if (ev && ev.pos && ev.dir) muzzleFlash(ev.pos, ev.dir, Boolean(ev.heavy));
            });
            engine.events.on('launch', (ev) => {
                if (ev && ev.pos && ev.dir) rpgBackblast(ev.pos, ev.dir);
            });
            engine.events.on('unit:hit', (ev) => {
                if (ev && ev.pos) blood({ pos: ev.pos, dir: ev.dir || _up, exit: true, amount: ev.zone === 'HEAD' ? 2.0 : 1.15 });
            });
            engine.events.on('vehicle:hit', (ev) => {
                if (ev && ev.pos) armorRicochet(ev.pos, ev.normal || _up);
            });
            engine.events.on('vehicle:destroyed', (ev) => {
                if (ev && ev.vehicle) cookOff(ev.vehicle, 4.0);
            });
            engine.events.on('era:detonated', (ev) => {
                if (ev && ev.pos) explosion(ev.pos, { kind: 'era', radius: 3.4 });
            });
            engine.events.on('smoke:deployed', (ev) => {
                if (ev && ev.pos) smokeScreen({ pos: ev.pos, kind: ev.kind, radius: ev.radius || 9, duration: ev.duration || 18 });
            });
        },

        update(dt) {
            step(dt);
        }
    };

    return mod;
}
