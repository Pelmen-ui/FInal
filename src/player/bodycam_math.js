export const BODYCAM_DEADZONE = Object.freeze({
    hipYaw: 0.095,
    hipPitch: 0.068,
    adsYaw: 0.022,
    adsPitch: 0.016,
    hipDirectRatio: 0.32,
    adsDirectRatio: 0.82
});

const WEAPON_RECOIL_PROFILES = Object.freeze({
    ak12: {
        pitchKick: 0.021,
        yawKick: 0.0085,
        rollKick: 0.028,
        camPitchVel: 0.92,
        camYawVel: 0.34,
        camRollVel: 1.45,
        posX: 0.09,
        posY: 0.14,
        posZ: 0.72,
        rotX: 1.55,
        rotY: 0.58,
        rotZ: 1.15,
        fovKick: 0.55,
        trauma: 0.14,
        elbowKick: 0.42,
        wristPitch: 0.48,
        climbPerShot: 0.14,
        maxClimb: 0.85,
        returnRatio: 0.68,
        returnSpeed: 4.8
    },
    ak74m: {
        pitchKick: 0.023,
        yawKick: 0.0095,
        rollKick: 0.032,
        camPitchVel: 1.02,
        camYawVel: 0.38,
        camRollVel: 1.58,
        posX: 0.10,
        posY: 0.15,
        posZ: 0.78,
        rotX: 1.68,
        rotY: 0.64,
        rotZ: 1.24,
        fovKick: 0.60,
        trauma: 0.16,
        elbowKick: 0.46,
        wristPitch: 0.52,
        climbPerShot: 0.15,
        maxClimb: 0.92,
        returnRatio: 0.64,
        returnSpeed: 4.5
    },
    m4a1: {
        pitchKick: 0.017,
        yawKick: 0.0072,
        rollKick: 0.024,
        camPitchVel: 0.76,
        camYawVel: 0.28,
        camRollVel: 1.20,
        posX: 0.075,
        posY: 0.12,
        posZ: 0.62,
        rotX: 1.32,
        rotY: 0.48,
        rotZ: 0.96,
        fovKick: 0.48,
        trauma: 0.12,
        elbowKick: 0.36,
        wristPitch: 0.42,
        climbPerShot: 0.12,
        maxClimb: 0.72,
        returnRatio: 0.72,
        returnSpeed: 5.4
    },
    rpg7: {
        pitchKick: 0.058,
        yawKick: 0.016,
        rollKick: 0.055,
        camPitchVel: 2.35,
        camYawVel: 0.62,
        camRollVel: 2.60,
        posX: 0.18,
        posY: 0.34,
        posZ: 1.45,
        rotX: 2.85,
        rotY: 0.92,
        rotZ: 1.95,
        fovKick: 2.40,
        trauma: 0.52,
        elbowKick: 0.85,
        wristPitch: 0.90,
        climbPerShot: 0.20,
        maxClimb: 0.40,
        returnRatio: 0.55,
        returnSpeed: 3.2
    }
});

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function getProfile(weaponKey) {
    return WEAPON_RECOIL_PROFILES[weaponKey] || WEAPON_RECOIL_PROFILES.ak12;
}

export function stepFreeAimDeadzone(state, dYaw, dPitch, isAiming = false) {
    const maxYaw = isAiming ? BODYCAM_DEADZONE.adsYaw : BODYCAM_DEADZONE.hipYaw;
    const maxPitch = isAiming ? BODYCAM_DEADZONE.adsPitch : BODYCAM_DEADZONE.hipPitch;
    const direct = isAiming ? BODYCAM_DEADZONE.adsDirectRatio : BODYCAM_DEADZONE.hipDirectRatio;
    const deadShare = 1.0 - direct;

    const rawYaw = (state.yaw || 0) + dYaw * deadShare;
    const rawPitch = (state.pitch || 0) + dPitch * deadShare;

    const clampedYaw = clamp(rawYaw, -maxYaw, maxYaw);
    const clampedPitch = clamp(rawPitch, -maxPitch, maxPitch);

    const overflowYaw = rawYaw - clampedYaw;
    const overflowPitch = rawPitch - clampedPitch;

    state.yaw = clampedYaw;
    state.pitch = clampedPitch;

    return {
        bodyYaw: dYaw * direct + overflowYaw,
        bodyPitch: dPitch * direct + overflowPitch,
        deadzoneYaw: clampedYaw,
        deadzonePitch: clampedPitch
    };
}

export function decayFreeAimDeadzone(state, dt, isAiming = false, isMoving = false) {
    const safeDt = Math.max(0, Math.min(0.1, dt || 0));
    const rate = isAiming ? 11.5 : (isMoving ? 5.2 : 2.6);
    const k = Math.exp(-rate * safeDt);
    const maxYaw = isAiming ? BODYCAM_DEADZONE.adsYaw : BODYCAM_DEADZONE.hipYaw;
    const maxPitch = isAiming ? BODYCAM_DEADZONE.adsPitch : BODYCAM_DEADZONE.hipPitch;

    state.yaw = clamp((state.yaw || 0) * k, -maxYaw, maxYaw);
    state.pitch = clamp((state.pitch || 0) * k, -maxPitch, maxPitch);
    if (Math.abs(state.yaw) < 1e-5) state.yaw = 0;
    if (Math.abs(state.pitch) < 1e-5) state.pitch = 0;
    return state;
}

export function createRecoilState() {
    return {
        burstCount: 0,
        climbMult: 1.0,
        timeSinceShot: 10.0,
        pendingPitchReturn: 0,
        camPitch: 0,
        camYaw: 0,
        camRoll: 0,
        camPitchVel: 0,
        camYawVel: 0,
        camRollVel: 0,
        fovKick: 0,
        trauma: 0
    };
}

export function applyWeaponShotRecoil(state, weaponKey, opts = {}) {
    const prof = getProfile(weaponKey);
    const isAiming = Boolean(opts.isAiming);
    const isCrouching = Boolean(opts.isCrouching);
    const mod = Number.isFinite(opts.modifier) ? opts.modifier : 1.0;

    const r1 = Number.isFinite(opts.rand1) ? opts.rand1 : (Math.random() * 2 - 1);
    const r2 = Number.isFinite(opts.rand2) ? opts.rand2 : (Math.random() * 2 - 1);
    const r3 = Number.isFinite(opts.rand3) ? opts.rand3 : (Math.random() * 2 - 1);

    if (state.timeSinceShot < 0.36) {
        state.burstCount += 1;
    } else {
        state.burstCount = 1;
    }
    state.timeSinceShot = 0;
    state.climbMult = 1.0 + Math.min(prof.maxClimb, Math.max(0, state.burstCount - 1) * prof.climbPerShot);

    const aimScale = isAiming ? 0.62 : 1.0;
    const crouchScale = isCrouching ? 0.78 : 1.0;
    const totalScale = aimScale * crouchScale * mod;
    const climb = state.climbMult;

    const cameraPitchStep = prof.pitchKick * totalScale * climb * (1.0 + r2 * 0.14);
    const cameraYawStep = prof.yawKick * totalScale * (0.45 + 0.55 * climb) * (r1 + (state.burstCount % 2 === 0 ? 0.18 : -0.18));

    state.pendingPitchReturn = Math.min(0.28, state.pendingPitchReturn + cameraPitchStep * prof.returnRatio);
    state.camPitchVel += prof.camPitchVel * totalScale * (0.85 + 0.25 * climb);
    state.camYawVel += prof.camYawVel * totalScale * (r1 * 0.85 + 0.15);
    state.camRollVel += prof.camRollVel * totalScale * (r3 * 0.9 + (r1 >= 0 ? 0.25 : -0.25));
    state.fovKick = Math.min(4.8, state.fovKick + prof.fovKick * (isAiming ? 0.72 : 1.0));
    state.trauma = Math.min(1.0, state.trauma + prof.trauma * (isAiming ? 0.75 : 1.0));

    const viewScale = (isAiming ? 0.68 : 1.0) * crouchScale * mod;
    return {
        cameraPitchStep,
        cameraYawStep,
        posImpulse: {
            x: prof.posX * viewScale * r1,
            y: prof.posY * viewScale * (0.85 + 0.2 * r2),
            z: prof.posZ * viewScale * (0.92 + 0.14 * climb)
        },
        rotImpulse: {
            x: prof.rotX * viewScale * (0.9 + 0.18 * climb),
            y: prof.rotY * viewScale * r1,
            z: prof.rotZ * viewScale * (r3 * 0.85 + 0.22)
        },
        elbowKick: prof.elbowKick * viewScale,
        wristPitch: prof.wristPitch * viewScale
    };
}

export function stepRecoilState(state, dt, weaponKey) {
    const safeDt = Math.max(0, Math.min(0.05, dt || 0));
    const prof = getProfile(weaponKey);

    state.timeSinceShot += safeDt;
    if (state.timeSinceShot > 0.42 && state.burstCount > 0) {
        state.burstCount = 0;
        state.climbMult = 1.0;
    }

    const stiffness = 130.0;
    const damping = 18.5;

    const ax = -stiffness * state.camPitch - damping * state.camPitchVel;
    const ay = -stiffness * state.camYaw - damping * state.camYawVel;
    const az = -stiffness * 0.92 * state.camRoll - damping * 0.95 * state.camRollVel;

    state.camPitchVel += ax * safeDt;
    state.camYawVel += ay * safeDt;
    state.camRollVel += az * safeDt;

    state.camPitch = clamp(state.camPitch + state.camPitchVel * safeDt, -0.18, 0.22);
    state.camYaw = clamp(state.camYaw + state.camYawVel * safeDt, -0.12, 0.12);
    state.camRoll = clamp(state.camRoll + state.camRollVel * safeDt, -0.16, 0.16);

    state.fovKick *= Math.exp(-14.0 * safeDt);
    state.trauma = Math.max(0, state.trauma - safeDt * 1.45);

    let pitchReturnDelta = 0;
    if (state.pendingPitchReturn > 1e-5 && state.timeSinceShot > 0.05) {
        const bleed = state.pendingPitchReturn * (1.0 - Math.exp(-prof.returnSpeed * safeDt));
        state.pendingPitchReturn = Math.max(0, state.pendingPitchReturn - bleed);
        pitchReturnDelta = -bleed;
        if (state.pendingPitchReturn < 1e-5) state.pendingPitchReturn = 0;
    }

    return {
        pitchOffset: state.camPitch,
        yawOffset: state.camYaw,
        rollOffset: state.camRoll,
        fovKick: state.fovKick,
        pitchReturnDelta
    };
}

export function computeWallTuck(distance, startDist = 0.88, minDist = 0.24) {
    if (!Number.isFinite(distance) || distance >= startDist) return 0;
    if (distance <= minDist) return 1;
    const span = Math.max(1e-4, startDist - minDist);
    return clamp((startDist - distance) / span, 0, 1);
}

export function sampleBodycamBreath(time, staminaLoad = 0, aimBlend = 0, crouchBlend = 0) {
    const t = Number.isFinite(time) ? time : 0;
    const fatigue = clamp(staminaLoad || 0, 0, 1);
    const aim = clamp(aimBlend || 0, 0, 1);
    const crouch = clamp(crouchBlend || 0, 0, 1);

    const freq = 1.45 + fatigue * 1.35;
    const amp = (1.0 + fatigue * 1.15) * (1.0 - aim * 0.68) * (1.0 - crouch * 0.30);

    const primary = Math.sin(t * freq);
    const harmonic = Math.sin(t * freq * 0.5 + 0.85);
    const micro = Math.sin(t * 7.2) * (0.08 + fatigue * 0.18);

    return {
        x: (harmonic * 0.0042 + micro * 0.0012) * amp,
        y: (primary * 0.0054 + Math.cos(t * freq * 2.0) * 0.0011) * amp,
        pitch: (primary * 0.0068 + micro * 0.0018) * amp,
        roll: (harmonic * 0.0085 - primary * 0.0022) * amp
    };
}
