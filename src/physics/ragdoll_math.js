const EPS = 1e-7;

export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

export function quatNormalize(q, out = q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (len < EPS) {
        out.x = 0; out.y = 0; out.z = 0; out.w = 1;
        return out;
    }
    const inv = 1 / len;
    out.x = q.x * inv;
    out.y = q.y * inv;
    out.z = q.z * inv;
    out.w = q.w * inv;
    return out;
}

export function quatMul(ax, ay, az, aw, bx, by, bz, bw, out) {
    const x = aw * bx + ax * bw + ay * bz - az * by;
    const y = aw * by - ax * bz + ay * bw + az * bx;
    const z = aw * bz + ax * by - ay * bx + az * bw;
    const w = aw * bw - ax * bx - ay * by - az * bz;
    const len = Math.hypot(x, y, z, w) || 1;
    out.x = x / len;
    out.y = y / len;
    out.z = z / len;
    out.w = w / len;
    return out;
}

export function quatRotateVec(qx, qy, qz, qw, vx, vy, vz, out) {
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out.x = vx + qw * tx + (qy * tz - qz * ty);
    out.y = vy + qw * ty + (qz * tx - qx * tz);
    out.z = vz + qw * tz + (qx * ty - qy * tx);
    return out;
}

export function quatRotateInverse(qx, qy, qz, qw, vx, vy, vz, out) {
    return quatRotateVec(-qx, -qy, -qz, qw, vx, vy, vz, out);
}

export function quatFromAxisAngle(ax, ay, az, angle, out) {
    const half = angle * 0.5;
    const s = Math.sin(half);
    out.x = ax * s;
    out.y = ay * s;
    out.z = az * s;
    out.w = Math.cos(half);
    return out;
}

export function quatFromBasis(rx, ry, rz, ux, uy, uz, fx, fy, fz, out) {
    const trace = rx + uy + fz;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1.0) * 2;
        out.w = 0.25 * s;
        out.x = (uz - fy) / s;
        out.y = (fx - rz) / s;
        out.z = (ry - ux) / s;
    } else if (rx > uy && rx > fz) {
        const s = Math.sqrt(1.0 + rx - uy - fz) * 2;
        out.w = (uz - fy) / s;
        out.x = 0.25 * s;
        out.y = (ux + ry) / s;
        out.z = (fx + rz) / s;
    } else if (uy > fz) {
        const s = Math.sqrt(1.0 + uy - rx - fz) * 2;
        out.w = (fx - rz) / s;
        out.x = (ux + ry) / s;
        out.y = 0.25 * s;
        out.z = (fy + uz) / s;
    } else {
        const s = Math.sqrt(1.0 + fz - rx - uy) * 2;
        out.w = (ry - ux) / s;
        out.x = (fx + rz) / s;
        out.y = (fy + uz) / s;
        out.z = 0.25 * s;
    }
    return quatNormalize(out);
}

export function buildAnatomicalBasis(upX, upY, upZ, refFwdX, refFwdY, refFwdZ, outQuat) {
    let uLen = Math.hypot(upX, upY, upZ);
    if (uLen < EPS) {
        upX = 0; upY = 1; upZ = 0;
        uLen = 1;
    }
    const ux = upX / uLen, uy = upY / uLen, uz = upZ / uLen;

    let rx = uy * refFwdZ - uz * refFwdY;
    let ry = uz * refFwdX - ux * refFwdZ;
    let rz = ux * refFwdY - uy * refFwdX;
    let rLen = Math.hypot(rx, ry, rz);

    if (rLen < 1e-4) {
        const ax = Math.abs(ux) < 0.9 ? 1 : 0;
        const ay = Math.abs(ux) < 0.9 ? 0 : 1;
        const az = 0;
        rx = uy * az - uz * ay;
        ry = uz * ax - ux * az;
        rz = ux * ay - uy * ax;
        rLen = Math.hypot(rx, ry, rz) || 1;
    }
    rx /= rLen; ry /= rLen; rz /= rLen;

    const fx = ry * uz - rz * uy;
    const fy = rz * ux - rx * uz;
    const fz = rx * uy - ry * ux;

    return quatFromBasis(rx, ry, rz, ux, uy, uz, fx, fy, fz, outQuat);
}

const _qT = { x: 0, y: 0, z: 0, w: 1 };
const _qS = { x: 0, y: 0, z: 0, w: 1 };
const _qTClamped = { x: 0, y: 0, z: 0, w: 1 };
const _qSClamped = { x: 0, y: 0, z: 0, w: 1 };

export function decomposeSwingTwist(qx, qy, qz, qw, ax, ay, az, outSwing, outTwist) {
    if (qw < 0) {
        qx = -qx; qy = -qy; qz = -qz; qw = -qw;
    }
    const dot = qx * ax + qy * ay + qz * az;
    let tx = ax * dot, ty = ay * dot, tz = az * dot, tw = qw;
    const tLen = Math.hypot(tx, ty, tz, tw);
    if (tLen < EPS) {
        outTwist.x = 0; outTwist.y = 0; outTwist.z = 0; outTwist.w = 1;
    } else {
        outTwist.x = tx / tLen;
        outTwist.y = ty / tLen;
        outTwist.z = tz / tLen;
        outTwist.w = tw / tLen;
    }
    quatMul(qx, qy, qz, qw, -outTwist.x, -outTwist.y, -outTwist.z, outTwist.w, outSwing);
    if (outSwing.w < 0) {
        outSwing.x = -outSwing.x; outSwing.y = -outSwing.y; outSwing.z = -outSwing.z; outSwing.w = -outSwing.w;
    }
}

export function clampHingeQuaternion(qx, qy, qz, qw, lo, hi, outQuat, maxWobble = 0.035) {
    if (qw < 0) {
        qx = -qx; qy = -qy; qz = -qz; qw = -qw;
    }
    decomposeSwingTwist(qx, qy, qz, qw, 1, 0, 0, _qS, _qT);

    const sinHalf = Math.hypot(_qT.x, _qT.y, _qT.z);
    let angle = 2 * Math.atan2(sinHalf, _qT.w);
    if (_qT.x < 0) angle = -angle;

    const clampedAngle = clamp(angle, lo, hi);
    const sSin = Math.hypot(_qS.x, _qS.y, _qS.z);
    const swingAngle = 2 * Math.atan2(sSin, _qS.w);

    const hitTwist = Math.abs(clampedAngle - angle) > 1e-4;
    const hitSwing = swingAngle > maxWobble;
    if (!hitTwist && !hitSwing) {
        outQuat.x = qx; outQuat.y = qy; outQuat.z = qz; outQuat.w = qw;
        return false;
    }

    quatFromAxisAngle(1, 0, 0, clampedAngle, _qTClamped);
    if (hitSwing && sSin > EPS) {
        const sHalf = maxWobble * 0.5;
        const scale = Math.sin(sHalf) / sSin;
        _qSClamped.x = _qS.x * scale;
        _qSClamped.y = _qS.y * scale;
        _qSClamped.z = _qS.z * scale;
        _qSClamped.w = Math.cos(sHalf);
    } else {
        _qSClamped.x = _qS.x; _qSClamped.y = _qS.y; _qSClamped.z = _qS.z; _qSClamped.w = _qS.w;
    }
    quatMul(
        _qSClamped.x, _qSClamped.y, _qSClamped.z, _qSClamped.w,
        _qTClamped.x, _qTClamped.y, _qTClamped.z, _qTClamped.w,
        outQuat
    );
    return true;
}

export function clampConeTwistQuaternion(qx, qy, qz, qw, pitchMin, pitchMax, rollLimit, twistLimit, outQuat) {
    if (qw < 0) {
        qx = -qx; qy = -qy; qz = -qz; qw = -qw;
    }
    decomposeSwingTwist(qx, qy, qz, qw, 0, 1, 0, _qS, _qT);

    const tSin = Math.hypot(_qT.x, _qT.y, _qT.z);
    let twistAngle = 2 * Math.atan2(tSin, _qT.w);
    if (_qT.y < 0) twistAngle = -twistAngle;
    const clampedTwist = clamp(twistAngle, -twistLimit, twistLimit);
    const twistClamped = Math.abs(clampedTwist - twistAngle) > 1e-4;

    const sSin = Math.hypot(_qS.x, _qS.y, _qS.z);
    const swingMag = 2 * Math.atan2(sSin, _qS.w);

    let sx = 0, sz = 0;
    if (sSin > EPS) {
        const factor = swingMag / sSin;
        sx = _qS.x * factor;
        sz = _qS.z * factor;
    }

    const pCenter = (pitchMin + pitchMax) * 0.5;
    const pHalf = Math.max(0.05, (pitchMax - pitchMin) * 0.5);
    const rHalf = Math.max(0.05, rollLimit);

    const dx = (sx - pCenter) / pHalf;
    const dz = sz / rHalf;
    const ellipSq = dx * dx + dz * dz;
    let swingClamped = false;

    if (ellipSq > 1.0 + 1e-5) {
        const inv = 1 / Math.sqrt(ellipSq);
        sx = pCenter + (sx - pCenter) * inv;
        sz = sz * inv;
        swingClamped = true;
    }

    if (!twistClamped && !swingClamped) {
        outQuat.x = qx; outQuat.y = qy; outQuat.z = qz; outQuat.w = qw;
        return false;
    }

    const newMag = Math.hypot(sx, sz);
    if (newMag > EPS) {
        quatFromAxisAngle(sx / newMag, 0, sz / newMag, newMag, _qSClamped);
    } else {
        _qSClamped.x = 0; _qSClamped.y = 0; _qSClamped.z = 0; _qSClamped.w = 1;
    }
    quatFromAxisAngle(0, 1, 0, clampedTwist, _qTClamped);

    quatMul(
        _qSClamped.x, _qSClamped.y, _qSClamped.z, _qSClamped.w,
        _qTClamped.x, _qTClamped.y, _qTClamped.z, _qTClamped.w,
        outQuat
    );
    return true;
}

export function computeRagdollDamping(posY, linSpeed, angSpeed, age, baseLinDamp, baseAngDamp) {
    const groundProximity = clamp((0.55 - posY) / 0.45, 0, 1);
    const slowFactor = clamp((1.6 - linSpeed) / 1.4, 0, 1);
    const ageRamp = clamp((age - 0.15) / 1.4, 0, 1);
    const collapseBlend = clamp(1 - age / 0.28, 0, 1);

    const linDamp = baseLinDamp + groundProximity * (1.8 + 1.8 * slowFactor) + ageRamp * 0.85;
    const angDamp = baseAngDamp + collapseBlend * 7.5 + groundProximity * (4.2 + 4.8 * slowFactor) + ageRamp * 2.2;
    const rollBleed = groundProximity > 0.15 ? clamp(groundProximity * (0.28 + 0.35 * slowFactor), 0, 0.65) : 0;

    return {
        linDamp,
        angDamp,
        rollBleed,
        isSettledCandidate: linSpeed < 0.12 && angSpeed < 0.22 && groundProximity > 0.25
    };
}

export function computeExplosionProfile(kind = 'he', radius = 8) {
    const k = String(kind || 'he').toLowerCase();
    let visualScale = 0.78;
    let countScale = 0.80;
    let lightScale = 0.76;
    let shakeScale = 0.72;
    let craterScale = 0.78;
    let impulseScale = 0.82;

    if (k === 'pg7' || k === 'rpg') {
        visualScale = 1.0;
        countScale = 1.0;
        lightScale = 1.0;
        shakeScale = 1.0;
        craterScale = 1.0;
        impulseScale = 1.0;
    } else if (k === 'he125') {
        visualScale = 0.92;
        countScale = 0.94;
        lightScale = 0.92;
        shakeScale = 0.90;
        craterScale = 0.92;
        impulseScale = 0.95;
    } else if (k === 'fpv' || k === 'drone') {
        visualScale = 0.56;
        countScale = 0.58;
        lightScale = 0.50;
        shakeScale = 0.46;
        craterScale = 0.56;
        impulseScale = 0.60;
    } else if (k === 'lancet') {
        visualScale = 0.68;
        countScale = 0.70;
        lightScale = 0.64;
        shakeScale = 0.58;
        craterScale = 0.66;
        impulseScale = 0.72;
    } else if (k === 'grenade' || k === 'vog') {
        visualScale = 0.62;
        countScale = 0.64;
        lightScale = 0.56;
        shakeScale = 0.50;
        craterScale = 0.58;
        impulseScale = 0.66;
    } else if (k === 'era' || k === 'autocannon') {
        visualScale = 0.48;
        countScale = 0.50;
        lightScale = 0.45;
        shakeScale = 0.38;
        craterScale = 0.44;
        impulseScale = 0.52;
    }

    const r = Math.max(1.0, Number.isFinite(radius) ? radius : 8);
    const scale = Math.max(0.30, (r / 8.0) * visualScale);
    return { scale, visualScale, countScale, lightScale, shakeScale, craterScale, impulseScale };
}

export function computeDeathKinematics(hitIdx, impX, impY, impZ, deathKind = 'torso', randA = 0.5, randB = 0.5) {
    const mag = Math.hypot(impX, impY, impZ);
    const dirX = mag > 1e-4 ? impX / mag : 0;
    const dirZ = mag > 1e-4 ? impZ / mag : 1;
    const perpX = -dirZ;
    const perpZ = dirX;
    const sign = randA >= 0.5 ? 1 : -1;
    const k = String(deathKind || '').toLowerCase();

    if (k === 'blast' || mag > 85) {
        const capped = clamp(mag, 32, 235);
        const capScale = mag > 1e-4 ? capped / mag : 0;
        const liftFactor = clamp(capped / 145, 0.38, 1.0);
        return {
            mode: 'blast',
            bodyScale: capScale,
            minLift: 2.2 * liftFactor,
            maxLift: 13.5 * liftFactor,
            torsoTorque: [
                (randA - 0.5) * 4.2 * liftFactor,
                sign * (2.6 + randB * 3.2) * liftFactor,
                (randB - 0.5) * 4.2 * liftFactor
            ]
        };
    }

    const push = clamp(mag, 12, 46);
    const ix = dirX * push;
    const iz = dirZ * push;

    if (hitIdx === 2 || k === 'head') {
        return {
            mode: 'head',
            head: [ix * 0.56, 1.85 + randA * 0.7, iz * 0.56],
            chest: [ix * 0.44, -2.4, iz * 0.44],
            pelvis: [ix * 0.14, -6.2, iz * 0.14],
            legs: [ix * 0.08, -(2.4 + randB * 1.4), iz * 0.08],
            torsoTorque: [
                -dirZ * 2.2 + (randA - 0.5) * 1.0,
                sign * (1.2 + randB * 1.6),
                dirX * 2.2 + (randB - 0.5) * 1.0
            ]
        };
    }

    if ((hitIdx >= 7 && hitIdx <= 10) || k === 'leg') {
        const hitLeft = hitIdx === 7 || hitIdx === 8;
        const sideSign = hitLeft ? 1 : -1;
        return {
            mode: 'leg',
            targetIdx: hitIdx >= 7 && hitIdx <= 10 ? hitIdx : (hitLeft ? 7 : 9),
            target: [ix * 0.92, 2.6 + randA * 1.2, iz * 0.92],
            chest: [ix * 0.24 + perpX * sideSign * 3.8, -3.6, iz * 0.24 + perpZ * sideSign * 3.8],
            pelvis: [ix * 0.16, -7.8, iz * 0.16],
            legs: [ix * 0.10, -2.2, iz * 0.10],
            torsoTorque: [
                (randA - 0.5) * 2.4,
                sideSign * (3.2 + randB * 2.2),
                (randB - 0.5) * 2.4
            ]
        };
    }

    if ((hitIdx >= 3 && hitIdx <= 6) || k === 'arm') {
        const hitLeft = hitIdx === 3 || hitIdx === 4;
        const spinSign = hitLeft ? -1 : 1;
        return {
            mode: 'arm',
            targetIdx: hitIdx >= 3 && hitIdx <= 6 ? hitIdx : (hitLeft ? 3 : 5),
            target: [ix * 0.78 + perpX * spinSign * 2.5, 1.4, iz * 0.78 + perpZ * spinSign * 2.5],
            chest: [ix * 0.42, -2.6, iz * 0.42],
            pelvis: [ix * 0.18, -5.8, iz * 0.18],
            legs: [ix * 0.10, -(2.0 + randA * 1.4), iz * 0.10],
            torsoTorque: [
                (randA - 0.5) * 1.8,
                spinSign * (4.2 + randB * 2.4),
                (randB - 0.5) * 1.8
            ]
        };
    }

    const lateral = sign * (1.8 + randB * 2.4);
    return {
        mode: 'torso',
        chest: [ix * 0.68 + perpX * lateral, 0.45 + randA * 0.85, iz * 0.68 + perpZ * lateral],
        pelvis: [ix * 0.22, -5.6, iz * 0.22],
        head: [-ix * 0.12, 0.9, -iz * 0.12],
        armWhipIdx: sign > 0 ? 3 : 5,
        armWhip: [ix * 0.34 + perpX * sign * 2.6, 1.5, iz * 0.34 + perpZ * sign * 2.6],
        legs: [ix * 0.12, -(2.2 + randA * 1.6), iz * 0.12],
        torsoTorque: [
            -dirZ * 1.6 + (randA - 0.5) * 1.4,
            sign * (3.0 + randB * 2.6),
            dirX * 1.6 + (randB - 0.5) * 1.4
        ]
    };
}

