import * as THREE from 'three';
import { createProceduralTacticalArms, poseTacticalFingers } from './fp_arm_rig.js';
import {
    stepFreeAimDeadzone,
    decayFreeAimDeadzone,
    createRecoilState,
    applyWeaponShotRecoil,
    stepRecoilState,
    computeWallTuck,
    sampleBodycamBreath
} from './bodycam_math.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _T = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _Ek = new THREE.Vector3();
const _gripWorld = new THREE.Vector3();
const _guardWorld = new THREE.Vector3();
const _wristTgt = new THREE.Vector3();
const _poleR = new THREE.Vector3();
const _poleL = new THREE.Vector3();
const _knuckleDirR = new THREE.Vector3();
const _knuckleDirL = new THREE.Vector3();
const _palmWorldR = new THREE.Vector3();
const _palmWorldL = new THREE.Vector3();
const _vSide = new THREE.Vector3();
const _palmOrtho = new THREE.Vector3();
const _foreDir = new THREE.Vector3();
const _foreSide = new THREE.Vector3();
const _tgtSide = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _rayOrig = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _muzzleTmp = new THREE.Vector3();
const _basisM4 = new THREE.Matrix4();
const _basisQuat = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qTwist = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _scale = new THREE.Vector3();

const IK_EPSILON = 1e-6;

const SIGHT_FOV_MULT = {
    ak12: 0.84,
    m4a1: 0.84,
    ak74m: 0.86,
    rpg7: 0.72
};

// Millimeter-calibrated local weapon sockets measured directly from GLB weapon meshes
const WEAPON_SOCKETS = {
    ak12: {
        grip: [-0.007, 0.062, 0.138],
        gripDir: [-0.16, -0.26, -0.95],
        palmR: [-0.96, 0.12, 0.24],
        wristBackR: 0.042,
        wristOutR: 0.026,
        handguard: [-0.009, 0.114, -0.130],
        guardDir: [0.58, 0.14, -0.80],
        palmL: [0.54, 0.78, 0.31],
        wristBackL: 0.042,
        wristOutL: 0.022,
        magGrab: [-0.008, 0.042, 0.006],
        boltGrab: [0.018, 0.132, 0.018],
        muzzle: [-0.007, 0.122, -0.32],
        ejectionPort: [0.022, 0.132, 0.022]
    },
    m4a1: {
        grip: [0.000, 0.060, 0.124],
        gripDir: [-0.16, -0.26, -0.95],
        palmR: [-0.96, 0.12, 0.24],
        wristBackR: 0.042,
        wristOutR: 0.026,
        handguard: [-0.002, 0.116, -0.136],
        guardDir: [0.58, 0.14, -0.80],
        palmL: [0.54, 0.78, 0.31],
        wristBackL: 0.042,
        wristOutL: 0.024,
        magGrab: [0.000, 0.042, -0.006],
        boltGrab: [0.000, 0.146, 0.105],
        muzzle: [0.000, 0.126, -0.33],
        ejectionPort: [0.024, 0.132, 0.015]
    },
    ak74m: {
        grip: [-0.012, 0.065, 0.134],
        gripDir: [-0.16, -0.26, -0.95],
        palmR: [-0.96, 0.12, 0.24],
        wristBackR: 0.042,
        wristOutR: 0.026,
        handguard: [-0.014, 0.122, -0.128],
        guardDir: [0.58, 0.14, -0.80],
        palmL: [0.54, 0.78, 0.31],
        wristBackL: 0.042,
        wristOutL: 0.022,
        magGrab: [-0.012, 0.044, 0.006],
        boltGrab: [0.016, 0.138, 0.016],
        muzzle: [-0.012, 0.130, -0.34],
        ejectionPort: [0.022, 0.136, 0.020]
    },
    rpg7: {
        grip: [0.112, 0.054, 0.088],
        gripDir: [-0.14, -0.22, -0.96],
        palmR: [-0.96, 0.12, 0.24],
        wristBackR: 0.042,
        wristOutR: 0.024,
        handguard: [0.112, 0.048, -0.074],
        guardDir: [0.16, -0.20, -0.96],
        palmL: [0.95, 0.14, 0.26],
        wristBackL: 0.042,
        wristOutL: 0.022,
        magGrab: [0.112, 0.088, -0.34],
        boltGrab: [0.112, 0.048, -0.074],
        muzzle: [0.112, 0.112, -0.48],
        ejectionPort: [0.112, 0.112, 0.48]
    }
};

function worldPos(obj, out) {
    obj.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(obj.matrixWorld);
}

function worldQuat(obj, out) {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(_v1, out, _scale);
    return out;
}

function setWorldQuat(obj, qw) {
    const parent = obj.parent;
    if (!parent) {
        obj.quaternion.copy(qw);
        obj.updateMatrixWorld(true);
        return;
    }
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_v1, _qp, _scale);
    obj.quaternion.copy(_qp.invert()).multiply(qw);
    obj.updateMatrixWorld(true);
}

function aimNode(node, child, target) {
    worldPos(node, _v1);
    worldPos(child, _v2);
    _v3.subVectors(_v2, _v1);
    if (_v3.lengthSq() < 1e-10) return;
    _v3.normalize();
    _d.subVectors(target, _v1);
    if (_d.lengthSq() < 1e-10) return;
    _d.normalize();
    _qs.setFromUnitVectors(_v3, _d);
    worldQuat(node, _qw);
    _qw.premultiply(_qs);
    setWorldQuat(node, _qw);
}

export function solveTwoBoneIK(upper, lower, hand, targetPos, poleVec) {
    if (!upper || !lower || !hand) return 0;
    worldPos(upper, _S);
    worldPos(lower, _E);
    worldPos(hand, _W);
    const l1 = _S.distanceTo(_E);
    const l2 = _E.distanceTo(_W);
    if (l1 < IK_EPSILON || l2 < IK_EPSILON) return 0;
    _d.subVectors(targetPos, _S);
    const dist = _d.length();
    if (dist < IK_EPSILON) return 0;
    const dc = Math.min((l1 + l2) * 0.996, Math.max(Math.abs(l1 - l2) + 0.01, dist));
    _d.multiplyScalar(1 / dist);
    _T.copy(_S).addScaledVector(_d, dc);
    const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _pv.copy(poleVec);
    _pv.addScaledVector(_d, -_pv.dot(_d));
    if (_pv.lengthSq() < IK_EPSILON) _pv.set(0, -1, 0).addScaledVector(_d, _d.y);
    _pv.normalize();
    _Ek.copy(_S).addScaledVector(_d, along).addScaledVector(_pv, h);
    aimNode(upper, lower, _Ek);
    aimNode(lower, hand, _T);
    return Math.max(0, dist - dc);
}

export function computeHandBasis(knuckleDir, palmNormal, outQuat) {
    _vSide.crossVectors(knuckleDir, palmNormal);
    if (_vSide.lengthSq() < 1e-8) {
        _vSide.set(1, 0, 0);
    } else {
        _vSide.normalize();
    }
    _palmOrtho.crossVectors(_vSide, knuckleDir).normalize();
    _basisM4.makeBasis(_vSide, knuckleDir, _palmOrtho);
    return outQuat.setFromRotationMatrix(_basisM4);
}

function orientHandAndDistributeTwist(arm, knuckleDir, palmNormal) {
    const { lower, foreTwist, hand } = arm;
    if (!lower || !hand) return;

    // 1. Compute angle between forearm current +X and target hand +X around forearm axis (+Y)
    worldPos(lower, _E);
    worldPos(hand, _W);
    _foreDir.subVectors(_W, _E);
    if (_foreDir.lengthSq() > 1e-8) {
        _foreDir.normalize();
        _tgtSide.crossVectors(knuckleDir, palmNormal);
        if (_tgtSide.lengthSq() > 1e-8) {
            _tgtSide.addScaledVector(_foreDir, -_tgtSide.dot(_foreDir));
            if (_tgtSide.lengthSq() > 1e-8) {
                _tgtSide.normalize();
                worldQuat(lower, _qw);
                _foreSide.set(1, 0, 0).applyQuaternion(_qw);
                _foreSide.addScaledVector(_foreDir, -_foreSide.dot(_foreDir));
                if (_foreSide.lengthSq() > 1e-8) {
                    _foreSide.normalize();
                    const cosA = Math.max(-1, Math.min(1, _foreSide.dot(_tgtSide)));
                    _cross.crossVectors(_foreSide, _tgtSide);
                    const sinA = _cross.dot(_foreDir);
                    const fullTwist = Math.atan2(sinA, cosA);

                    // Split pronation/supination smoothly across proximal (35%) and distal twist node (60%)
                    // Prevents sleeve pinching and naturally rotates the left tactical watch into view
                    _qTwist.setFromAxisAngle(_foreDir, fullTwist * 0.35);
                    _qw.premultiply(_qTwist);
                    setWorldQuat(lower, _qw);

                    if (foreTwist) {
                        foreTwist.rotation.set(0, fullTwist * 0.60, 0);
                    }
                }
            }
        }
    }

    // 2. Lock hand exactly to canonical weapon grip basis
    computeHandBasis(knuckleDir, palmNormal, _basisQuat);
    setWorldQuat(hand, _basisQuat);
}

/* MUZZLE FLASH 3D RIG */
function createFpMuzzleTexture() {
    const size = 256;
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d');
    const cx = size * 0.5;
    const cy = size * 0.5;

    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.46);
    halo.addColorStop(0, 'rgba(255,255,245,1.0)');
    halo.addColorStop(0.22, 'rgba(255,215,120,0.88)');
    halo.addColorStop(0.55, 'rgba(255,120,24,0.35)');
    halo.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i / 6) * Math.PI * 2 + 0.25);
        const len = i % 2 === 0 ? size * 0.48 : size * 0.32;
        const w = i % 2 === 0 ? size * 0.085 : size * 0.055;
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, 'rgba(255,252,225,0.98)');
        g.addColorStop(0.45, 'rgba(255,175,55,0.75)');
        g.addColorStop(1, 'rgba(255,90,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -w);
        ctx.lineTo(len, 0);
        ctx.lineTo(0, w);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function createFpMuzzleConeTexture() {
    const size = 256;
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, size, 0, 0);
    g.addColorStop(0, 'rgba(255,252,230,1.0)');
    g.addColorStop(0.32, 'rgba(255,190,75,0.82)');
    g.addColorStop(0.75, 'rgba(255,95,18,0.28)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(size * 0.40, size);
    ctx.quadraticCurveTo(size * 0.14, size * 0.45, size * 0.50, 0);
    ctx.quadraticCurveTo(size * 0.86, size * 0.45, size * 0.60, size);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

export function createArms(engine) {
    let rig = null;
    let builtFaction = null;
    let armsReady = false;

    const deadzoneState = { yaw: 0, pitch: 0 };
    const recoilState = createRecoilState();
    const lastCameraPunch = { pitch: 0, yaw: 0, roll: 0, fovKick: 0, trauma: 0 };

    let aimBlend = 0;
    let sprintBlend = 0;
    let crouchBlend = 0;
    let tuckBlend = 0;
    let targetTuck = 0;
    let tuckCheckFrame = 0;
    let staminaLoad = 0;
    let prevStepSign = 1;
    let heelDrop = 0;
    let heelRoll = 0;

    let reloadPhase = 0;
    let reloadTimer = 0;
    let reloadTotal = 0;
    let boltClicked = false;
    let magUnseated = false;
    let switchPhase = 0;
    let switchTimer = 0;
    let magCheckTimer = 0;
    let jamClearTimer = 0;
    let recoilElbowKick = 0;
    let recoilWristPitch = 0;
    let triggerSqueeze = 0;
    let boltBlowback = 0;

    let fpFlashTimer = 0;
    let barrelHeat = 0;
    let smokeEmitTimer = 0;
    const fpMuzzleRigs = new Map();
    const fpBaked = new Map();
    let fpFireT = 0;
    let fpEquipT = 0;
    let fpInspectT = 0;
    let fpPrevReloading = false;
    const tuckRaycaster = new THREE.Raycaster();
    tuckRaycaster.far = 0.92;

    let leftHandMode = 'CCLAMP';
    const leftHandTargetLocal = new THREE.Vector3();
    const leftKnuckleLocal = new THREE.Vector3();
    const leftPalmLocal = new THREE.Vector3();
    const weaponAnimPos = new THREE.Vector3();
    const weaponAnimRot = new THREE.Euler();
    let propWarheadMesh = null;

    function ensureFpMuzzleRigs() {
        if (fpMuzzleRigs.size > 0) return;
        const starTex = createFpMuzzleTexture();
        const coneTex = createFpMuzzleConeTexture();
        const starMat = new THREE.MeshBasicMaterial({
            map: starTex,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const coneMat = new THREE.MeshBasicMaterial({
            map: coneTex,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        for (const key of engine.loadoutKeys) {
            const wState = engine.weaponStates[key];
            const sock = WEAPON_SOCKETS[key];
            if (!wState || !wState.meshGroup || !sock) continue;
            const mRig = new THREE.Group();
            mRig.name = `fp_muzzle_${key}`;
            mRig.position.fromArray(sock.muzzle);

            const scale = key === 'rpg7' ? 0.48 : 0.22;
            const starPlane = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), starMat);
            starPlane.renderOrder = 95;
            mRig.add(starPlane);

            const jetLen = key === 'rpg7' ? 0.58 : 0.30;
            const jetW = key === 'rpg7' ? 0.24 : 0.13;
            const jetGeo = new THREE.PlaneGeometry(jetW, jetLen);
            jetGeo.translate(0, jetLen * 0.5, 0);
            jetGeo.rotateX(-Math.PI * 0.5);

            const jet1 = new THREE.Mesh(jetGeo, coneMat);
            jet1.renderOrder = 95;
            const jet2 = new THREE.Mesh(jetGeo, coneMat);
            jet2.rotation.z = Math.PI * 0.5;
            jet2.renderOrder = 95;
            mRig.add(jet1, jet2);

            mRig.visible = false;
            wState.meshGroup.add(mRig);
            fpMuzzleRigs.set(key, mRig);
        }
    }

    function ensurePropWarhead() {
        if (propWarheadMesh) return;
        const wState = engine.weaponStates['rpg7'];
        if (!wState || !wState.meshGroup) return;
        const g = new THREE.Group();
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(0.044, 0.22, 12),
            new THREE.MeshStandardMaterial({ color: 0x4b5738, roughness: 0.62, metalness: 0.28 })
        );
        cone.rotation.x = -Math.PI * 0.5;
        const body = new THREE.Mesh(
            new THREE.ConeGeometry(0.044, 0.14, 12),
            new THREE.MeshStandardMaterial({ color: 0x434f32, roughness: 0.65, metalness: 0.25 })
        );
        body.rotation.x = Math.PI * 0.5;
        body.position.z = 0.18;
        const tail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.016, 0.016, 0.26, 8),
            new THREE.MeshStandardMaterial({ color: 0x3b442c, roughness: 0.7, metalness: 0.25 })
        );
        tail.rotation.x = Math.PI * 0.5;
        tail.position.z = 0.32;
        g.add(cone, body, tail);
        g.visible = false;
        wState.meshGroup.add(g);
        propWarheadMesh = g;
    }

    function findFpClip(clips, suffix) {
        const low = suffix.toLowerCase();
        return clips.find((c) => c.name.toLowerCase().endsWith(low)) || null;
    }

    function initBakedFpModels() {
        const map = [
            ['ak74m', 'fp_arms_ak74m'],
            ['ak12', 'fp_arms_ak12'],
            ['m4a1', 'fp_arms_m4a1'],
            ['rpg7', 'fp_arms_rpg7']
        ];
        const starTex = createFpMuzzleTexture();
        const coneTex = createFpMuzzleConeTexture();
        const starMat = new THREE.MeshBasicMaterial({
            map: starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        });
        const coneMat = new THREE.MeshBasicMaterial({
            map: coneTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        });

        for (const [wKey, assetKey] of map) {
            if (fpBaked.has(wKey)) continue;
            const built = engine.assets.instantiateSkinned(assetKey, null);
            if (!built || !built.animations || built.animations.length === 0) continue;

            const pivot = new THREE.Group();
            pivot.name = `fp_baked_pivot_${wKey}`;
            const model = built.model;
            model.rotation.y = Math.PI;
            model.position.set(0, -1.565, -0.02);
            model.traverse((c) => {
                if (c.isMesh) {
                    c.frustumCulled = false;
                    c.castShadow = false;
                    c.receiveShadow = true;
                }
            });
            pivot.add(model);
            pivot.visible = false;
            engine.camera.add(pivot);

            const mixer = new THREE.AnimationMixer(model);
            const defs = [
                ['idle', '_idle', true],
                ['walk', '_walk', true],
                ['sprint', '_sprint', true],
                ['ads_in', '_ads_in', false],
                ['ads_idle', '_ads_idle', true],
                ['ads_walk', '_ads_walk', true],
                ['fire', '_fire', false],
                ['ads_fire', '_ads_fire', false],
                ['reload', '_reload', false],
                ['equip', '_equip', false],
                ['inspect', '_inspect', false]
            ];
            const states = {};
            for (const [k, sfx, loop] of defs) {
                let clip = findFpClip(built.animations, sfx);
                if (k === 'idle') clip = built.animations.find((c) => /^(fp|fpru|fpm4|fprpg)_idle$/i.test(c.name)) || clip;
                if (k === 'walk') clip = built.animations.find((c) => /^(fp|fpru|fpm4|fprpg)_walk$/i.test(c.name)) || clip;
                if (k === 'fire') clip = built.animations.find((c) => /^(fp|fpru|fpm4|fprpg)_fire$/i.test(c.name)) || clip;
                if (!clip) continue;
                const action = mixer.clipAction(clip);
                action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
                action.clampWhenFinished = !loop;
                action.play();
                const w0 = k === 'idle' ? 1 : 0;
                action.setEffectiveWeight(w0);
                states[k] = { action, clip, w: w0, loop };
            }

            const gunBone = model.getObjectByName('gun') || null;
            const warheadNode = wKey === 'rpg7' ? (model.getObjectByName('FPRPG_Warhead') || null) : null;
            const muzzleRig = new THREE.Group();
            muzzleRig.name = `fp_baked_muzzle_${wKey}`;
            const mScale = wKey === 'rpg7' ? 0.48 : 0.24;
            const jetLen = wKey === 'rpg7' ? 0.58 : 0.30;
            const jetW = wKey === 'rpg7' ? 0.24 : 0.13;
            const starPlane = new THREE.Mesh(new THREE.PlaneGeometry(mScale, mScale), starMat);
            starPlane.renderOrder = 95;
            const jetGeo = new THREE.PlaneGeometry(jetW, jetLen);
            jetGeo.translate(0, jetLen * 0.5, 0);
            jetGeo.rotateX(-Math.PI * 0.5);
            const jet1 = new THREE.Mesh(jetGeo, coneMat);
            jet1.renderOrder = 95;
            const jet2 = new THREE.Mesh(jetGeo, coneMat);
            jet2.rotation.z = Math.PI * 0.5;
            jet2.renderOrder = 95;
            muzzleRig.add(starPlane, jet1, jet2);
            muzzleRig.visible = false;
            engine.camera.add(muzzleRig);

            fpBaked.set(wKey, { pivot, model, mixer, gunBone, warheadNode, states, muzzleRig });
        }
    }

    function initArms() {
        const faction = engine.playerFaction || 'RU';
        initBakedFpModels();
        if (armsReady && builtFaction === faction && rig) return;

        if (rig && rig.root && rig.root.parent) {
            rig.root.parent.remove(rig.root);
        }

        rig = createProceduralTacticalArms(faction);
        engine.camera.add(rig.root);
        rig.root.position.set(0.0, -0.225, 0.055);

        ensurePropWarhead();
        ensureFpMuzzleRigs();

        builtFaction = faction;
        armsReady = true;
    }

    function getMuzzleWorld(out) {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const baked = fpBaked.get(key);
        if (baked && baked.gunBone) {
            baked.gunBone.updateWorldMatrix(true, false);
            baked.gunBone.getWorldScale(_scale);
            const sy = Math.max(_scale.y, 1e-4);
            const sz = Math.max(_scale.z, 1e-4);
            const my = key === 'rpg7' ? 0.42 : (key === 'm4a1' ? 0.57 : 0.66);
            const mz = key === 'rpg7' ? 0.068 : (key === 'm4a1' ? 0.088 : 0.082);
            return out.set(0, my / sy, mz / sz).applyMatrix4(baked.gunBone.matrixWorld);
        }
        const wState = engine.weaponStates[key];
        const sock = WEAPON_SOCKETS[key] || WEAPON_SOCKETS.ak12;
        if (wState && wState.meshGroup) {
            wState.meshGroup.updateWorldMatrix(true, false);
            return out.fromArray(sock.muzzle).applyMatrix4(wState.meshGroup.matrixWorld);
        }
        engine.camera.getWorldPosition(out);
        _v1.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
        return out.addScaledVector(_v1, 0.72);
    }

    function getEjectionPortWorld(out) {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const baked = fpBaked.get(key);
        if (baked && baked.gunBone) {
            baked.gunBone.updateWorldMatrix(true, false);
            baked.gunBone.getWorldScale(_scale);
            const sx = Math.max(_scale.x, 1e-4);
            const sy = Math.max(_scale.y, 1e-4);
            const sz = Math.max(_scale.z, 1e-4);
            return out.set(0.032 / sx, 0.145 / sy, 0.095 / sz).applyMatrix4(baked.gunBone.matrixWorld);
        }
        const wState = engine.weaponStates[key];
        const sock = WEAPON_SOCKETS[key] || WEAPON_SOCKETS.ak12;
        if (wState && wState.meshGroup) {
            wState.meshGroup.updateWorldMatrix(true, false);
            return out.fromArray(sock.ejectionPort).applyMatrix4(wState.meshGroup.matrixWorld);
        }
        return out.set(0.18, -0.09, -0.35).applyMatrix4(engine.camera.matrixWorld);
    }

    function updateWallTuck(dt) {
        tuckCheckFrame = (tuckCheckFrame + 1) & 1;
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const wState = engine.weaponStates[key];
        if (tuckCheckFrame === 0) {
            if (wState?.reloading || !engine.staticShootableMeshes || engine.staticShootableMeshes.length === 0) {
                targetTuck = 0;
            } else {
                engine.camera.getWorldPosition(_rayOrig);
                _rayDir.set(0, 0, -1).applyQuaternion(engine.camera.quaternion).normalize();
                tuckRaycaster.set(_rayOrig, _rayDir);
                const hits = tuckRaycaster.intersectObjects(engine.staticShootableMeshes, false);
                if (hits.length > 0) {
                    targetTuck = computeWallTuck(hits[0].distance, key === 'rpg7' ? 1.02 : 0.88, 0.24);
                } else {
                    targetTuck = 0;
                }
            }
        }
        tuckBlend += (targetTuck - tuckBlend) * Math.min(1, dt * 14.0);
    }

    function updateDeadzoneAndRecoil(dt) {
        if (!engine.isStarted) return;
        const horizSpeed = Math.hypot(engine.playerVelocity.x, engine.playerVelocity.z);
        decayFreeAimDeadzone(deadzoneState, dt, engine.isAiming, horizSpeed > 0.6);

        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const punch = stepRecoilState(recoilState, dt, key);
        if (Math.abs(punch.pitchReturnDelta) > 1e-6 && !engine.isFiring) {
            engine.pitch = Math.max(-1.35, Math.min(1.35, engine.pitch + punch.pitchReturnDelta));
        }

        if (horizSpeed > 0.65 && engine.playerOnFloor) {
            const stepSin = Math.sin(engine.bobTimer);
            if ((prevStepSign < 0 && stepSin >= 0) || (prevStepSign > 0 && stepSin <= 0)) {
                const amp = Math.min(1, horizSpeed / 12.0) * (engine.isAiming ? 0.35 : 1.0);
                const side = stepSin >= 0 ? 1 : -1;
                heelDrop = Math.max(heelDrop, 0.012 * amp);
                heelRoll += side * 0.0085 * amp;
                engine.posSpring?.applyImpulse?.(side * 0.08 * amp, -0.32 * amp, 0.06 * amp);
                engine.rotSpring?.applyImpulse?.(-0.22 * amp, 0, side * 0.34 * amp);
            }
            prevStepSign = stepSin;
        }
        heelDrop *= Math.exp(-15.0 * dt);
        heelRoll *= Math.exp(-12.0 * dt);

        const targetStamina = engine.isSprinting ? 1.0 : (horizSpeed > 2.5 ? 0.35 : 0.0);
        staminaLoad += (targetStamina - staminaLoad) * Math.min(1, dt * (targetStamina > staminaLoad ? 0.9 : 0.45));
        crouchBlend += ((engine.isCrouching ? 1 : 0) - crouchBlend) * Math.min(1, dt * 9.0);

        lastCameraPunch.pitch = punch.pitchOffset - heelDrop * 0.85;
        lastCameraPunch.yaw = punch.yawOffset;
        lastCameraPunch.roll = punch.rollOffset + heelRoll;
        lastCameraPunch.fovKick = punch.fovKick;
        lastCameraPunch.trauma = recoilState.trauma;

        recoilElbowKick *= Math.exp(-13.5 * dt);
        recoilWristPitch *= Math.exp(-15.5 * dt);
        triggerSqueeze *= Math.exp(-18.0 * dt);
        boltBlowback *= Math.exp(-30.0 * dt);

        if (fpFlashTimer > 0) {
            fpFlashTimer = Math.max(0, fpFlashTimer - dt);
            const activeRig = fpMuzzleRigs.get(key);
            for (const [k, mRig] of fpMuzzleRigs) {
                mRig.visible = (k === key && fpFlashTimer > 0);
            }
            if (activeRig && fpFlashTimer > 0) {
                activeRig.rotation.z = Math.random() * Math.PI * 2;
                const sc = 0.82 + Math.random() * 0.42;
                activeRig.scale.set(sc, sc, sc * (0.85 + Math.random() * 0.35));
            }
        } else {
            for (const mRig of fpMuzzleRigs.values()) {
                if (mRig.visible) mRig.visible = false;
            }
        }

        if (barrelHeat > 0) {
            barrelHeat = Math.max(0, barrelHeat - dt * 0.14);
            smokeEmitTimer -= dt;
            if (barrelHeat > 0.14 && smokeEmitTimer <= 0 && engine.vfx && typeof engine.vfx.barrelSmoke === 'function') {
                smokeEmitTimer = 0.08 + (1 - Math.min(1, barrelHeat)) * 0.12;
                getMuzzleWorld(_muzzleTmp);
                engine.vfx.barrelSmoke(_muzzleTmp, Math.min(1, barrelHeat));
            }
        }
    }

    function resetWeaponSubParts(wState) {
        if (!wState) return;
        if (wState.magPivot && wState.magRestPos) {
            wState.magPivot.position.copy(wState.magRestPos);
            wState.magPivot.rotation.set(0, 0, 0);
            wState.magPivot.visible = true;
        }
        if (wState.boltPivot && wState.boltRestPos) {
            wState.boltPivot.position.copy(wState.boltRestPos);
            wState.boltPivot.position.z += boltBlowback * 0.058;
            wState.boltPivot.rotation.set(0, 0, 0);
        }
    }

    function updateReloadAndHandling(dt) {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const wState = engine.weaponStates[key];
        const sock = WEAPON_SOCKETS[key] || WEAPON_SOCKETS.ak12;

        weaponAnimPos.set(0, 0, 0);
        weaponAnimRot.set(0, 0, 0);
        leftHandMode = key === 'rpg7' ? 'RPG_GRIP' : 'CCLAMP';
        leftHandTargetLocal.fromArray(sock.handguard);
        leftKnuckleLocal.fromArray(sock.guardDir);
        leftPalmLocal.fromArray(sock.palmL);

        if (propWarheadMesh) propWarheadMesh.visible = false;
        resetWeaponSubParts(wState);

        const breath = sampleBodycamBreath(engine.time, staminaLoad, aimBlend, crouchBlend);
        weaponAnimPos.x += breath.x;
        weaponAnimPos.y += breath.y;
        weaponAnimRot.x += breath.pitch;
        weaponAnimRot.z += breath.roll;

        const hipFactor = 1.0 - aimBlend;
        if (key !== 'rpg7') {
            // Subtle tactical hip cant + crisp ADS transition roll
            weaponAnimRot.z -= 0.095 * hipFactor;
            weaponAnimRot.y -= 0.025 * hipFactor;
            const transDip = Math.sin(aimBlend * Math.PI);
            weaponAnimPos.y -= transDip * 0.010;
            weaponAnimRot.z -= transDip * 0.068;
        }

        if (tuckBlend > 0.002) {
            const tb = tuckBlend * tuckBlend * (3 - 2 * tuckBlend);
            weaponAnimPos.z += tb * 0.18;
            weaponAnimPos.y -= tb * 0.055;
            weaponAnimPos.x -= tb * 0.025;
            weaponAnimRot.x += tb * 0.56;
            weaponAnimRot.y += tb * 0.24;
            weaponAnimRot.z -= tb * 0.28;
        }

        const targetSprint = (engine.isSprinting && !engine.isAiming && !(wState && wState.reloading) && magCheckTimer <= 0 && jamClearTimer <= 0 && switchPhase === 0) ? 1.0 : 0.0;
        sprintBlend += (targetSprint - sprintBlend) * Math.min(1.0, dt * 8.0);
        if (sprintBlend > 0.001) {
            const swing = Math.sin(engine.bobTimer);
            const bounce = Math.abs(Math.cos(engine.bobTimer));
            weaponAnimPos.x -= 0.048 * sprintBlend + swing * 0.020 * sprintBlend;
            weaponAnimPos.y -= 0.042 * sprintBlend + bounce * 0.016 * sprintBlend;
            weaponAnimPos.z += 0.030 * sprintBlend;
            weaponAnimRot.x += 0.26 * sprintBlend;
            weaponAnimRot.y += 0.44 * sprintBlend + swing * 0.065 * sprintBlend;
            weaponAnimRot.z -= 0.20 * sprintBlend;
        }

        if (jamClearTimer > 0) {
            jamClearTimer = Math.max(0, jamClearTimer - dt);
            const p = 1.0 - jamClearTimer / 0.65;
            const rack = Math.sin(p * Math.PI);
            weaponAnimRot.z -= rack * 0.34;
            weaponAnimRot.x += rack * 0.12;
            weaponAnimPos.z += rack * 0.034;
            leftHandMode = 'BOLT';
            const pullZ = p > 0.3 && p < 0.75 ? Math.sin(((p - 0.3) / 0.45) * Math.PI) * 0.062 : 0;
            if (wState && wState.boltPivot && wState.boltRestPos) {
                wState.boltPivot.position.z = wState.boltRestPos.z + pullZ;
            }
            leftHandTargetLocal.set(
                sock.boltGrab[0] * rack + sock.handguard[0] * (1 - rack),
                sock.boltGrab[1] * rack + sock.handguard[1] * (1 - rack),
                (sock.boltGrab[2] + pullZ) * rack + sock.handguard[2] * (1 - rack)
            );
            leftKnuckleLocal.set(
                sock.guardDir[0] + (0.65 - sock.guardDir[0]) * rack,
                sock.guardDir[1] + (-0.25 - sock.guardDir[1]) * rack,
                sock.guardDir[2] + (-0.72 - sock.guardDir[2]) * rack
            ).normalize();
            leftPalmLocal.set(
                sock.palmL[0] + (0.35 - sock.palmL[0]) * rack,
                sock.palmL[1] + (-0.75 - sock.palmL[1]) * rack,
                sock.palmL[2] + (0.55 - sock.palmL[2]) * rack
            ).normalize();
            return;
        }

        if (magCheckTimer > 0) {
            magCheckTimer = Math.max(0, magCheckTimer - dt);
            const p = 1.0 - magCheckTimer / 1.05;
            const env = Math.sin(p * Math.PI);
            weaponAnimRot.z += env * 0.40;
            weaponAnimRot.x += env * 0.16;
            weaponAnimPos.y += env * 0.026;
            weaponAnimPos.x -= env * 0.018;

            const pull = p > 0.22 && p < 0.78 ? Math.sin(((p - 0.22) / 0.56) * Math.PI) : 0;
            if (wState && wState.magPivot && wState.magRestPos) {
                wState.magPivot.position.set(
                    wState.magRestPos.x,
                    wState.magRestPos.y - pull * 0.042,
                    wState.magRestPos.z + pull * 0.010
                );
                wState.magPivot.rotation.x = -pull * 0.20;
            }
            leftHandMode = 'MAG';
            leftHandTargetLocal.set(
                sock.magGrab[0] * env + sock.handguard[0] * (1 - env),
                (sock.magGrab[1] - pull * 0.042) * env + sock.handguard[1] * (1 - env),
                (sock.magGrab[2] + pull * 0.010) * env + sock.handguard[2] * (1 - env)
            );
            leftKnuckleLocal.set(
                sock.guardDir[0] + (0.78 - sock.guardDir[0]) * env,
                sock.guardDir[1] + (-0.12 - sock.guardDir[1]) * env,
                sock.guardDir[2] + (-0.61 - sock.guardDir[2]) * env
            ).normalize();
            leftPalmLocal.set(
                sock.palmL[0] + (0.55 - sock.palmL[0]) * env,
                sock.palmL[1] + (0.20 - sock.palmL[1]) * env,
                sock.palmL[2] + (0.80 - sock.palmL[2]) * env
            ).normalize();
            return;
        }

        if (!wState || !wState.reloading) {
            reloadPhase = 0;
            reloadTimer = 0;
            boltClicked = false;
            magUnseated = false;
            return;
        }

        if (reloadPhase === 0) {
            reloadPhase = wState.reloadState === 'DRY_RELOAD' ? 2 : 1;
            reloadTotal = Math.max(0.1, wState.reloadTotal);
            reloadTimer = 0;
            boltClicked = false;
            magUnseated = false;
        }

        reloadTimer += dt;
        const p = Math.min(1, reloadTimer / reloadTotal);

        if (key === 'rpg7') {
            const env = Math.sin(p * Math.PI);
            weaponAnimRot.x -= env * 0.22;
            weaponAnimRot.z += env * 0.18;
            weaponAnimPos.y -= env * 0.038;
            leftHandMode = 'MAG';
            if (p < 0.25) {
                const k = p / 0.25;
                leftHandTargetLocal.set(
                    sock.handguard[0] - 0.04 * k,
                    sock.handguard[1] - 0.14 * k,
                    sock.handguard[2] - 0.08 * k
                );
            } else if (p < 0.82) {
                const k = (p - 0.25) / 0.57;
                const ease = k * k * (3 - 2 * k);
                const warheadZ = -0.52 + ease * 0.20;
                if (propWarheadMesh) {
                    propWarheadMesh.visible = true;
                    propWarheadMesh.position.set(0.112, 0.105, warheadZ);
                }
                leftHandTargetLocal.set(0.112, 0.082, warheadZ + 0.05);
                leftKnuckleLocal.set(0.68, -0.10, -0.72).normalize();
                leftPalmLocal.set(0.45, 0.82, 0.35).normalize();
                if (k > 0.78 && !boltClicked) {
                    boltClicked = true;
                    engine.sound?.playReloadClick?.(620);
                    engine.posSpring?.applyImpulse?.(0, -0.35, 0.55);
                }
            } else {
                const k = (p - 0.82) / 0.18;
                const ease = k * k * (3 - 2 * k);
                leftHandTargetLocal.set(
                    0.112,
                    0.082 * (1 - ease) + sock.handguard[1] * ease,
                    -0.28 * (1 - ease) + sock.handguard[2] * ease
                );
            }
            return;
        }

        const magSwapEnd = reloadPhase === 2 ? 0.66 : 1.0;

        if (p < magSwapEnd) {
            const sub = p / magSwapEnd;
            const env = Math.sin(sub * Math.PI);
            weaponAnimRot.z -= env * 0.28;
            weaponAnimRot.x += env * 0.20;
            weaponAnimRot.y += env * 0.12;
            weaponAnimPos.y += env * 0.042;
            weaponAnimPos.x -= env * 0.022;
            weaponAnimPos.z -= env * 0.015;

            leftHandMode = 'MAG';
            let magDropY = 0;
            let magShiftZ = 0;
            let magTiltX = 0;
            let handBlend = 1.0;

            if (sub < 0.20) {
                const k = sub / 0.20;
                handBlend = k * k * (3 - 2 * k);
            } else if (sub < 0.50) {
                const k = (sub - 0.20) / 0.30;
                const ease = Math.sin(k * Math.PI * 0.5);
                magDropY = -0.115 * ease;
                magShiftZ = -0.028 * Math.sin(k * Math.PI);
                magTiltX = 0.32 * ease;
                if (k > 0.15 && !magUnseated) {
                    magUnseated = true;
                    engine.sound?.playReloadClick?.(510);
                    engine.posSpring?.applyImpulse?.(0.15, -0.55, 0.25);
                }
            } else if (sub < 0.82) {
                const k = (sub - 0.50) / 0.32;
                const rem = 1.0 - k * k * (3 - 2 * k);
                magDropY = -0.115 * rem;
                magShiftZ = -0.024 * Math.sin(rem * Math.PI);
                magTiltX = 0.28 * rem;
                if (k > 0.78 && !boltClicked && reloadPhase === 1) {
                    boltClicked = true;
                    engine.sound?.playReloadClick?.(640);
                    engine.posSpring?.applyImpulse?.(-0.15, 0.65, -0.30);
                }
            } else {
                const k = (sub - 0.82) / 0.18;
                handBlend = 1.0 - k * k * (3 - 2 * k);
            }

            if (wState.magPivot && wState.magRestPos) {
                wState.magPivot.position.set(
                    wState.magRestPos.x,
                    wState.magRestPos.y + magDropY,
                    wState.magRestPos.z + magShiftZ
                );
                wState.magPivot.rotation.set(magTiltX, 0, 0);
            }

            const magTargetX = sock.magGrab[0];
            const magTargetY = sock.magGrab[1] + magDropY;
            const magTargetZ = sock.magGrab[2] + magShiftZ;

            leftHandTargetLocal.set(
                sock.handguard[0] + (magTargetX - sock.handguard[0]) * handBlend,
                sock.handguard[1] + (magTargetY - sock.handguard[1]) * handBlend,
                sock.handguard[2] + (magTargetZ - sock.handguard[2]) * handBlend
            );
            leftKnuckleLocal.set(
                sock.guardDir[0] + (0.42 - sock.guardDir[0]) * handBlend,
                sock.guardDir[1] + (-0.06 - sock.guardDir[1]) * handBlend,
                sock.guardDir[2] + (-0.90 - sock.guardDir[2]) * handBlend
            ).normalize();
            leftPalmLocal.set(
                sock.palmL[0] + (0.86 - sock.palmL[0]) * handBlend,
                sock.palmL[1] + (0.36 - sock.palmL[1]) * handBlend,
                sock.palmL[2] + (0.35 - sock.palmL[2]) * handBlend
            ).normalize();
        } else {
            const boltP = (p - magSwapEnd) / (1.0 - magSwapEnd);
            const env = Math.sin(boltP * Math.PI);
            weaponAnimRot.z += env * 0.34;
            weaponAnimRot.x += env * 0.10;
            weaponAnimPos.z += env * 0.022;
            weaponAnimPos.y -= env * 0.015;
            weaponAnimPos.x -= env * 0.020;

            leftHandMode = 'BOLT';
            const pull = boltP > 0.20 && boltP < 0.78 ? Math.sin(((boltP - 0.20) / 0.58) * Math.PI) : 0;
            const pullZ = pull * 0.062;

            if (wState.boltPivot && wState.boltRestPos) {
                wState.boltPivot.position.z = wState.boltRestPos.z + pullZ;
            }
            if (boltP > 0.52 && !boltClicked) {
                boltClicked = true;
                engine.sound?.playReloadClick?.(710);
                engine.posSpring?.applyImpulse?.(0.18, -0.45, 0.75);
                engine.rotSpring?.applyImpulse?.(0.9, -0.3, -0.8);
            }

            leftHandTargetLocal.set(
                sock.handguard[0] + ((sock.boltGrab[0] + 0.008) - sock.handguard[0]) * env,
                sock.handguard[1] + ((sock.boltGrab[1] - 0.016) - sock.handguard[1]) * env,
                sock.handguard[2] + ((sock.boltGrab[2] + pullZ) - sock.handguard[2]) * env
            );
            leftKnuckleLocal.set(
                sock.guardDir[0] + (0.40 - sock.guardDir[0]) * env,
                sock.guardDir[1] + (0.14 - sock.guardDir[1]) * env,
                sock.guardDir[2] + (-0.90 - sock.guardDir[2]) * env
            ).normalize();
            leftPalmLocal.set(
                sock.palmL[0] + (-0.25 - sock.palmL[0]) * env,
                sock.palmL[1] + (0.92 - sock.palmL[1]) * env,
                sock.palmL[2] + (0.28 - sock.palmL[2]) * env
            ).normalize();
        }
    }

    function updateWeaponSwitch(dt) {
        if (switchPhase === 0) return;
        switchTimer += dt;
        const total = 0.42;
        const progress = Math.min(1, switchTimer / total);

        if (progress < 0.5) {
            const down = Math.sin(progress * Math.PI);
            weaponAnimPos.y -= down * 0.18;
            weaponAnimRot.x -= down * 0.34;
            weaponAnimRot.z += down * 0.18;
        } else {
            const up = Math.sin((progress - 0.5) * Math.PI);
            weaponAnimPos.y -= (1 - up) * 0.12;
            weaponAnimRot.x -= (1 - up) * 0.18;
        }

        if (progress >= 1.0) {
            switchPhase = 0;
            switchTimer = 0;
        }
    }

    function updateIK() {
        if (!armsReady) initArms();
        if (!armsReady || !rig) return;

        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const wState = engine.weaponStates[key];
        if (!wState || !wState.meshGroup) return;

        const sock = WEAPON_SOCKETS[key] || WEAPON_SOCKETS.ak12;
        const s = aimBlend * aimBlend * (3.0 - 2.0 * aimBlend);
        const isRpg = key === 'rpg7';

        // Shoulders sit naturally BEHIND & BELOW camera eye line, leaning slightly forward in ADS
        const shoulderX = isRpg ? (0.045 * (1 - s) + 0.025 * s) : (0.008 * (1 - s));
        const shoulderY = -0.228 * (1 - s) - 0.198 * s;
        const shoulderZ = 0.055 * (1 - s) - 0.035 * s;
        rig.root.position.set(shoulderX, shoulderY, shoulderZ);
        rig.root.rotation.set(0, -0.06 * (1 - s), 0);

        // Reset arms to clean forward-pointing neutral before solving analytical IK
        rig.right.upper.rotation.set(-Math.PI * 0.5, 0, 0);
        rig.right.lower.rotation.set(0, 0, 0);
        rig.right.foreTwist.rotation.set(0, 0, 0);
        rig.right.hand.rotation.set(0, 0, 0);

        rig.left.upper.rotation.set(-Math.PI * 0.5, 0, 0);
        rig.left.lower.rotation.set(0, 0, 0);
        rig.left.foreTwist.rotation.set(0, 0, 0);
        rig.left.hand.rotation.set(0, 0, 0);

        rig.root.updateWorldMatrix(true, true);
        wState.meshGroup.updateWorldMatrix(true, false);

        // --- RIGHT ARM (Pistol Grip + Live Trigger Finger) ---
        _gripWorld.set(
            sock.grip[0],
            sock.grip[1] - recoilWristPitch * 0.010,
            sock.grip[2] + recoilElbowKick * 0.014
        ).applyMatrix4(wState.meshGroup.matrixWorld);

        _knuckleDirR.set(
            sock.gripDir[0],
            sock.gripDir[1] + recoilWristPitch * 0.12,
            sock.gripDir[2]
        ).transformDirection(wState.meshGroup.matrixWorld).normalize();

        _palmWorldR.set(sock.palmR[0], sock.palmR[1], sock.palmR[2])
            .transformDirection(wState.meshGroup.matrixWorld).normalize();

        _wristTgt.copy(_gripWorld)
            .addScaledVector(_knuckleDirR, -(sock.wristBackR || 0.042))
            .addScaledVector(_palmWorldR, -(sock.wristOutR || 0.022));

        _poleR.set(0.56, -0.78 - recoilElbowKick * 0.12, 0.14)
            .applyQuaternion(engine.camera.quaternion);
        solveTwoBoneIK(rig.right.upper, rig.right.lower, rig.right.hand, _wristTgt, _poleR);
        orientHandAndDistributeTwist(rig.right, _knuckleDirR, _palmWorldR);
        poseTacticalFingers(rig.right, 'GRIP', Math.min(1, triggerSqueeze));

        // --- LEFT ARM (C-Clamp Handguard / RPG Grip / Mag / Bolt) ---
        _guardWorld.copy(leftHandTargetLocal)
            .applyMatrix4(wState.meshGroup.matrixWorld);

        _knuckleDirL.copy(leftKnuckleLocal)
            .transformDirection(wState.meshGroup.matrixWorld).normalize();

        _palmWorldL.copy(leftPalmLocal)
            .transformDirection(wState.meshGroup.matrixWorld).normalize();

        _wristTgt.copy(_guardWorld)
            .addScaledVector(_knuckleDirL, -(sock.wristBackL || 0.042))
            .addScaledVector(_palmWorldL, -(sock.wristOutL || 0.022));

        const isCClamp = leftHandMode === 'CCLAMP';
        _poleL.set(isCClamp ? -0.58 : -0.44, isCClamp ? -0.72 : -0.82, 0.10)
            .applyQuaternion(engine.camera.quaternion);
        solveTwoBoneIK(rig.left.upper, rig.left.lower, rig.left.hand, _wristTgt, _poleL);
        orientHandAndDistributeTwist(rig.left, _knuckleDirL, _palmWorldL);
        poseTacticalFingers(rig.left, leftHandMode, 0);
    }

    function updateAimFov(dt) {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const targetBlend = (engine.isAiming && !engine.weaponStates[key]?.reloading && switchPhase === 0 && tuckBlend < 0.35) ? 1.0 : 0.0;
        aimBlend += (targetBlend - aimBlend) * Math.min(1.0, dt * 9.5);
        const smoothAim = aimBlend * aimBlend * (3.0 - 2.0 * aimBlend);

        const fovMult = SIGHT_FOV_MULT[key] || 0.86;
        const targetFov = engine.baseFov * (1.0 + (fovMult - 1.0) * smoothAim) + lastCameraPunch.fovKick;
        if (Math.abs(engine.camera.fov - targetFov) > 0.01) {
            engine.camera.fov = targetFov;
            engine.camera.updateProjectionMatrix();
        }
    }

    function onPlayerShot(weaponKey) {
        const modVal = typeof engine.modifier === 'function' ? engine.modifier('recoil') : 1.0;
        const res = applyWeaponShotRecoil(recoilState, weaponKey, {
            isAiming: engine.isAiming,
            isCrouching: engine.isCrouching,
            modifier: modVal
        });

        engine.posSpring?.applyImpulse?.(res.posImpulse.x, res.posImpulse.y, res.posImpulse.z);
        engine.rotSpring?.applyImpulse?.(res.rotImpulse.x, res.rotImpulse.y, res.rotImpulse.z);

        engine.pitch = Math.min(1.35, engine.pitch + res.cameraPitchStep);
        engine.yaw += res.cameraYawStep;

        recoilElbowKick = Math.min(1.0, recoilElbowKick + res.elbowKick);
        recoilWristPitch = Math.min(1.0, recoilWristPitch + res.wristPitch);
        triggerSqueeze = 1.0;
        boltBlowback = 1.0;
        fpFlashTimer = weaponKey === 'rpg7' ? 0.075 : 0.044;
        barrelHeat = Math.min(1.0, barrelHeat + (weaponKey === 'rpg7' ? 0.45 : 0.09));
        engine.postfx?.triggerFlash?.(weaponKey === 'rpg7' ? 0.32 : 0.11);

        const baked = fpBaked.get(weaponKey);
        if (baked) {
            const fk = engine.isAiming ? 'ads_fire' : 'fire';
            const st = baked.states[fk] || baked.states.fire;
            if (st) {
                st.action.reset();
                st.action.play();
                fpFireT = st.clip.duration || 0.36;
            }
        }
        return res;
    }

    function updateBakedFp(dt, key) {
        const baked = fpBaked.get(key);
        const wState = engine.weaponStates[key];
        for (const [k, b] of fpBaked) {
            b.pivot.visible = (k === key);
            if (k !== key) b.muzzleRig.visible = false;
        }
        if (rig?.root) rig.root.visible = false;
        if (wState?.meshGroup) wState.meshGroup.visible = false;
        if (baked.warheadNode) {
            baked.warheadNode.visible = Boolean((wState?.mag || 0) > 0 || wState?.reloading);
        }

        fpFireT = Math.max(0, fpFireT - dt);
        fpEquipT = Math.max(0, fpEquipT - dt);
        fpInspectT = Math.max(0, fpInspectT - dt);

        const isReloading = Boolean(wState?.reloading);
        if (isReloading && !fpPrevReloading && baked.states.reload) {
            baked.states.reload.action.reset();
            baked.states.reload.action.play();
        }
        fpPrevReloading = isReloading;

        const horizSpeed = Math.hypot(engine.playerVelocity.x, engine.playerVelocity.z);
        const moving = horizSpeed > 0.7 && engine.playerOnFloor;
        const sprinting = Boolean(engine.isSprinting && moving && !engine.isAiming);
        const aiming = Boolean(engine.isAiming && !isReloading && fpEquipT <= 0 && tuckBlend < 0.35);

        let target = 'idle';
        if (isReloading) {
            target = 'reload';
        } else if (fpEquipT > 0 && baked.states.equip) {
            target = 'equip';
        } else if (fpInspectT > 0 && baked.states.inspect) {
            target = 'inspect';
        } else if (fpFireT > 0) {
            target = aiming && baked.states.ads_fire ? 'ads_fire' : 'fire';
        } else if (aiming) {
            target = moving && baked.states.ads_walk ? 'ads_walk' : 'ads_idle';
        } else if (sprinting && baked.states.sprint) {
            target = 'sprint';
        } else if (moving && baked.states.walk) {
            target = 'walk';
        }

        const rate = (target === 'fire' || target === 'ads_fire') ? 28 : (aiming ? 12 : 9);
        let sum = 0;
        const step = Math.min(1, rate * dt);
        for (const k in baked.states) {
            const st = baked.states[k];
            const goal = k === target ? 1 : 0;
            st.w += (goal - st.w) * step;
            sum += st.w;
        }
        if (sum > 0) {
            for (const k in baked.states) baked.states[k].w /= sum;
        }

        for (const k in baked.states) {
            const st = baked.states[k];
            st.action.setEffectiveWeight(st.w);
            if (k === 'reload' && isReloading && wState.reloadTotal > 0) {
                const prog = Math.max(0, Math.min(1, 1 - wState.reloadTimer / wState.reloadTotal));
                st.action.time = prog * st.clip.duration;
                st.action.setEffectiveTimeScale(0);
            } else if (k === 'walk' || k === 'ads_walk') {
                st.action.setEffectiveTimeScale(Math.max(0.6, Math.min(1.6, horizSpeed / 9.5)));
            } else if (k === 'sprint') {
                st.action.setEffectiveTimeScale(Math.max(0.8, Math.min(1.5, horizSpeed / 16.0)));
            } else {
                st.action.setEffectiveTimeScale(1);
            }
        }

        baked.mixer.update(dt);

        // Layer subtle bodycam free-aim deadzone and wall-tuck onto pivot (attenuated in ADS so sights stay centered)
        const hipScale = 1.0 - aimBlend * 0.88;
        const springP = engine.posSpring?.position;
        const springR = engine.rotSpring?.position;
        baked.pivot.position.set(
            -deadzoneState.yaw * 0.12 * hipScale + (springP ? springP.x * 0.015 * hipScale : 0),
            deadzoneState.pitch * 0.09 * hipScale + (springP ? springP.y * 0.015 * hipScale : 0) - tuckBlend * 0.08,
            tuckBlend * 0.14
        );
        baked.pivot.rotation.set(
            deadzoneState.pitch * 0.65 * hipScale + (springR ? springR.x * 0.025 * hipScale : 0) - tuckBlend * 0.35,
            deadzoneState.yaw * 0.65 * hipScale + (springR ? springR.y * 0.02 * hipScale : 0) + tuckBlend * 0.45,
            -deadzoneState.yaw * 0.35 * hipScale + (springR ? springR.z * 0.025 * hipScale : 0)
        );
        baked.pivot.updateMatrixWorld(true);

        if (fpFlashTimer > 0 && baked.gunBone) {
            getMuzzleWorld(_muzzleTmp);
            engine.camera.worldToLocal(_muzzleTmp);
            baked.muzzleRig.position.copy(_muzzleTmp);
            baked.muzzleRig.rotation.z = Math.random() * Math.PI * 2;
            const sc = 0.82 + Math.random() * 0.42;
            baked.muzzleRig.scale.set(sc, sc, sc * (0.85 + Math.random() * 0.35));
            baked.muzzleRig.visible = true;
        } else {
            baked.muzzleRig.visible = false;
        }
    }

    function applyExplosionTrauma(amount) {
        const clamped = Math.max(0, Math.min(1, amount));
        recoilState.trauma = Math.min(1.0, recoilState.trauma + clamped);
        recoilState.camPitchVel += (Math.random() - 0.3) * clamped * 2.2;
        recoilState.camRollVel += (Math.random() - 0.5) * clamped * 3.8;
        recoilState.fovKick = Math.min(4.8, recoilState.fovKick + clamped * 3.2);
        engine.posSpring?.applyImpulse?.((Math.random() - 0.5) * clamped * 1.4, -clamped * 1.1, clamped * 1.6);
        engine.rotSpring?.applyImpulse?.(clamped * 2.4, (Math.random() - 0.5) * clamped * 1.8, (Math.random() - 0.5) * clamped * 3.2);
        engine.postfx?.triggerFlash?.(clamped * 0.45);
    }

    const mod = {
        name: 'arms',

        install() {
            engine.events.on('game:started', () => {
                initArms();
            });

            engine.events.on('explosion', (ev) => {
                if (!ev || !ev.pos || !engine.isStarted) return;
                engine.camera.getWorldPosition(_v1);
                const dist = _v1.distanceTo(ev.pos);
                const maxRange = Math.max(22, (ev.radius || 8) * 3.2);
                if (dist < maxRange) {
                    const falloff = Math.pow(1 - dist / maxRange, 1.6);
                    applyExplosionTrauma(falloff * 0.9);
                }
            });
        },

        onStart() {
            initArms();
        },

        update(dt) {
            if (!armsReady) initArms();
            if (engine.fpvMode && engine.fpvMode.active) {
                if (rig?.root) rig.root.visible = false;
                for (const b of fpBaked.values()) { b.pivot.visible = false; b.muzzleRig.visible = false; }
                return;
            }
            if (engine.playerVehicleState && engine.playerVehicleState.vehicle && engine.playerVehicleState.role === 'DRIVER') {
                if (rig?.root) rig.root.visible = false;
                for (const b of fpBaked.values()) { b.pivot.visible = false; b.muzzleRig.visible = false; }
                return;
            }

            updateWallTuck(dt);
            updateDeadzoneAndRecoil(dt);

            const activeKey = engine.loadoutKeys[engine.currentWeaponIdx];
            if (fpBaked.has(activeKey)) {
                updateBakedFp(dt, activeKey);
                updateAimFov(dt);
                return;
            }

            for (const b of fpBaked.values()) { b.pivot.visible = false; b.muzzleRig.visible = false; }
            if (rig?.root) rig.root.visible = true;
            const activeWState = engine.weaponStates[activeKey];
            if (activeWState?.meshGroup) activeWState.meshGroup.visible = true;

            updateReloadAndHandling(dt);
            updateWeaponSwitch(dt);

            const hipScale = 1.0 - aimBlend * 0.72;
            engine.viewmodelRoot.position.add(weaponAnimPos);
            engine.viewmodelRoot.position.x -= deadzoneState.yaw * 0.24 * hipScale;
            engine.viewmodelRoot.position.y += deadzoneState.pitch * 0.18 * hipScale;
            engine.viewmodelRoot.rotation.x += weaponAnimRot.x + deadzoneState.pitch;
            engine.viewmodelRoot.rotation.y += weaponAnimRot.y + deadzoneState.yaw;
            engine.viewmodelRoot.rotation.z += weaponAnimRot.z - deadzoneState.yaw * 0.55 * hipScale;
            engine.viewmodelRoot.updateMatrixWorld(true);

            updateIK();
            updateAimFov(dt);
        },

        getAimRay(outOrigin, outDir) {
            engine.camera.getWorldPosition(outOrigin);
            outDir.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
            const pitchOff = deadzoneState.pitch + engine.rotSpring.position.x * 0.42;
            const yawOff = deadzoneState.yaw + engine.rotSpring.position.y * 0.42;
            if (Math.abs(yawOff) > 1e-4 || Math.abs(pitchOff) > 1e-4) {
                _eul.set(pitchOff, yawOff, 0, 'YXZ');
                _q2.setFromEuler(_eul);
                outDir.applyQuaternion(_q2);
            }
            outDir.normalize();
        },

        applyMouseDeadzone(dx, dy) {
            const sens = (engine.isAiming ? 0.0013 * engine.settings.get('adsSensitivity') : 0.0021) * engine.settings.get('mouseSensitivity');
            return stepFreeAimDeadzone(deadzoneState, -dx * sens, -dy * sens, engine.isAiming);
        },

        onPlayerShot,
        applyExplosionTrauma,
        getMuzzleWorld,
        getEjectionPortWorld,
        getCameraPunch() {
            return lastCameraPunch;
        },

        triggerSwitch() {
            switchPhase = 1;
            switchTimer = 0;
            const key = engine.loadoutKeys[engine.currentWeaponIdx];
            const baked = fpBaked.get(key);
            if (baked && baked.states.equip) {
                baked.states.equip.action.reset();
                baked.states.equip.action.play();
                fpEquipT = baked.states.equip.clip.duration || 0.76;
            }
        },

        triggerMagCheck() {
            magCheckTimer = 1.05;
            const key = engine.loadoutKeys[engine.currentWeaponIdx];
            const baked = fpBaked.get(key);
            if (baked && baked.states.inspect) {
                baked.states.inspect.action.reset();
                baked.states.inspect.action.play();
                fpInspectT = baked.states.inspect.clip.duration || 2.7;
            }
        },

        triggerJamClear() {
            jamClearTimer = 0.65;
        },

        get deadzoneYaw() { return deadzoneState.yaw; },
        get deadzonePitch() { return deadzoneState.pitch; },
        get aimBlend() { return aimBlend; },
        get tuckBlend() { return tuckBlend; }
    };

    return mod;
}
