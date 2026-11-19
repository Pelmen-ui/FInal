import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    quatFromAxisAngle,
    quatRotateVec,
    buildAnatomicalBasis,
    decomposeSwingTwist,
    clampHingeQuaternion,
    clampConeTwistQuaternion,
    computeRagdollDamping,
    computeExplosionProfile,
    computeDeathKinematics
} from '../src/physics/ragdoll_math.js';
import {
    BODYCAM_DEADZONE,
    stepFreeAimDeadzone,
    decayFreeAimDeadzone,
    createRecoilState,
    applyWeaponShotRecoil,
    stepRecoilState,
    computeWallTuck,
    sampleBodycamBreath
} from '../src/player/bodycam_math.js';

function twistAngleAround(q, ax, ay, az) {
    const sw = { x: 0, y: 0, z: 0, w: 1 };
    const tw = { x: 0, y: 0, z: 0, w: 1 };
    decomposeSwingTwist(q.x, q.y, q.z, q.w, ax, ay, az, sw, tw);
    const s = Math.hypot(tw.x, tw.y, tw.z);
    let ang = 2 * Math.atan2(s, tw.w);
    if (tw.x * ax + tw.y * ay + tw.z * az < 0) ang = -ang;
    return ang;
}

test('ragdoll knee hinge never hyperextends (< 0) and clamps flexion <= 2.35 rad', () => {
    const hyper = quatFromAxisAngle(1, 0, 0, -1.2, { x: 0, y: 0, z: 0, w: 1 });
    const out = { x: 0, y: 0, z: 0, w: 1 };
    assert.equal(clampHingeQuaternion(hyper.x, hyper.y, hyper.z, hyper.w, 0.0, 2.35, out), true);
    const t1 = twistAngleAround(out, 1, 0, 0);
    assert.ok(t1 >= -1e-4 && t1 <= 2.35 + 1e-4);

    const overFlex = quatFromAxisAngle(1, 0, 0, 3.0, { x: 0, y: 0, z: 0, w: 1 });
    assert.equal(clampHingeQuaternion(overFlex.x, overFlex.y, overFlex.z, overFlex.w, 0.0, 2.35, out), true);
    const t2 = twistAngleAround(out, 1, 0, 0);
    assert.ok(Math.abs(t2 - 2.35) < 0.02);
});

test('ragdoll elbow hinge stays strictly within [-2.45, 0]', () => {
    const hyper = quatFromAxisAngle(1, 0, 0, 0.9, { x: 0, y: 0, z: 0, w: 1 });
    const out = { x: 0, y: 0, z: 0, w: 1 };
    assert.equal(clampHingeQuaternion(hyper.x, hyper.y, hyper.z, hyper.w, -2.45, 0.0, out), true);
    const t = twistAngleAround(out, 1, 0, 0);
    assert.ok(t <= 1e-4 && t >= -2.45 - 1e-4);
});

test('ragdoll cone-twist clamps excessive shoulder twist and swing', () => {
    const extremeSwing = quatFromAxisAngle(1, 0, 0, 2.4, { x: 0, y: 0, z: 0, w: 1 });
    const out = { x: 0, y: 0, z: 0, w: 1 };
    assert.equal(clampConeTwistQuaternion(extremeSwing.x, extremeSwing.y, extremeSwing.z, extremeSwing.w, -0.7, 0.9, 0.8, 0.55, out), true);
    const yAxis = quatRotateVec(out.x, out.y, out.z, out.w, 0, 1, 0, { x: 0, y: 0, z: 0 });
    const angle = Math.acos(Math.max(-1, Math.min(1, yAxis.y)));
    assert.ok(angle <= 0.95);

    const extremeTwist = quatFromAxisAngle(0, 1, 0, 2.6, { x: 0, y: 0, z: 0, w: 1 });
    assert.equal(clampConeTwistQuaternion(extremeTwist.x, extremeTwist.y, extremeTwist.z, extremeTwist.w, -0.7, 0.9, 0.8, 0.5, out), true);
    const tw = twistAngleAround(out, 0, 1, 0);
    assert.ok(Math.abs(tw) <= 0.52);
});

test('buildAnatomicalBasis produces orthonormal right-handed quaternion', () => {
    const q = buildAnatomicalBasis(0.1, 0.95, 0.25, 0.2, 0.0, 0.98, { x: 0, y: 0, z: 0, w: 1 });
    const x = quatRotateVec(q.x, q.y, q.z, q.w, 1, 0, 0, { x: 0, y: 0, z: 0 });
    const y = quatRotateVec(q.x, q.y, q.z, q.w, 0, 1, 0, { x: 0, y: 0, z: 0 });
    const z = quatRotateVec(q.x, q.y, q.z, q.w, 0, 0, 1, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(x.x * y.x + x.y * y.y + x.z * y.z) < 1e-4);
    assert.ok(Math.abs(y.x * z.x + y.y * z.y + y.z * z.z) < 1e-4);
    assert.ok(Math.abs(Math.hypot(y.x, y.y, y.z) - 1) < 1e-4);
});

test('computeRagdollDamping escalates ground-contact angular damping and spin bleed to arrest rolling', () => {
    const air = computeRagdollDamping(1.2, 5.0, 3.0, 0.4, 0.8, 2.2);
    const ground = computeRagdollDamping(0.16, 0.3, 0.8, 1.6, 0.8, 2.2);
    assert.ok(ground.angDamp > air.angDamp * 2.5);
    assert.ok(ground.linDamp > air.linDamp * 2.0);
    assert.ok(ground.rollBleed > 0.35 && air.rollBleed === 0);
});

test('bodycam free-aim deadzone clamps within bounds and transfers overflow to body turn', () => {
    const state = { yaw: 0, pitch: 0 };
    const res = stepFreeAimDeadzone(state, 0.5, -0.4, false);
    assert.ok(Math.abs(state.yaw) <= BODYCAM_DEADZONE.hipYaw + 1e-6);
    assert.ok(Math.abs(state.pitch) <= BODYCAM_DEADZONE.hipPitch + 1e-6);
    assert.ok(res.bodyYaw > 0.35);

    const prevYaw = state.yaw;
    decayFreeAimDeadzone(state, 0.25, false, true);
    assert.ok(Math.abs(state.yaw) < Math.abs(prevYaw));
});

test('bodycam recoil accumulates burst climb, reduces under ADS/crouch, and recovers pitch after release', () => {
    const recHip = createRecoilState();
    const s1 = applyWeaponShotRecoil(recHip, 'ak12', { isAiming: false, isCrouching: false, rand1: 0, rand2: 0, rand3: 0 });
    const s2 = applyWeaponShotRecoil(recHip, 'ak12', { isAiming: false, isCrouching: false, rand1: 0, rand2: 0, rand3: 0 });
    assert.ok(recHip.burstCount === 2);
    assert.ok(recHip.climbMult > 1.0);
    assert.ok(s1.cameraPitchStep > 0 && s2.cameraPitchStep > 0);

    const recAds = createRecoilState();
    const sAds = applyWeaponShotRecoil(recAds, 'ak12', { isAiming: true, isCrouching: true, rand1: 0, rand2: 0, rand3: 0 });
    assert.ok(sAds.cameraPitchStep < s1.cameraPitchStep);

    let totalReturn = 0;
    for (let i = 0; i < 30; i++) {
        const step = stepRecoilState(recHip, 1 / 60, 'ak12');
        totalReturn += step.pitchReturnDelta;
    }
    assert.ok(totalReturn < -0.005);
});

test('wall-tuck and breath sway stay bounded', () => {
    assert.equal(computeWallTuck(2.0), 0);
    assert.equal(computeWallTuck(0.15), 1);
    const mid = computeWallTuck(0.56);
    assert.ok(mid > 0.4 && mid < 0.6);

    const hipBreath = sampleBodycamBreath(1.3, 0.5, 0, 0);
    const adsBreath = sampleBodycamBreath(1.3, 0.5, 1, 1);
    assert.ok(Math.abs(adsBreath.y) < Math.abs(hipBreath.y));
});

test('explosion profiles keep RPG full-strength while scaling FPV and generic blasts weaker', () => {
    const rpg = computeExplosionProfile('pg7', 11.5);
    const fpv = computeExplosionProfile('fpv', 6.2);
    const he = computeExplosionProfile('he', 8.0);
    assert.equal(rpg.visualScale, 1.0);
    assert.ok(fpv.visualScale < 0.65 && fpv.scale < rpg.scale * 0.45);
    assert.ok(fpv.lightScale < rpg.lightScale && fpv.shakeScale < rpg.shakeScale);
    assert.ok(he.visualScale < rpg.visualScale && he.visualScale > fpv.visualScale);
});

test('hit-zone death kinematics differentiate head, leg, arm, torso, and blast reactions', () => {
    const head = computeDeathKinematics(2, 0, 2, 30, 'head', 0.6, 0.4);
    assert.equal(head.mode, 'head');
    assert.ok(head.head[1] > 1.5 && head.pelvis[1] < -4.0);

    const leg = computeDeathKinematics(7, 0, 1, 28, 'leg', 0.5, 0.5);
    assert.equal(leg.mode, 'leg');
    assert.ok(leg.target[1] > 2.0 && leg.pelvis[1] < -6.0);

    const torso = computeDeathKinematics(1, 0, 1, 32, 'torso', 0.8, 0.7);
    assert.equal(torso.mode, 'torso');
    assert.ok(Math.abs(torso.torsoTorque[1]) > 2.5 && torso.armWhip.length === 3);

    const rpgBlast = computeDeathKinematics(1, 0, 35, 130, 'blast', 0.4, 0.6);
    const fpvBlast = computeDeathKinematics(1, 0, 15, 55, 'blast', 0.4, 0.6);
    assert.equal(rpgBlast.mode, 'blast');
    assert.equal(fpvBlast.mode, 'blast');
    assert.ok(rpgBlast.maxLift > fpvBlast.maxLift);
});

test('procedural tactical arms rig builds complete 5-finger articulated hands and dual-twist forearms', async () => {
    const THREE = await import('three');
    const { createProceduralTacticalArms, poseTacticalFingers } = await import('../src/player/fp_arm_rig.js');
    const { solveTwoBoneIK, computeHandBasis } = await import('../src/player/arms.js');

    const rig = createProceduralTacticalArms('RU');
    assert.ok(rig.root && rig.right && rig.left);
    assert.ok(rig.right.foreTwist && rig.left.foreTwist);
    assert.ok(rig.right.fingers.index && rig.right.fingers.thumb);
    assert.ok(rig.left.fingers.pinky && rig.left.fingers.thumbRoot);

    // Trigger squeeze visibly curls right index finger deeper than idle
    poseTacticalFingers(rig.right, 'GRIP', 0.0);
    const idleIdx = rig.right.fingers.index.j2.rotation.x;
    poseTacticalFingers(rig.right, 'GRIP', 1.0);
    const pulledIdx = rig.right.fingers.index.j2.rotation.x;
    assert.ok(pulledIdx > idleIdx + 0.3);

    // Two-bone IK places wrist accurately onto reachable target with zero NaN
    rig.root.position.set(0, -0.225, 0.055);
    rig.right.upper.rotation.set(-Math.PI * 0.5, 0, 0);
    rig.root.updateMatrixWorld(true);
    const target = new THREE.Vector3(0.08, -0.10, -0.22);
    const pole = new THREE.Vector3(0.55, -0.78, 0.14);
    const overflow = solveTwoBoneIK(rig.right.upper, rig.right.lower, rig.right.hand, target, pole);
    assert.equal(overflow, 0);
    const wristPos = new THREE.Vector3().setFromMatrixPosition(rig.right.hand.matrixWorld);
    assert.ok(wristPos.distanceTo(target) < 0.015);

    // Hand basis aligns +Y to knuckleDir and +Z into palmNormal half-space
    const q = new THREE.Quaternion();
    const kn = new THREE.Vector3(0.58, 0.14, -0.80).normalize();
    const pm = new THREE.Vector3(0.54, 0.78, 0.31).normalize();
    computeHandBasis(kn, pm, q);
    const yOut = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const zOut = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    assert.ok(yOut.dot(kn) > 0.999);
    assert.ok(zOut.dot(pm) > 0.7);
});


