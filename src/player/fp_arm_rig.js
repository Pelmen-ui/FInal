import * as THREE from 'three';

const _textureCache = new Map();

function makeCanvas(w, h) {
    if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(w, h);
    }
    return null;
}

function seededRand(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function createCamoTextures(faction) {
    const key = `camo_${faction}`;
    if (_textureCache.has(key)) return _textureCache.get(key);

    const size = 512;
    const colCanvas = makeCanvas(size, size);
    const bumpCanvas = makeCanvas(size, size);
    if (!colCanvas || !bumpCanvas) return { map: null, bumpMap: null };

    const ctx = colCanvas.getContext('2d');
    const bctx = bumpCanvas.getContext('2d');
    const rng = seededRand(faction === 'RU' ? 13379 : 42071);

    if (faction === 'RU') {
        // EMR Digital Flora (Ratnik) dark tactical pixel camo
        ctx.fillStyle = '#334029';
        ctx.fillRect(0, 0, size, size);
        const palette = ['#25301f', '#3d4c2f', '#1d2419', '#4a5536', '#2c3523', '#53583c'];
        for (let pass = 0; pass < 3; pass++) {
            const count = pass === 0 ? 420 : (pass === 1 ? 850 : 1200);
            const px = pass === 0 ? 16 : (pass === 1 ? 8 : 4);
            for (let i = 0; i < count; i++) {
                const x = Math.floor(rng() * (size / px)) * px;
                const y = Math.floor(rng() * (size / px)) * px;
                const w = px * (1 + Math.floor(rng() * (pass === 0 ? 4 : 3)));
                const h = px * (1 + Math.floor(rng() * (pass === 0 ? 3 : 2)));
                ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
                ctx.fillRect(x, y, w, h);
            }
        }
    } else {
        // UA MM-14 / Multicam tactical terrain pixel pattern
        ctx.fillStyle = '#6b6a52';
        ctx.fillRect(0, 0, size, size);
        const palette = ['#4d523c', '#827e64', '#3b3e2e', '#948a6b', '#5d5742', '#73765c'];
        for (let pass = 0; pass < 3; pass++) {
            const count = pass === 0 ? 360 : (pass === 1 ? 760 : 980);
            const px = pass === 0 ? 18 : (pass === 1 ? 9 : 5);
            for (let i = 0; i < count; i++) {
                const x = Math.floor(rng() * (size / px)) * px;
                const y = Math.floor(rng() * (size / px)) * px;
                const w = px * (1 + Math.floor(rng() * (pass === 0 ? 4 : 3)));
                const h = px * (1 + Math.floor(rng() * (pass === 0 ? 3 : 2)));
                ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
                ctx.fillRect(x, y, w, h);
            }
        }
    }

    // Subtle fabric fold shading + ripstop grid overlay
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i += 8) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
    }

    // Ripstop fabric bump map
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 4) {
        bctx.fillStyle = (y % 8 === 0) ? '#a6a6a6' : '#6e6e6e';
        bctx.fillRect(0, y, size, 1);
    }
    for (let x = 0; x < size; x += 4) {
        bctx.fillStyle = (x % 8 === 0) ? '#a8a8a8' : '#707070';
        bctx.fillRect(x, 0, 1, size);
    }
    // Horizontal sleeve crease waves
    for (let i = 0; i < 14; i++) {
        const y = rng() * size;
        const g = bctx.createLinearGradient(0, y - 14, 0, y + 14);
        g.addColorStop(0, 'rgba(128,128,128,0)');
        g.addColorStop(0.5, i % 2 === 0 ? 'rgba(215,215,215,0.42)' : 'rgba(45,45,45,0.42)');
        g.addColorStop(1, 'rgba(128,128,128,0)');
        bctx.fillStyle = g;
        bctx.fillRect(0, y - 14, size, 28);
    }

    const map = new THREE.CanvasTexture(colCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 2);
    map.anisotropy = 4;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(2, 2);

    const pair = { map, bumpMap };
    _textureCache.set(key, pair);
    return pair;
}

function createGloveTextures(faction) {
    const key = `glove_v2_${faction}`;
    if (_textureCache.has(key)) return _textureCache.get(key);

    const size = 256;
    const colCanvas = makeCanvas(size, size);
    const bumpCanvas = makeCanvas(size, size);
    if (!colCanvas || !bumpCanvas) return { map: null, bumpMap: null };

    const ctx = colCanvas.getContext('2d');
    const bctx = bumpCanvas.getContext('2d');
    const rng = seededRand(faction === 'RU' ? 8811 : 9922);

    // Two-tone Mechanix M-Pact dorsal fabric: Ranger Green (RU) / Coyote Tan (UA)
    ctx.fillStyle = faction === 'RU' ? '#495240' : '#7b6b51';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);

    // Fine breathable tactical mesh & pebble grip grain
    for (let i = 0; i < 5200; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 0.8 + rng() * 1.4;
        const shade = rng() > 0.5 ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.095)';
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, r, r);

        const bVal = Math.floor(92 + rng() * 72);
        bctx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
        bctx.fillRect(x, y, r, r);
    }

    // Subtle reinforcement stitch seams
    ctx.strokeStyle = faction === 'RU' ? 'rgba(18,22,16,0.52)' : 'rgba(42,34,24,0.52)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    for (let y = 32; y < size; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }

    const map = new THREE.CanvasTexture(colCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;

    const pair = { map, bumpMap };
    _textureCache.set(key, pair);
    return pair;
}

function createWatchDialTexture() {
    if (_textureCache.has('watch_dial_v2')) return _textureCache.get('watch_dial_v2');

    const size = 256;
    const canvas = makeCanvas(size, size);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const cx = size * 0.5;
    const cy = size * 0.5;

    ctx.fillStyle = '#090e11';
    ctx.fillRect(0, 0, size, size);

    // Outer gunmetal tachymeter ring
    ctx.strokeStyle = '#47525c';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, 113, 0, Math.PI * 2);
    ctx.stroke();

    // Inner luminous tritium indices
    for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - Math.PI * 0.5;
        const isMajor = i % 5 === 0;
        const r1 = isMajor ? 80 : 92;
        const r2 = 104;
        ctx.strokeStyle = isMajor ? '#9affb8' : 'rgba(195,215,210,0.55)';
        ctx.lineWidth = isMajor ? 5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
    }

    // Digital date window
    ctx.fillStyle = '#182b24';
    ctx.fillRect(cx + 20, cy - 12, 40, 24);
    ctx.fillStyle = '#9effc0';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('19', cx + 30, cy + 6);

    // Luminous hour & minute hands
    ctx.strokeStyle = '#e5f5ec';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - 40, cy - 36);
    ctx.stroke();

    ctx.strokeStyle = '#f2fff8';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 60, cy - 44);
    ctx.stroke();

    // Red tactical seconds hand
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy + 18);
    ctx.lineTo(cx + 30, cy + 72);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    _textureCache.set('watch_dial_v2', tex);
    return tex;
}

function buildSculptedSleeveLathe(length, profilePoints, radialSegs = 16) {
    const pts = profilePoints.map(([r, t]) => new THREE.Vector2(r, t * length));
    const geo = new THREE.LatheGeometry(pts, radialSegs);
    geo.computeVertexNormals();
    return geo;
}

function configureViewMesh(mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 80;
    return mesh;
}

function buildMaterials(faction) {
    const camo = createCamoTextures(faction);
    const glove = createGloveTextures(faction);
    const watchTex = createWatchDialTexture();

    const sleeveMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: camo.map,
        bumpMap: camo.bumpMap,
        bumpScale: 0.0045,
        roughness: 0.88,
        metalness: 0.04
    });

    const cuffMat = new THREE.MeshStandardMaterial({
        color: faction === 'RU' ? 0x262d22 : 0x474133,
        bumpMap: camo.bumpMap,
        bumpScale: 0.003,
        roughness: 0.82,
        metalness: 0.06
    });

    const gloveBodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: glove.map,
        bumpMap: glove.bumpMap,
        bumpScale: 0.0032,
        roughness: 0.78,
        metalness: 0.05
    });

    const glovePalmMat = new THREE.MeshStandardMaterial({
        color: faction === 'RU' ? 0x232623 : 0x3b352c,
        bumpMap: glove.bumpMap,
        bumpScale: 0.0045,
        roughness: 0.72,
        metalness: 0.06
    });

    const knuckleArmorMat = new THREE.MeshStandardMaterial({
        color: faction === 'RU' ? 0x1a1e1b : 0x2b2722,
        roughness: 0.34,
        metalness: 0.24
    });

    const strapMat = new THREE.MeshStandardMaterial({
        color: 0x191c1a,
        roughness: 0.85,
        metalness: 0.05
    });

    const watchCaseMat = new THREE.MeshStandardMaterial({
        color: 0x24282b,
        roughness: 0.30,
        metalness: 0.65
    });

    const watchFaceMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: watchTex,
        emissive: new THREE.Color(0x1b422a),
        emissiveIntensity: 0.45,
        roughness: 0.16,
        metalness: 0.10
    });

    const patchMat = new THREE.MeshStandardMaterial({
        color: faction === 'RU' ? 0x3b4230 : 0x998c44,
        roughness: 0.86,
        metalness: 0.04
    });

    return {
        sleeveMat,
        cuffMat,
        gloveBodyMat,
        glovePalmMat,
        knuckleArmorMat,
        strapMat,
        watchCaseMat,
        watchFaceMat,
        patchMat
    };
}

function buildArticulatedFinger(name, lengths, baseRadius, mats, isThumb = false) {
    const [l1, l2, l3] = lengths;
    const j1 = new THREE.Group();
    j1.name = `${name}1`;
    const j2 = new THREE.Group();
    j2.name = `${name}2`;
    j2.position.set(0, l1, 0);
    const j3 = new THREE.Group();
    j3.name = `${name}3`;
    j3.position.set(0, l2, 0);

    j1.add(j2);
    j2.add(j3);

    const buildSegment = (parent, len, rTop, rBot, addPad, isTip) => {
        // Joint cap sphere so flexion never reveals seams
        const jointSphere = configureViewMesh(new THREE.Mesh(
            new THREE.SphereGeometry(rBot * 1.03, 10, 8),
            mats.gloveBodyMat
        ));
        parent.add(jointSphere);

        // Tapered phalanx cylinder
        const cyl = configureViewMesh(new THREE.Mesh(
            new THREE.CylinderGeometry(rTop, rBot, len, 10, 1),
            mats.gloveBodyMat
        ));
        cyl.position.y = len * 0.5;
        parent.add(cyl);

        // Palm-side textured leather grip pad (+Z side)
        const gripPad = configureViewMesh(new THREE.Mesh(
            new THREE.BoxGeometry(rBot * 1.38, len * 0.72, rBot * 0.42),
            mats.glovePalmMat
        ));
        gripPad.position.set(0, len * 0.52, rBot * 0.76);
        parent.add(gripPad);

        // Molded TPR dorsal finger armor (-Z side)
        if (addPad) {
            const armor = configureViewMesh(new THREE.Mesh(
                new THREE.BoxGeometry(rBot * 1.48, len * 0.52, rBot * 0.48),
                mats.knuckleArmorMat
            ));
            armor.position.set(0, len * 0.44, -rBot * 0.78);
            parent.add(armor);
        }

        if (isTip) {
            const tip = configureViewMesh(new THREE.Mesh(
                new THREE.SphereGeometry(rTop * 1.02, 10, 8),
                mats.glovePalmMat
            ));
            tip.scale.set(1.0, 1.15, 0.92);
            tip.position.y = len;
            parent.add(tip);
        }
    };

    buildSegment(j1, l1, baseRadius * 0.94, baseRadius, !isThumb, false);
    buildSegment(j2, l2, baseRadius * 0.84, baseRadius * 0.93, !isThumb, false);
    buildSegment(j3, l3, baseRadius * 0.74, baseRadius * 0.83, false, true);

    return { j1, j2, j3 };
}

function buildHandAssembly(side, mats) {
    // side = +1 for RIGHT hand (+X is thumb side), -1 for LEFT hand (-X is thumb side)
    // Canonical local axes:
    //   +Y = forward toward fingers (knuckleDir)
    //   +Z = out of palm toward weapon grip (palmNormal)
    //   +X = knuckleDir x palmNormal (right=+thumb, left=+pinky)
    const hand = new THREE.Group();
    hand.name = side > 0 ? 'FP_RightHand' : 'FP_LeftHand';

    // Wrist gauntlet transition sleeve overlapping into forearm cuff
    const gauntlet = configureViewMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.0245, 0.0265, 0.042, 14),
        mats.cuffMat
    ));
    gauntlet.scale.set(1.16, 1.0, 0.78);
    gauntlet.position.set(0, -0.008, 0);
    hand.add(gauntlet);

    // Velcro wrist closure strap
    const wristStrap = configureViewMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.0272, 0.0272, 0.014, 14),
        mats.strapMat
    ));
    wristStrap.scale.set(1.18, 1.0, 0.80);
    wristStrap.position.set(0, -0.012, 0);
    hand.add(wristStrap);

    // Sculpted palm core (wider across knuckles, narrower at wrist)
    const palmMain = configureViewMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.064, 0.062, 0.022),
        mats.gloveBodyMat
    ));
    palmMain.position.set(-side * 0.001, 0.035, 0.000);
    hand.add(palmMain);

    // Rounded lateral palm edges (radial & ulnar cushions)
    const ulnarPad = configureViewMesh(new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0115, 0.042, 6, 10),
        mats.gloveBodyMat
    ));
    ulnarPad.position.set(-side * 0.028, 0.034, 0.002);
    hand.add(ulnarPad);

    const radialPad = configureViewMesh(new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0125, 0.036, 6, 10),
        mats.gloveBodyMat
    ));
    radialPad.position.set(side * 0.027, 0.026, 0.005);
    radialPad.rotation.z = -side * 0.16;
    hand.add(radialPad);

    // Padded synthetic suede heel-of-palm (+Z contact surface)
    const palmHeel = configureViewMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 12, 10),
        mats.glovePalmMat
    ));
    palmHeel.scale.set(1.38, 1.05, 0.44);
    palmHeel.position.set(side * 0.004, 0.022, 0.009);
    hand.add(palmHeel);

    const palmMidPad = configureViewMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.058, 0.032, 0.008),
        mats.glovePalmMat
    ));
    palmMidPad.position.set(-side * 0.001, 0.046, 0.010);
    hand.add(palmMidPad);

    // Molded carbon-fiber / TPR knuckle armor shell (-Z dorsal face)
    const knuckleBar = configureViewMesh(new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0092, 0.048, 6, 12),
        mats.knuckleArmorMat
    ));
    knuckleBar.rotation.z = Math.PI * 0.5;
    knuckleBar.scale.set(1.0, 1.0, 0.72);
    knuckleBar.position.set(-side * 0.001, 0.062, -0.009);
    hand.add(knuckleBar);

    // 4 sculpted individual knuckle domes + dorsal TPR metacarpal ribs
    const fingerSpecs = [
        { key: 'index',  xOff: side * 0.023,  yOff: 0.066, lens: [0.027, 0.018, 0.014], rad: 0.0076, splay: side * 0.05 },
        { key: 'middle', xOff: side * 0.007,  yOff: 0.068, lens: [0.030, 0.020, 0.015], rad: 0.0078, splay: side * 0.01 },
        { key: 'ring',   xOff: -side * 0.009, yOff: 0.066, lens: [0.027, 0.018, 0.014], rad: 0.0074, splay: -side * 0.03 },
        { key: 'pinky',  xOff: -side * 0.024, yOff: 0.061, lens: [0.022, 0.015, 0.012], rad: 0.0066, splay: -side * 0.07 }
    ];

    const fingers = {};
    for (const sp of fingerSpecs) {
        const dome = configureViewMesh(new THREE.Mesh(
            new THREE.SphereGeometry(0.0072, 8, 8),
            mats.knuckleArmorMat
        ));
        dome.position.set(sp.xOff, sp.yOff - 0.004, -0.011);
        hand.add(dome);

        const rib = configureViewMesh(new THREE.Mesh(
            new THREE.BoxGeometry(0.0062, 0.032, 0.0042),
            mats.knuckleArmorMat
        ));
        rib.position.set(sp.xOff * 0.88, 0.038, -0.0115);
        hand.add(rib);

        const f = buildArticulatedFinger(sp.key, sp.lens, sp.rad, mats, false);
        f.j1.position.set(sp.xOff, sp.yOff, 0.001);
        f.baseSplay = sp.splay;
        hand.add(f.j1);
        fingers[sp.key] = f;
    }

    // Articulated Thumb (opposable saddle joint on +side X)
    const thumbRoot = new THREE.Group();
    thumbRoot.name = 'thumbRoot';
    thumbRoot.position.set(side * 0.030, 0.024, 0.006);
    hand.add(thumbRoot);

    const thumb = buildArticulatedFinger('thumb', [0.023, 0.019, 0.014], 0.0076, mats, true);
    thumbRoot.add(thumb.j1);
    fingers.thumb = thumb;
    fingers.thumbRoot = thumbRoot;

    // Tactical chronograph watch mounted on left wrist radial-dorsal quadrant facing camera
    if (side < 0) {
        const watch = buildTacticalWatch(mats);
        watch.position.set(0, -0.024, 0);
        hand.add(watch);
    }

    return { hand, fingers };
}

function buildTacticalWatch(mats) {
    const watch = new THREE.Group();
    watch.name = 'tactical_watch';

    // Slim ballistic nylon strap sitting flush over the wrist gauntlet
    const strap = configureViewMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.0288, 0.0298, 0.016, 18),
        mats.strapMat
    ));
    strap.scale.set(1.16, 1.0, 0.84);
    watch.add(strap);

    // Flush-mounted tactical chronograph on radial-dorsal wrist quadrant
    const head = new THREE.Group();
    head.position.set(-0.022, 0.0, -0.017);
    head.rotation.set(0.18, Math.PI * 0.22, 0.0);

    const bezel = configureViewMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.0132, 0.0146, 0.0062, 18),
        mats.watchCaseMat
    ));
    bezel.rotation.x = Math.PI * 0.5;
    head.add(bezel);

    // Subtle crown & tactical pushers
    for (const py of [-0.0055, 0.0, 0.0055]) {
        const btn = configureViewMesh(new THREE.Mesh(
            new THREE.CylinderGeometry(0.0016, 0.0016, 0.0036, 8),
            mats.watchCaseMat
        ));
        btn.rotation.z = Math.PI * 0.5;
        btn.position.set(0.0138, py, -0.0005);
        head.add(btn);
    }

    // Luminous tritium dial face
    const dial = configureViewMesh(new THREE.Mesh(
        new THREE.CircleGeometry(0.0112, 20),
        mats.watchFaceMat
    ));
    dial.position.set(0, 0, -0.0034);
    dial.rotation.y = Math.PI;
    head.add(dial);

    watch.add(head);
    return watch;
}

function buildSingleArm(side, faction, mats) {
    const L1 = 0.310; // Upper arm length (shoulder -> elbow)
    const L2 = 0.290; // Forearm length (elbow -> wrist)

    const upper = new THREE.Group();
    upper.name = side > 0 ? 'FP_RightUpperArm' : 'FP_LeftUpperArm';

    // Sculpted combat shirt upper sleeve with subtle folds
    const upperSleeveGeo = buildSculptedSleeveLathe(L1, [
        [0.056, 0.00],
        [0.058, 0.14],
        [0.053, 0.30],
        [0.056, 0.44],
        [0.051, 0.62],
        [0.053, 0.76],
        [0.047, 0.90],
        [0.044, 1.00]
    ], 16);
    const upperSleeve = configureViewMesh(new THREE.Mesh(upperSleeveGeo, mats.sleeveMat));
    upper.add(upperSleeve);

    // Shoulder deltoid cap
    const shoulderCap = configureViewMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.057, 12, 10),
        mats.sleeveMat
    ));
    upper.add(shoulderCap);

    // Bicep tactical pocket + subdued velcro patch
    const pocket = configureViewMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.088, 0.058),
        mats.cuffMat
    ));
    pocket.position.set(side * 0.051, L1 * 0.42, -0.006);
    upper.add(pocket);

    const patch = configureViewMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.036, 0.046),
        mats.patchMat
    ));
    patch.position.set(side * 0.057, L1 * 0.46, -0.006);
    upper.add(patch);

    // Elbow joint sphere + tactical elbow pad
    const lower = new THREE.Group();
    lower.name = side > 0 ? 'FP_RightForeArm' : 'FP_LeftForeArm';
    lower.position.set(0, L1, 0);
    upper.add(lower);

    const elbowCap = configureViewMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 10),
        mats.sleeveMat
    ));
    lower.add(elbowCap);

    // Proximal forearm half (no twist pinch at elbow)
    const foreProxGeo = buildSculptedSleeveLathe(L2 * 0.56, [
        [0.045, 0.00],
        [0.048, 0.25],
        [0.044, 0.55],
        [0.046, 0.78],
        [0.041, 1.00]
    ], 16);
    const foreProx = configureViewMesh(new THREE.Mesh(foreProxGeo, mats.sleeveMat));
    lower.add(foreProx);

    // Distal forearm twist node (absorbs 55% of wrist pronation smoothly!)
    const foreTwist = new THREE.Group();
    foreTwist.name = side > 0 ? 'FP_RightForeArmTwist' : 'FP_LeftForeArmTwist';
    foreTwist.position.set(0, L2 * 0.46, 0);
    lower.add(foreTwist);

    const foreDistLen = L2 * 0.54;
    const foreDistGeo = buildSculptedSleeveLathe(foreDistLen, [
        [0.042, 0.00],
        [0.040, 0.28],
        [0.043, 0.46],
        [0.036, 0.72],
        [0.035, 0.86],
        [0.030, 1.00]
    ], 16);
    const foreDist = configureViewMesh(new THREE.Mesh(foreDistGeo, mats.sleeveMat));
    foreTwist.add(foreDist);

    // Reinforced sleeve cuff band
    const sleeveCuff = configureViewMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.0315, 0.0345, 0.034, 16),
        mats.cuffMat
    ));
    sleeveCuff.position.set(0, foreDistLen - 0.022, 0);
    foreTwist.add(sleeveCuff);

    // Hand mounted cleanly at distal end of forearm (L2)
    const { hand, fingers } = buildHandAssembly(side, mats);
    hand.position.set(0, L2, 0);
    lower.add(hand);

    return {
        side,
        upper,
        lower,
        foreTwist,
        hand,
        fingers,
        upperLen: L1,
        lowerLen: L2
    };
}

export function poseTacticalFingers(arm, mode, triggerSqueeze = 0) {
    if (!arm || !arm.fingers) return;
    const { fingers, side } = arm;
    const isRight = side > 0;
    const sq = Math.max(0, Math.min(1, triggerSqueeze));

    const setF = (f, a1, a2, a3, splayAdd = 0) => {
        if (!f) return;
        f.j1.rotation.set(a1, 0, (f.baseSplay || 0) + splayAdd);
        f.j2.rotation.set(a2, 0, 0);
        f.j3.rotation.set(a3, 0, 0);
    };

    if (isRight) {
        // Right hand pistol-grip wrap with live trigger-finger pull
        setF(fingers.index,  0.24 + sq * 0.24, 0.62 + sq * 0.42, 0.48 + sq * 0.34, side * 0.04);
        setF(fingers.middle, 1.12, 1.24, 0.72, 0);
        setF(fingers.ring,   1.16, 1.26, 0.74, 0);
        setF(fingers.pinky,  1.18, 1.22, 0.70, 0);

        // Thumb wraps snugly across backstrap/left receiver
        fingers.thumbRoot.rotation.set(0.36, -0.62, 0.68);
        fingers.thumb.j1.rotation.set(0.28, -0.22, 0.38);
        fingers.thumb.j2.rotation.set(0.46, 0, 0);
        fingers.thumb.j3.rotation.set(0.32, 0, 0);
        return;
    }

    // Left hand tactical modes
    if (mode === 'CCLAMP') {
        // Authentic spec-ops C-Clamp around rifle handguard
        setF(fingers.index,  0.86, 1.04, 0.66, -0.05);
        setF(fingers.middle, 0.94, 1.12, 0.70, -0.02);
        setF(fingers.ring,   1.02, 1.16, 0.72, 0.01);
        setF(fingers.pinky,  1.08, 1.14, 0.68, 0.04);

        // Thumb hooks high and over top-left of rail/handguard
        fingers.thumbRoot.rotation.set(0.18, 0.42, -0.34);
        fingers.thumb.j1.rotation.set(0.22, 0.26, -0.32);
        fingers.thumb.j2.rotation.set(0.34, 0, 0);
        fingers.thumb.j3.rotation.set(0.22, 0, 0);
    } else if (mode === 'RPG_GRIP') {
        // Vertical forward pistol-grip wrap for RPG-7
        setF(fingers.index,  1.08, 1.22, 0.72, 0);
        setF(fingers.middle, 1.14, 1.24, 0.74, 0);
        setF(fingers.ring,   1.18, 1.24, 0.72, 0);
        setF(fingers.pinky,  1.16, 1.18, 0.68, 0);

        fingers.thumbRoot.rotation.set(0.38, 0.60, -0.64);
        fingers.thumb.j1.rotation.set(0.30, 0.20, -0.36);
        fingers.thumb.j2.rotation.set(0.45, 0, 0);
        fingers.thumb.j3.rotation.set(0.30, 0, 0);
    } else if (mode === 'MAG') {
        // Magazine grasp during tactical/dry reload & mag-check
        setF(fingers.index,  0.96, 1.08, 0.64, -0.03);
        setF(fingers.middle, 1.02, 1.12, 0.66, 0);
        setF(fingers.ring,   1.06, 1.12, 0.66, 0);
        setF(fingers.pinky,  1.04, 1.06, 0.62, 0.03);

        fingers.thumbRoot.rotation.set(0.42, 0.56, -0.58);
        fingers.thumb.j1.rotation.set(0.26, 0.18, -0.28);
        fingers.thumb.j2.rotation.set(0.36, 0, 0);
        fingers.thumb.j3.rotation.set(0.22, 0, 0);
    } else {
        // BOLT rack / charging handle hook
        setF(fingers.index,  0.64, 1.28, 0.88, -0.04);
        setF(fingers.middle, 0.78, 1.22, 0.82, 0);
        setF(fingers.ring,   1.22, 1.28, 0.74, 0);
        setF(fingers.pinky,  1.26, 1.24, 0.72, 0);

        fingers.thumbRoot.rotation.set(0.32, 0.45, -0.44);
        fingers.thumb.j1.rotation.set(0.28, 0.12, -0.22);
        fingers.thumb.j2.rotation.set(0.35, 0, 0);
        fingers.thumb.j3.rotation.set(0.20, 0, 0);
    }
}

export function createProceduralTacticalArms(faction = 'RU') {
    const mats = buildMaterials(faction);
    const root = new THREE.Group();
    root.name = 'fp_arms_rig';

    const right = buildSingleArm(+1, faction, mats);
    const left = buildSingleArm(-1, faction, mats);

    // Anatomical shoulder width (~37 cm apart in viewmodel scale)
    right.upper.position.set(0.185, 0.0, 0.0);
    left.upper.position.set(-0.185, 0.0, 0.0);

    root.add(right.upper, left.upper);

    // Subtle local fill light attached to camera rig so tactical gloves & rifle details read crisply in shadows
    const fillLight = new THREE.PointLight(0xdce6f2, 0.42, 1.35, 2.0);
    fillLight.position.set(0.04, 0.18, 0.08);
    root.add(fillLight);

    poseTacticalFingers(right, 'GRIP', 0);
    poseTacticalFingers(left, 'CCLAMP', 0);

    return {
        root,
        right,
        left,
        materials: mats
    };
}
