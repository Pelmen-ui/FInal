import * as THREE from 'three';
import {
    ULTRA_POSTFX_SHADER,
    computePostFxParams,
    projectSunToScreen
} from './ultra_shaders.js';

const _size = new THREE.Vector2();
const _sunProj = { x: 0.5, y: 0.5, visibility: 0 };

export function createPostFx(engine) {
    const renderer = engine.renderer;
    let lib = null;
    let libFailed = false;
    let composer = null;
    let renderPass = null;
    let ssaoPass = null;
    let bloomPass = null;
    let finalPass = null;
    let samples = -1;
    let bloomScale = 1;
    let width = 0;
    let height = 0;
    let pixelRatio = 0;
    let vignetteEl = null;
    let flashIntensity = 0;
    let styleName = 'bodycam';

    async function loadLib() {
        if (lib || libFailed) return lib;
        try {
            const [composerMod, renderMod, shaderMod, bloomMod] = await Promise.all([
                import('three/addons/postprocessing/EffectComposer.js'),
                import('three/addons/postprocessing/RenderPass.js'),
                import('three/addons/postprocessing/ShaderPass.js'),
                import('three/addons/postprocessing/UnrealBloomPass.js')
            ]);
            let SSAOPass = null;
            try {
                const ssaoMod = await import('three/addons/postprocessing/SSAOPass.js');
                SSAOPass = ssaoMod.SSAOPass || null;
            } catch {
                SSAOPass = null;
            }
            lib = {
                EffectComposer: composerMod.EffectComposer,
                RenderPass: renderMod.RenderPass,
                ShaderPass: shaderMod.ShaderPass,
                UnrealBloomPass: bloomMod.UnrealBloomPass,
                SSAOPass
            };
        } catch (err) {
            libFailed = true;
            console.warn('[postfx] post-processing unavailable:', err.message);
        }
        return lib;
    }

    function disposeComposer() {
        if (!composer) return;
        if (ssaoPass && ssaoPass.dispose) ssaoPass.dispose();
        if (bloomPass) bloomPass.dispose();
        if (finalPass) finalPass.dispose();
        composer.dispose();
        composer = null;
        renderPass = null;
        ssaoPass = null;
        bloomPass = null;
        finalPass = null;
    }

    function resize(force) {
        if (!composer) return;
        renderer.getSize(_size);
        const ratio = renderer.getPixelRatio();
        if (!force && _size.x === width && _size.y === height && ratio === pixelRatio) return;
        width = _size.x;
        height = _size.y;
        pixelRatio = ratio;
        composer.setPixelRatio(ratio);
        composer.setSize(width, height);
        if (ssaoPass && ssaoPass.setSize) ssaoPass.setSize(width * ratio, height * ratio);
        if (bloomPass && bloomScale !== 1) {
            bloomPass.setSize(width * ratio * bloomScale, height * ratio * bloomScale);
        }
        if (finalPass && finalPass.uniforms.uResolution) {
            finalPass.uniforms.uResolution.value.set(Math.max(1, width * ratio), Math.max(1, height * ratio));
        }
    }

    function buildComposer(wantSamples, params) {
        disposeComposer();
        const gl = renderer.getContext();
        const floatTarget = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
        const target = new THREE.WebGLRenderTarget(1, 1, {
            type: floatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
            samples: wantSamples
        });
        composer = new lib.EffectComposer(renderer, target);
        renderPass = new lib.RenderPass(engine.scene, engine.camera);
        composer.addPass(renderPass);

        if (lib.SSAOPass) {
            try {
                renderer.getSize(_size);
                ssaoPass = new lib.SSAOPass(engine.scene, engine.camera, Math.max(1, _size.x), Math.max(1, _size.y));
                ssaoPass.kernelRadius = 9;
                ssaoPass.minDistance = 0.003;
                ssaoPass.maxDistance = 0.075;
                ssaoPass.enabled = false;
                composer.addPass(ssaoPass);
            } catch {
                ssaoPass = null;
            }
        }

        bloomPass = new lib.UnrealBloomPass(
            new THREE.Vector2(256, 256),
            params.bloomStrength,
            params.bloomRadius,
            params.bloomThreshold
        );
        finalPass = new lib.ShaderPass(ULTRA_POSTFX_SHADER);
        composer.addPass(bloomPass);
        composer.addPass(finalPass);
        samples = wantSamples;
        resize(true);
    }

    function applyUniforms(fx, params) {
        renderer.toneMappingExposure = params.exposure;
        if (!finalPass) return;

        bloomPass.enabled = Boolean(fx.bloom);
        bloomPass.strength = params.bloomStrength;
        bloomPass.radius = params.bloomRadius;
        bloomPass.threshold = params.bloomThreshold;

        if (ssaoPass) {
            ssaoPass.enabled = Boolean(fx.ssao && params.ssaoEnabled);
        }

        const u = finalPass.uniforms;
        u.uSharpen.value = params.sharpen;
        u.uGodRayStrength.value = params.godRayStrength;
        u.uAnamorphicStrength.value = params.anamorphicStrength;
        u.uVignette.value = fx.vignette ? params.vignette : 0;
        u.uGrain.value = fx.grain ? params.grain : 0;
        u.uSaturation.value = params.saturation;
        u.uContrast.value = params.contrast;
        u.uChroma.value = fx.vignette ? params.chroma : 0;
        u.uDistort.value = fx.vignette ? params.distort : 0;
        u.uShadowTint.value.set(params.shadowTint[0], params.shadowTint[1], params.shadowTint[2]);
        u.uHighlightTint.value.set(params.highlightTint[0], params.highlightTint[1], params.highlightTint[2]);
    }

    function renderHook(r, scene, camera, dt) {
        if (!composer) {
            r.render(scene, camera);
            return;
        }
        resize(false);
        renderPass.scene = scene;
        renderPass.camera = camera;
        if (ssaoPass && ssaoPass.enabled) {
            ssaoPass.scene = scene;
            ssaoPass.camera = camera;
        }

        const u = finalPass.uniforms;
        u.uTime.value = (u.uTime.value + dt) % 64;
        if (flashIntensity > 0.001) {
            flashIntensity *= Math.exp(-15.0 * dt);
        } else {
            flashIntensity = 0;
        }
        u.uFlash.value = flashIntensity;

        const punch = engine.arms && typeof engine.arms.getCameraPunch === 'function'
            ? engine.arms.getCameraPunch()
            : null;
        u.uTrauma.value = punch ? Math.min(1, punch.trauma || 0) : 0;

        const sunDir = engine.environment && engine.environment.sunDirection;
        if (sunDir) {
            projectSunToScreen(camera, sunDir, _sunProj);
            u.uSunScreenPos.value.set(_sunProj.x, _sunProj.y);
            u.uSunVisible.value = _sunProj.visibility;
        } else {
            u.uSunVisible.value = 0;
        }

        r.info.reset();
        composer.render(dt);
    }

    function setHook(active) {
        if (active) {
            renderer.info.autoReset = false;
            window.BATTLE_ENGINE.setCustomRenderHook(renderHook);
        } else if (engine.customRenderHook === renderHook) {
            renderer.info.autoReset = true;
            window.BATTLE_ENGINE.setCustomRenderHook(null);
        }
    }

    async function applyQuality() {
        const profile = engine.quality.profile;
        const fx = profile.postfx;
        const params = computePostFxParams(engine.quality.preset, styleName);
        const wanted = !engine.isSoftwareGl && Boolean(fx.composer) && Boolean(await loadLib());
        if (engine.quality.profile !== profile) return;

        if (wanted) {
            const wantSamples = profile.msaa ? (fx.samples || 0) : 0;
            if (!composer || samples !== wantSamples) buildComposer(wantSamples, params);
            const scale = fx.bloomScale > 0 ? fx.bloomScale : 1;
            if (scale !== bloomScale) {
                bloomScale = scale;
                resize(true);
            }
            applyUniforms(fx, params);
        } else {
            disposeComposer();
            renderer.toneMappingExposure = params.exposure;
        }
        setHook(wanted);
        if (vignetteEl) vignetteEl.style.display = !wanted && fx.vignette ? 'block' : 'none';
    }

    function createVignetteOverlay() {
        const layer = engine.hudLayer;
        if (!layer) return;
        const style = document.createElement('style');
        style.textContent = '.gfx-vignette{position:absolute;inset:0;pointer-events:none;display:none;'
            + 'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 48%,rgba(8,12,18,0.48) 100%);}';
        document.head.appendChild(style);
        vignetteEl = document.createElement('div');
        vignetteEl.className = 'gfx-vignette';
        layer.insertBefore(vignetteEl, layer.firstChild);
    }

    return {
        name: 'postfx',
        get active() {
            return composer !== null;
        },

        getStyle() {
            return styleName;
        },

        setStyle(nextStyle) {
            styleName = nextStyle === 'cinematic' ? 'cinematic' : 'bodycam';
            const params = computePostFxParams(engine.quality.preset, styleName);
            applyUniforms(engine.quality.profile.postfx, params);
            return styleName;
        },

        triggerFlash(amount = 0.15) {
            flashIntensity = Math.min(1.0, Math.max(flashIntensity, amount));
        },

        async install() {
            createVignetteOverlay();
            await applyQuality();
            engine.events.on('quality:changed', () => { applyQuality(); });
        },

        onResize() {
            if (composer) resize(false);
        }
    };
}
