import * as THREE from 'three';
import { STATS } from '../../stats.js';
import { createGroundMaterial, createGroundApronGeometry } from './environment.js';

export const provingGroundMethods = {
    setupLighting() {
        this.hemiLight = new THREE.HemisphereLight(0x9fc7ec, 0x584c3e, 0.95);
        this.hemiLight.position.set(0, 70, 0);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xffe0b2, 2.75);
        this.sunLight.position.set(95, 42, -85);
        this.sunLight.castShadow = true;
        const shadow = this.sunLight.shadow;
        shadow.mapSize.set(2048, 2048);
        shadow.camera.near = 1.0;
        shadow.camera.far = 300;
        const d = 105;
        shadow.camera.left = -d;
        shadow.camera.right = d;
        shadow.camera.top = d;
        shadow.camera.bottom = -d;
        shadow.bias = -0.0004;
        shadow.normalBias = 0.025;
        shadow.radius = 2.8;
        this.scene.add(this.sunLight);

        this.rimLight = new THREE.DirectionalLight(0x94bde8, 0.95);
        this.rimLight.position.set(-80, 34, 72);
        this.rimLight.castShadow = false;
        this.scene.add(this.rimLight);
    },

    buildCleanPolygonFloorAndRamps() {
        const groundMat = createGroundMaterial(this);
        this.groundMaterial = groundMat;
        const floorGeo = new THREE.PlaneGeometry(600, 600);
        floorGeo.rotateX(-Math.PI / 2);
        const floorMesh = new THREE.Mesh(floorGeo, groundMat);
        floorMesh.receiveShadow = true;
        floorMesh.userData.surface = 'dirt';
        this.provingGroundGroup.add(floorMesh);
        this.octree.fromGraphNode(floorMesh);
        this.staticShootableMeshes.push(floorMesh);

        const apron = new THREE.Mesh(createGroundApronGeometry(), groundMat);
        apron.receiveShadow = true;
        this.provingGroundGroup.add(apron);

        const gridHelper = new THREE.GridHelper(240, 120, 0x626b5c, 0x494f44);
        gridHelper.position.y = 0.01;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.22;
        gridHelper.material.depthWrite = false;
        gridHelper.visible = false;
        this.debugGrid = gridHelper;
        this.provingGroundGroup.add(gridHelper);

        const bumpPositions = [
            { x: -18, z: -2, w: 6.0, h: 0.38, d: 2.2 },
            { x: -9,  z: -2, w: 6.0, h: 0.35, d: 2.0 },
            { x: 0,   z: -2, w: 6.0, h: 0.35, d: 2.0 },
            { x: 9,   z: -2, w: 6.0, h: 0.38, d: 2.2 },
            { x: -9,  z: -8, w: 6.0, h: 0.42, d: 2.4 },
            { x: 0,   z: -8, w: 6.0, h: 0.42, d: 2.4 }
        ];
        const concCanvas = document.createElement('canvas');
        concCanvas.width = 256;
        concCanvas.height = 256;
        const cctx = concCanvas.getContext('2d');
        cctx.fillStyle = '#7e7d74';
        cctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 4200; i++) {
            const x = (i * 73 + (i >> 3) * 19) % 256;
            const y = (i * 137 + (i >> 2) * 31) % 256;
            const v = 88 + ((i * 41) % 62);
            cctx.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
            cctx.fillRect(x, y, 3, 3);
        }
        // Dark weathered mud stains & slab expansion seams
        cctx.fillStyle = 'rgba(52,48,40,0.28)';
        cctx.fillRect(0, 0, 256, 18);
        cctx.fillRect(0, 238, 256, 18);
        cctx.strokeStyle = 'rgba(34,36,32,0.72)';
        cctx.lineWidth = 3;
        for (let x = 64; x < 256; x += 64) {
            cctx.beginPath();
            cctx.moveTo(x, 0);
            cctx.lineTo(x, 256);
            cctx.stroke();
        }
        cctx.strokeStyle = 'rgba(182,178,166,0.35)';
        cctx.lineWidth = 2;
        cctx.strokeRect(4, 4, 248, 248);

        const concTex = new THREE.CanvasTexture(concCanvas);
        concTex.colorSpace = THREE.SRGBColorSpace;
        concTex.wrapS = THREE.RepeatWrapping;
        concTex.wrapT = THREE.RepeatWrapping;
        concTex.repeat.set(2, 1);

        const rampMat = new THREE.MeshStandardMaterial({
            map: concTex,
            bumpMap: concTex,
            bumpScale: 0.055,
            roughness: 0.85,
            metalness: 0.04,
            envMapIntensity: 1.15
        });
        const rampVisual = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rampMat, bumpPositions.length);
        rampVisual.castShadow = true;
        rampVisual.receiveShadow = true;
        const colliderMat = new THREE.MeshBasicMaterial({ visible: false });
        const matrix = new THREE.Matrix4();
        bumpPositions.forEach((bp, i) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(bp.w, bp.h, bp.d), colliderMat);
            mesh.position.set(bp.x, bp.h * 0.5, bp.z);
            mesh.userData.surface = 'concrete';
            this.provingGroundGroup.add(mesh);
            this.octree.fromGraphNode(mesh);
            this.staticShootableMeshes.push(mesh);
            this.ragdollPhysics.addStaticBoxCollider(
                mesh.position,
                { x: bp.w * 0.5, y: bp.h * 0.5, z: bp.d * 0.5 }
            );
            rampVisual.setMatrixAt(i, matrix.makeScale(bp.w, bp.h, bp.d).setPosition(mesh.position));
        });
        rampVisual.computeBoundingSphere();
        this.provingGroundGroup.add(rampVisual);
    },

    addStaticObstacleCollider(obj3d, shrink = 0.85) {
        obj3d.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj3d);
        if (box.isEmpty()) return null;
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        if (size.x < 0.2 || size.y < 0.2 || size.z < 0.2) return null;

        const colMesh = new THREE.Mesh(
            new THREE.BoxGeometry(size.x * shrink, size.y * shrink, size.z * shrink),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        colMesh.position.copy(center);
        this.scene.add(colMesh);
        this.octree.fromGraphNode(colMesh);
        this.staticShootableMeshes.push(colMesh);

        const colliderHandle = this.ragdollPhysics.addStaticBoxCollider(
            center,
            { x: size.x * shrink * 0.5, y: size.y * shrink * 0.5, z: size.z * shrink * 0.5 }
        );
        obj3d.userData.colliderMesh = colMesh;
        obj3d.userData.colliderHandle = colliderHandle;
        return { colMesh, colliderHandle };
    },

    populateMilitaryLineupRows() {
        const armorRowKeys = [
            { key: 't90m_ru',    x: -27, z: 12, yaw: 0 },
            { key: 't72b3_ru',   x: -18, z: 12, yaw: 0 },
            { key: 'btr80_ru',   x: -9,  z: 12, yaw: 0 },
            { key: 'bmp2_ua',    x: 0,   z: 12, yaw: 0 },
            { key: 'bradley_ua', x: 9,   z: 12, yaw: 0 },
            { key: 'humvee_ua',  x: 18,  z: 12, yaw: 0 },
            { key: 'uaz452',     x: 27,  z: 12, yaw: 0 }
        ];

        for (const item of armorRowKeys) {
            const spec = STATS.VEHICLE_SPECS[item.key];
            const vMesh = this.instantiateStaticModel(spec.key, spec.span);
            this.scene.add(vMesh);
            const vObj = this.ragdollPhysics.createPhysicalVehicle(
                spec,
                vMesh,
                new THREE.Vector3(item.x, 0.0, item.z),
                item.yaw
            );
            if (vObj && vObj.hitProxyMesh) {
                this.staticShootableMeshes.push(vObj.hitProxyMesh);
            }
        }

        const standMat = new THREE.MeshStandardMaterial({ color: 0x2c343b, roughness: 0.7, metalness: 0.3 });
        const droneStandRow = [
            { key: 'drone_fpv',    span: 0.65, x: -10.0, z: 22.0 },
            { key: 'drone_fpv',    span: 0.65, x: -6.0,  z: 22.0 },
            { key: 'drone_lancet', span: 1.45, x: -2.0,  z: 22.0 },
            { key: 'drone_lancet', span: 1.45, x: 2.0,   z: 22.0 },
            { key: 'drone_mavic',  span: 0.52, x: 6.0,   z: 22.0 },
            { key: 'drone_mavic',  span: 0.52, x: 10.0,  z: 22.0 }
        ];
        for (const ds of droneStandRow) {
            const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), standMat);
            pedestal.position.set(ds.x, 0.45, ds.z);
            pedestal.castShadow = true;
            pedestal.receiveShadow = true;
            pedestal.userData.batchable = true;
            this.scene.add(pedestal);
            this.addStaticObstacleCollider(pedestal, 0.95);

            const dMesh = this.instantiateStaticModel(ds.key, ds.span);
            dMesh.position.set(ds.x, 0.92, ds.z);
            this.scene.add(dMesh);
        }

        const weaponStandRow = [
            { key: 'weapon_ak12',  span: 0.95, x: -8.0, z: 25.5 },
            { key: 'weapon_m4a1',  span: 0.92, x: -4.0, z: 25.5 },
            { key: 'weapon_ak74m', span: 0.95, x: 0.0,  z: 25.5 },
            { key: 'weapon_rpg7',  span: 1.15, x: 4.0,  z: 25.5 },
            { key: 'unit_javelin', span: 1.72, x: 8.0,  z: 25.5 }
        ];
        for (const ws of weaponStandRow) {
            if (ws.key === 'unit_javelin') {
                const jav = this.instantiateStaticModel(ws.key, ws.span);
                jav.position.set(ws.x, 0, ws.z);
                jav.rotation.y = Math.PI;
                this.scene.add(jav);
            } else {
                const rack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.7), standMat);
                rack.position.set(ws.x, 0.425, ws.z);
                rack.castShadow = true;
                rack.userData.batchable = true;
                this.scene.add(rack);
                const wMesh = this.instantiateStaticModel(ws.key, ws.span);
                wMesh.position.set(ws.x, 0.95, ws.z);
                wMesh.rotation.y = Math.PI * 0.5;
                this.scene.add(wMesh);
            }
        }

        for (let i = 0; i < 8; i++) {
            const xPos = -10.5 + i * 3.0;
            this.spawnSoldierUnit('RU', i, new THREE.Vector3(xPos, 0, 17.5), Math.PI, true);
        }

        const btrVehicle = this.ragdollPhysics.vehicles.find((v) => v.spec.key === 'btr80_ru');
        if (btrVehicle) {
            this.mountSquadOnVehicle(btrVehicle, 4);
        }

        const fortRowZ = -24.0;
        for (let i = -20; i <= 20; i += 5.0) {
            const dtMesh = this.instantiateStaticModel('dragons_teeth', 3.4);
            dtMesh.position.set(i, 0, fortRowZ);
            this.scene.add(dtMesh);
            this.addStaticObstacleCollider(dtMesh, 0.82);
        }

        const hescoRowCoords = [-18, -12, -6, 6, 12, 18];
        for (const hx of hescoRowCoords) {
            const hesco = this.instantiateStaticModel('hesco_bastion', 4.3);
            hesco.position.set(hx, 0, -29.0);
            this.scene.add(hesco);
            this.addStaticObstacleCollider(hesco, 0.88);
        }


        for (let i = 0; i < 12; i++) {
            const xPos = -22.0 + i * 4.0;
            this.spawnSoldierUnit('UA', i, new THREE.Vector3(xPos, 0, -31.5 - (i % 2) * 3.0), 0, false);
        }

        const enemyTargetVehicles = [
            { key: 'bmp2_ua',    x: -14, z: -42, yaw: 0 },
            { key: 'bradley_ua', x: 0,   z: -42, yaw: 0 },
            { key: 'humvee_ua',  x: 14,  z: -42, yaw: 0 }
        ];
        for (const ev of enemyTargetVehicles) {
            const spec = STATS.VEHICLE_SPECS[ev.key];
            const vMesh = this.instantiateStaticModel(spec.key, spec.span);
            this.scene.add(vMesh);
            const vObj = this.ragdollPhysics.createPhysicalVehicle(
                spec,
                vMesh,
                new THREE.Vector3(ev.x, 0.0, ev.z),
                ev.yaw
            );
            if (vObj && vObj.hitProxyMesh) {
                this.staticShootableMeshes.push(vObj.hitProxyMesh);
            }
        }

        this.spawnAutonomousDrones();
    }
};
