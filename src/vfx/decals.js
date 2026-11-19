import * as THREE from 'three';
import { computeExplosionProfile } from '../physics/ragdoll_math.js';

const ATLAS_SIZE = 1024;
const ATLAS_GRID = 4;
const CELL_SIZE = ATLAS_SIZE / ATLAS_GRID;

const DECAL_CONCRETE = 0;
const DECAL_METAL = 1;
const DECAL_WOOD = 2;
const DECAL_CRATER = 3;
const DECAL_HEAT = 4;
const DECAL_BLOOD_SPLAT = 5;
const DECAL_BLOOD_POOL = 6;
const DECAL_TREAD = 7;
const DECAL_BLOOD_STREAK = 8;
const DECAL_BLOOD_SPRAY = 9;
const DECAL_BLOOD_BURST = 10;
const BLOOD_SPLAT_FRAMES = [DECAL_BLOOD_SPLAT, DECAL_BLOOD_STREAK, DECAL_BLOOD_SPRAY, DECAL_BLOOD_BURST];

function buildDecalAtlas() {
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
        : Object.assign(document.createElement('canvas'), { width: ATLAS_SIZE, height: ATLAS_SIZE });
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    let seed = 0xC0FFEE12;
    const rng = () => {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    function cell(c, r, fn) {
        ctx.save();
        ctx.translate(c * CELL_SIZE, r * CELL_SIZE);
        fn(ctx, CELL_SIZE);
        ctx.restore();
    }

    cell(0, 0, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const dust = c.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.44);
        dust.addColorStop(0, 'rgba(175,170,162,0.58)');
        dust.addColorStop(0.55, 'rgba(135,130,122,0.28)');
        dust.addColorStop(1, 'rgba(90,85,80,0)');
        c.fillStyle = dust;
        c.beginPath();
        c.arc(cx, cy, s * 0.44, 0, Math.PI * 2);
        c.fill();

        c.strokeStyle = 'rgba(28, 25, 23, 0.85)';
        c.lineWidth = 2.5;
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + rng() * 0.35;
            const mid = s * (0.20 + rng() * 0.08);
            const end = s * (0.34 + rng() * 0.12);
            c.beginPath();
            c.moveTo(cx + Math.cos(a) * s * 0.10, cy + Math.sin(a) * s * 0.10);
            c.lineTo(cx + Math.cos(a + 0.09) * mid, cy + Math.sin(a + 0.09) * mid);
            c.lineTo(cx + Math.cos(a - 0.05) * end, cy + Math.sin(a - 0.05) * end);
            c.stroke();
        }

        c.fillStyle = 'rgba(18, 16, 15, 0.98)';
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const r = s * (0.11 + rng() * 0.05);
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
    });

    cell(1, 0, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const scorch = c.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.40);
        scorch.addColorStop(0, 'rgba(12,12,14,0.92)');
        scorch.addColorStop(0.5, 'rgba(35,34,36,0.45)');
        scorch.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = scorch;
        c.beginPath();
        c.arc(cx, cy, s * 0.40, 0, Math.PI * 2);
        c.fill();

        c.strokeStyle = 'rgba(218, 226, 236, 0.92)';
        c.lineWidth = 4.5;
        c.beginPath();
        c.arc(cx, cy, s * 0.17, 0, Math.PI * 2);
        c.stroke();

        c.fillStyle = 'rgba(8, 8, 10, 0.99)';
        c.beginPath();
        c.arc(cx, cy, s * 0.125, 0, Math.PI * 2);
        c.fill();
    });

    cell(2, 0, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        c.fillStyle = 'rgba(85, 58, 30, 0.65)';
        for (let i = 0; i < 6; i++) {
            const off = (rng() - 0.5) * s * 0.14;
            c.fillRect(cx + off - s * 0.02, cy - s * (0.22 + rng() * 0.14), s * 0.04, s * (0.44 + rng() * 0.20));
        }
        c.fillStyle = 'rgba(32, 18, 8, 0.96)';
        c.beginPath();
        c.ellipse(cx, cy, s * 0.10, s * 0.22, 0.12, 0, Math.PI * 2);
        c.fill();
    });

    cell(3, 0, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2 + rng() * 0.25;
            const len = s * (0.34 + rng() * 0.14);
            const g = c.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            g.addColorStop(0, 'rgba(14,12,10,0.75)');
            g.addColorStop(1, 'rgba(24,20,16,0)');
            c.strokeStyle = g;
            c.lineWidth = s * (0.03 + rng() * 0.04);
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            c.stroke();
        }
        const grad = c.createRadialGradient(cx, cy, s * 0.06, cx, cy, s * 0.46);
        grad.addColorStop(0, 'rgba(8, 7, 6, 0.98)');
        grad.addColorStop(0.40, 'rgba(26, 21, 17, 0.88)');
        grad.addColorStop(0.75, 'rgba(56, 46, 36, 0.42)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
        c.fill();
    });

    cell(0, 1, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const glow = c.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.40);
        glow.addColorStop(0, 'rgba(255, 220, 110, 0.98)');
        glow.addColorStop(0.32, 'rgba(255, 110, 18, 0.88)');
        glow.addColorStop(0.68, 'rgba(180, 32, 4, 0.45)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = glow;
        c.beginPath();
        c.arc(cx, cy, s * 0.40, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(8, 6, 6, 1.0)';
        c.beginPath();
        c.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
        c.fill();
    });

    cell(1, 1, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        c.fillStyle = 'rgba(102, 10, 10, 0.86)';
        c.beginPath();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const r = s * (0.08 + rng() * 0.08);
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
        for (let i = 0; i < 20; i++) {
            const a = rng() * Math.PI * 2;
            const dist = s * (0.14 + rng() * 0.28);
            const rx = s * (0.010 + rng() * 0.024);
            const ry = rx * (1.2 + rng() * 1.8);
            c.fillStyle = `rgba(${92 + Math.floor(rng() * 32)}, 9, 9, ${0.65 + rng() * 0.25})`;
            c.save();
            c.translate(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist);
            c.rotate(a);
            c.beginPath();
            c.ellipse(0, 0, ry, rx, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }
    });

    cell(2, 1, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        const grad = c.createRadialGradient(cx - s * 0.05, cy - s * 0.04, s * 0.02, cx, cy, s * 0.42);
        grad.addColorStop(0, 'rgba(62, 5, 5, 0.94)');
        grad.addColorStop(0.58, 'rgba(104, 10, 10, 0.86)');
        grad.addColorStop(0.88, 'rgba(128, 14, 14, 0.45)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = grad;
        c.beginPath();
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const lobe = 0.06 * Math.sin(a * 3 + 0.6) + 0.04 * Math.cos(a * 5);
            const r = s * (0.31 + lobe + rng() * 0.06);
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
    });

    cell(3, 1, (c, s) => {
        c.fillStyle = 'rgba(34, 27, 21, 0.84)';
        const bars = 8;
        const bh = s / (bars * 2);
        for (let i = 0; i < bars; i++) {
            c.fillRect(s * 0.12, i * bh * 2 + bh * 0.4, s * 0.34, bh * 1.05);
            c.fillRect(s * 0.54, i * bh * 2 + bh * 0.4, s * 0.34, bh * 1.05);
        }
    });

    cell(0, 2, (c, s) => {
        const g = c.createLinearGradient(s * 0.12, s * 0.5, s * 0.88, s * 0.5);
        g.addColorStop(0, 'rgba(95, 8, 8, 0.90)');
        g.addColorStop(0.55, 'rgba(125, 12, 12, 0.78)');
        g.addColorStop(1, 'rgba(110, 10, 10, 0)');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(s * 0.36, s * 0.5, s * 0.24, s * 0.065, -0.08, 0, Math.PI * 2);
        c.fill();
        for (let i = 0; i < 14; i++) {
            const t = i / 14;
            const px = s * (0.18 + t * 0.68 + (rng() - 0.5) * 0.06);
            const py = s * (0.5 + (rng() - 0.5) * (0.10 + t * 0.22));
            const rx = s * (0.018 * (1 - t * 0.55) + rng() * 0.014);
            const ry = rx * (1.8 + rng() * 1.8);
            c.fillStyle = `rgba(105, 10, 10, ${0.52 + rng() * 0.36})`;
            c.beginPath();
            c.ellipse(px, py, ry, rx, (rng() - 0.5) * 0.25, 0, Math.PI * 2);
            c.fill();
        }
    });

    cell(1, 2, (c, s) => {
        const ox = s * 0.24, oy = s * 0.5;
        for (let i = 0; i < 30; i++) {
            const a = (rng() - 0.5) * 1.75;
            const dist = s * (0.06 + Math.pow(rng(), 0.75) * 0.58);
            const px = ox + Math.cos(a) * dist;
            const py = oy + Math.sin(a) * dist;
            if (px < s * 0.05 || px > s * 0.95 || py < s * 0.05 || py > s * 0.95) continue;
            const r = s * (0.008 + (1 - dist / (s * 0.66)) * 0.022 * rng());
            c.fillStyle = `rgba(${96 + Math.floor(rng() * 34)}, 9, 9, ${0.48 + rng() * 0.40})`;
            c.beginPath();
            c.ellipse(px, py, r * (1.1 + rng() * 1.3), r, a, 0, Math.PI * 2);
            c.fill();
        }
    });

    cell(2, 2, (c, s) => {
        const cx = s * 0.5, cy = s * 0.5;
        for (let l = 0; l < 3; l++) {
            const lx = cx + (rng() - 0.5) * s * 0.24;
            const ly = cy + (rng() - 0.5) * s * 0.24;
            c.fillStyle = `rgba(${88 + l * 14}, 8, 8, ${0.72 + rng() * 0.16})`;
            c.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                const r = s * (0.05 + rng() * 0.08);
                const px = lx + Math.cos(a) * r;
                const py = ly + Math.sin(a) * r;
                if (i === 0) c.moveTo(px, py);
                else c.lineTo(px, py);
            }
            c.closePath();
            c.fill();
        }
        for (let i = 0; i < 16; i++) {
            const a = rng() * Math.PI * 2;
            const d = s * (0.12 + rng() * 0.30);
            const r = s * (0.008 + rng() * 0.018);
            c.fillStyle = `rgba(112, 10, 10, ${0.52 + rng() * 0.35})`;
            c.beginPath();
            c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
            c.fill();
        }
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

const DECAL_VERTEX = `
attribute float aFrame;
attribute float aHeat;
attribute float aOpacity;
varying vec2 vUv;
varying float vFrame;
varying float vHeat;
varying float vOpacity;

void main() {
    vUv = uv;
    vFrame = aFrame;
    vHeat = aHeat;
    vOpacity = aOpacity;
    vec4 worldPos = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const DECAL_FRAGMENT = `
uniform sampler2D uAtlas;
uniform float uGrid;
varying vec2 vUv;
varying float vFrame;
varying float vHeat;
varying float vOpacity;

void main() {
    float frame = floor(vFrame);
    float row = floor(frame / uGrid);
    float col = frame - row * uGrid;
    vec2 uv = (vec2(col, row) + vUv) / uGrid;
    vec4 tex = texture2D(uAtlas, uv);
    if (tex.a < 0.02) discard;

    vec3 colOut = tex.rgb;
    if (vHeat > 0.001) {
        vec3 heatCol = vec3(1.0, 0.45, 0.08) * vHeat * 2.5;
        colOut += heatCol;
    }
    gl_FragColor = vec4(colOut, tex.a * vOpacity);
}
`;

const _up = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _rotZ = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _n = new THREE.Vector3();
const _right = new THREE.Vector3();
const _leftPos = new THREE.Vector3();
const _rightPos = new THREE.Vector3();
const _groundPos = new THREE.Vector3();
const _negDir = new THREE.Vector3();

const MAX_BUDGET = 800;
const MAX_HEAT_SLOTS = 64;
const MAX_POOL_SLOTS = 64;
const MAX_MOVING_SLOTS = 128;

export function createDecals(engine) {
    let budget = 320;
    let atlas = null;
    let geometry = null;
    let material = null;
    let instancedMesh = null;

    let frames = null;
    let heats = null;
    let opacities = null;

    let head = 0;
    let count = 0;

    const heatDecals = new Array(MAX_HEAT_SLOTS);
    for (let i = 0; i < MAX_HEAT_SLOTS; i++) {
        heatDecals[i] = { active: false, idx: 0, remaining: 0, total: 6.0 };
    }
    let heatPtr = 0;

    const expandingPools = new Array(MAX_POOL_SLOTS);
    for (let i = 0; i < MAX_POOL_SLOTS; i++) {
        expandingPools[i] = {
            active: false,
            idx: 0,
            currentSize: 0.15,
            maxSize: 1.2,
            growTime: 8.0,
            elapsed: 0,
            pos: new THREE.Vector3(),
            quat: new THREE.Quaternion()
        };
    }
    let poolPtr = 0;

    const movingDecals = new Array(MAX_MOVING_SLOTS);
    for (let i = 0; i < MAX_MOVING_SLOTS; i++) {
        movingDecals[i] = {
            active: false,
            idx: 0,
            object: null,
            localPos: new THREE.Vector3(),
            localQuat: new THREE.Quaternion(),
            scale: new THREE.Vector3()
        };
    }
    let movingPtr = 0;

    const trackLastPos = new Map();

    function init() {
        budget = Math.min(MAX_BUDGET, engine.quality?.profile?.decals?.budget ?? 320);
        atlas = buildDecalAtlas();

        const plane = new THREE.PlaneGeometry(1, 1);
        geometry = new THREE.InstancedBufferGeometry();
        geometry.index = plane.index;
        geometry.setAttribute('position', plane.getAttribute('position'));
        geometry.setAttribute('uv', plane.getAttribute('uv'));

        frames = new Float32Array(MAX_BUDGET);
        heats = new Float32Array(MAX_BUDGET);
        opacities = new Float32Array(MAX_BUDGET).fill(1.0);

        geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(frames, 1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heats, 1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage));

        material = new THREE.ShaderMaterial({
            vertexShader: DECAL_VERTEX,
            fragmentShader: DECAL_FRAGMENT,
            uniforms: {
                uAtlas: { value: atlas },
                uGrid: { value: ATLAS_GRID }
            },
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -2.0
        });

        instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_BUDGET);
        instancedMesh.count = 0;
        instancedMesh.frustumCulled = false;
        instancedMesh.name = 'surface_decals';
        engine.scene.add(instancedMesh);
    }

    function addDecal({ kind = 'bullet', surface = 'concrete', pos, normal, size = 0.25, object = null }) {
        if (!instancedMesh || !pos) return -1;
        const idx = head;
        head = (head + 1) % budget;
        if (count < budget) count++;

        let frameId = DECAL_CONCRETE;
        let isHeat = false;
        let isPool = false;

        if (kind === 'crater') {
            frameId = DECAL_CRATER;
        } else if (kind === 'heat') {
            frameId = DECAL_HEAT;
            isHeat = true;
        } else if (kind === 'blood_splat') {
            frameId = BLOOD_SPLAT_FRAMES[Math.floor(Math.random() * BLOOD_SPLAT_FRAMES.length)];
        } else if (kind === 'blood_pool') {
            frameId = DECAL_BLOOD_POOL;
            isPool = true;
        } else if (kind === 'tread') {
            frameId = DECAL_TREAD;
        } else {
            if (surface === 'metal' || surface === 'armor') frameId = DECAL_METAL;
            else if (surface === 'wood') frameId = DECAL_WOOD;
            else frameId = DECAL_CONCRETE;
        }

        frames[idx] = frameId;
        heats[idx] = isHeat ? 1.0 : 0.0;
        opacities[idx] = kind === 'blood_splat' ? (0.68 + Math.random() * 0.22) : 1.0;

        _pos.copy(pos);
        if (normal) {
            _n.copy(normal).normalize();
            _pos.addScaledVector(_n, 0.005);
            _quat.setFromUnitVectors(_up, _n);
        } else {
            _quat.set(0, 0, 0, 1);
        }

        _rotZ.setFromAxisAngle(_axisZ, Math.random() * Math.PI * 2);
        _quat.multiply(_rotZ);
        if (kind === 'blood_splat') {
            _scale.set(size * (0.82 + Math.random() * 0.42), size * (0.78 + Math.random() * 0.36), size);
        } else {
            _scale.set(size, size, size);
        }
        _mat.compose(_pos, _quat, _scale);
        instancedMesh.setMatrixAt(idx, _mat);

        if (isHeat) {
            const hd = heatDecals[heatPtr];
            heatPtr = (heatPtr + 1) % MAX_HEAT_SLOTS;
            hd.active = true;
            hd.idx = idx;
            hd.remaining = 6.0;
            hd.total = 6.0;
        }
        if (isPool) {
            const ep = expandingPools[poolPtr];
            poolPtr = (poolPtr + 1) % MAX_POOL_SLOTS;
            ep.active = true;
            ep.idx = idx;
            ep.currentSize = size * 0.15;
            ep.maxSize = size;
            ep.growTime = 8.0;
            ep.elapsed = 0;
            ep.pos.copy(_pos);
            ep.quat.copy(_quat);
        }
        if (object && object !== engine.scene) {
            const md = movingDecals[movingPtr];
            movingPtr = (movingPtr + 1) % MAX_MOVING_SLOTS;
            md.active = true;
            md.idx = idx;
            md.object = object;
            md.localPos.copy(_pos);
            object.worldToLocal(md.localPos);
            md.localQuat.copy(object.quaternion).invert().multiply(_quat);
            md.scale.copy(_scale);
        }

        instancedMesh.count = count;
        instancedMesh.instanceMatrix.needsUpdate = true;
        geometry.attributes.aFrame.needsUpdate = true;
        geometry.attributes.aHeat.needsUpdate = true;
        geometry.attributes.aOpacity.needsUpdate = true;
        return idx;
    }

    function updateDecals(dt) {
        if (!instancedMesh) return;
        let dirtyMatrix = false;
        let dirtyHeat = false;

        for (let i = 0; i < MAX_HEAT_SLOTS; i++) {
            const hd = heatDecals[i];
            if (!hd.active) continue;
            hd.remaining -= dt;
            if (hd.remaining <= 0) {
                heats[hd.idx] = 0;
                hd.active = false;
            } else {
                heats[hd.idx] = Math.pow(hd.remaining / hd.total, 1.8);
            }
            dirtyHeat = true;
        }

        for (let i = 0; i < MAX_POOL_SLOTS; i++) {
            const ep = expandingPools[i];
            if (!ep.active) continue;
            ep.elapsed += dt;
            const progress = Math.min(1.0, ep.elapsed / ep.growTime);
            const curSize = THREE.MathUtils.lerp(ep.currentSize, ep.maxSize, Math.sqrt(progress));
            _scale.set(curSize, curSize, curSize);
            _mat.compose(ep.pos, ep.quat, _scale);
            instancedMesh.setMatrixAt(ep.idx, _mat);
            dirtyMatrix = true;
            if (progress >= 1.0) {
                ep.active = false;
            }
        }

        for (let i = 0; i < MAX_MOVING_SLOTS; i++) {
            const md = movingDecals[i];
            if (!md.active) continue;
            if (!md.object || !md.object.parent) {
                md.active = false;
                continue;
            }
            md.object.updateWorldMatrix(true, false);
            _pos.copy(md.localPos).applyMatrix4(md.object.matrixWorld);
            _quat.copy(md.object.quaternion).multiply(md.localQuat);
            _mat.compose(_pos, _quat, md.scale);
            instancedMesh.setMatrixAt(md.idx, _mat);
            dirtyMatrix = true;
        }

        if (engine.ragdollPhysics?.vehicles) {
            const vehicles = engine.ragdollPhysics.vehicles;
            for (let i = 0; i < vehicles.length; i++) {
                const veh = vehicles[i];
                if (veh.destroyed || Math.abs(veh.forwardSpeed) < 0.5) continue;
                let last = trackLastPos.get(veh.id);
                if (!last) {
                    last = new THREE.Vector3().copy(veh.chassisPos);
                    trackLastPos.set(veh.id, last);
                    continue;
                }
                if (veh.chassisPos.distanceToSquared(last) > 0.64) {
                    last.copy(veh.chassisPos);
                    _right.set(1, 0, 0).applyQuaternion(veh.chassisQuat);
                    const halfTrack = (veh.spec.halfExtents[0] || 1.5) * 0.85;

                    _leftPos.copy(veh.chassisPos).addScaledVector(_right, -halfTrack);
                    _leftPos.y = 0.01;
                    _rightPos.copy(veh.chassisPos).addScaledVector(_right, halfTrack);
                    _rightPos.y = 0.01;

                    addDecal({ kind: 'tread', pos: _leftPos, normal: _up, size: 0.9 });
                    addDecal({ kind: 'tread', pos: _rightPos, normal: _up, size: 0.9 });
                }
            }
        }

        if (dirtyMatrix) instancedMesh.instanceMatrix.needsUpdate = true;
        if (dirtyHeat) geometry.attributes.aHeat.needsUpdate = true;
    }

    const mod = {
        name: 'decals',
        add: addDecal,
        get count() {
            return count;
        },
        get mesh() {
            return instancedMesh;
        },

        install() {
            init();

            engine.events.on('impact', (ev) => {
                if (!ev || !ev.pos) return;
                const surface = ev.surface || (ev.material ? ev.material : 'concrete');
                const size = ev.energy ? Math.min(0.65, 0.15 + (ev.energy / 4000) * 0.25) : 0.2;
                addDecal({ kind: 'bullet', surface, pos: ev.pos, normal: ev.normal, size, object: ev.object });
            });

            engine.events.on('explosion', (ev) => {
                if (!ev || !ev.pos) return;
                const radius = ev.radius || 6.0;
                const prof = computeExplosionProfile(ev.kind, radius);
                const size = Math.min(8.0, radius * 0.7 * prof.craterScale);
                const norm = ev.normal || _up;
                addDecal({ kind: 'crater', pos: ev.pos, normal: norm, size });
            });

            engine.events.on('unit:hit', (ev) => {
                if (!ev || !ev.pos) return;
                if (ev.dir) {
                    _negDir.copy(ev.dir).negate();
                } else {
                    _negDir.copy(_up);
                }
                const compact = ev.zone === 'HEAD' ? (0.19 + Math.random() * 0.14) : (0.14 + Math.random() * 0.16);
                addDecal({ kind: 'blood_splat', pos: ev.pos, normal: _negDir, size: compact });
            });

            engine.events.on('unit:killed', (ev) => {
                if (!ev || !ev.unit?.root) return;
                _groundPos.copy(ev.unit.root.position);
                _groundPos.y = 0.01;
                addDecal({ kind: 'blood_pool', pos: _groundPos, normal: _up, size: 0.72 + Math.random() * 0.42 });
            });

            engine.events.on('vehicle:hit', (ev) => {
                if (!ev || !ev.pos) return;
                if (ev.ammo?.isHeat || ev.ammo?.shapedCharge || ev.isHeat || ev.ammo?.type === 'HEAT') {
                    addDecal({ kind: 'heat', pos: ev.pos, normal: ev.normal, size: 0.28, object: ev.vehicle?.mesh });
                } else {
                    addDecal({ kind: 'bullet', surface: 'metal', pos: ev.pos, normal: ev.normal, size: 0.22, object: ev.vehicle?.mesh });
                }
            });

            engine.events.on('quality:changed', () => {
                budget = Math.min(MAX_BUDGET, engine.quality?.profile?.decals?.budget ?? 320);
                if (head >= budget) head = 0;
                if (count > budget) {
                    count = budget;
                    if (instancedMesh) instancedMesh.count = count;
                }
            });
        },

        update(dt) {
            updateDecals(dt);
        }
    };

    return mod;
}
