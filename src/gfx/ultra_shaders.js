import * as THREE from 'three';

export const SHADER_PRESETS = Object.freeze({
    bodycam: Object.freeze({
        exposure: 1.16,
        bloomStrength: 0.40,
        bloomRadius: 0.60,
        bloomThreshold: 0.82,
        sharpen: 0.36,
        godRayStrength: 0.24,
        anamorphicStrength: 0.14,
        vignette: 0.38,
        grain: 0.032,
        saturation: 0.96,
        contrast: 1.04,
        chroma: 0.0014,
        distort: 0.022,
        shadowTint: [0.95, 0.98, 1.04],
        highlightTint: [1.05, 1.01, 0.94]
    }),
    cinematic: Object.freeze({
        exposure: 1.20,
        bloomStrength: 0.48,
        bloomRadius: 0.66,
        bloomThreshold: 0.78,
        sharpen: 0.30,
        godRayStrength: 0.30,
        anamorphicStrength: 0.18,
        vignette: 0.32,
        grain: 0.022,
        saturation: 1.05,
        contrast: 1.06,
        chroma: 0.0010,
        distort: 0.012,
        shadowTint: [0.93, 0.97, 1.05],
        highlightTint: [1.07, 1.01, 0.92]
    })
});

export function computePostFxParams(qualityPreset, styleName = 'bodycam') {
    const base = SHADER_PRESETS[styleName] || SHADER_PRESETS.bodycam;
    const tier = qualityPreset || 'high';
    const isUltra = tier === 'ultra';
    const isHigh = tier === 'high';
    const isMed = tier === 'medium';

    return {
        exposure: base.exposure,
        bloomStrength: isUltra ? base.bloomStrength * 1.10 : base.bloomStrength,
        bloomRadius: base.bloomRadius,
        bloomThreshold: base.bloomThreshold,
        sharpen: isUltra ? base.sharpen : (isHigh ? base.sharpen * 0.85 : base.sharpen * 0.65),
        godRayStrength: isUltra ? base.godRayStrength : (isHigh ? base.godRayStrength * 0.78 : (isMed ? base.godRayStrength * 0.45 : 0)),
        anamorphicStrength: isUltra ? base.anamorphicStrength : (isHigh ? base.anamorphicStrength * 0.75 : 0),
        vignette: base.vignette,
        grain: isUltra || isHigh ? base.grain : (isMed ? base.grain * 0.7 : 0),
        saturation: base.saturation,
        contrast: base.contrast,
        chroma: isUltra || isHigh ? base.chroma : base.chroma * 0.6,
        distort: isUltra || isHigh ? base.distort : base.distort * 0.6,
        ssaoEnabled: isUltra,
        shadowTint: base.shadowTint,
        highlightTint: base.highlightTint
    };
}

const _sunWorld = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _ndc = new THREE.Vector3();

export function projectSunToScreen(camera, sunDirection, out = { x: 0.5, y: 0.5, visibility: 0 }) {
    if (!camera || !sunDirection) {
        out.x = 0.5;
        out.y = 0.5;
        out.visibility = 0;
        return out;
    }

    camera.getWorldDirection(_camForward);
    const dot = _camForward.dot(sunDirection);
    if (dot <= 0.05) {
        out.x = 0.5;
        out.y = 0.5;
        out.visibility = 0;
        return out;
    }

    camera.getWorldPosition(_sunWorld).addScaledVector(sunDirection, 400);
    _ndc.copy(_sunWorld).project(camera);

    const sx = _ndc.x * 0.5 + 0.5;
    const sy = _ndc.y * 0.5 + 0.5;
    const edgeDist = Math.hypot(sx - 0.5, sy - 0.5);
    const edgeFade = Math.max(0, Math.min(1, 1.0 - Math.max(0, edgeDist - 0.55) / 0.65));
    const facingFade = Math.max(0, Math.min(1, (dot - 0.05) / 0.55));

    out.x = sx;
    out.y = sy;
    out.visibility = edgeFade * facingFade;
    return out;
}

export const ULTRA_SKY_VERTEX = `
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 clip = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
    gl_Position = clip.xyww;
}`;

export const ULTRA_SKY_FRAGMENT = `
uniform vec3 uZenith;
uniform vec3 uMidSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;

float hash21( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
}

float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
        mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), u.x ),
        mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), u.x ),
        u.y
    );
}

float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.52;
    mat2 rot = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 5; i++ ) {
        v += a * vnoise( p );
        p = rot * p * 2.07 + vec2( 13.7, 7.3 );
        a *= 0.49;
    }
    return v;
}

void main() {
    vec3 d = normalize( vDir );
    float up = max( d.y, 0.0 );
    float sunCos = max( dot( d, uSunDir ), 0.0 );

    // Rayleigh-inspired vertical atmosphere gradient
    float midBand = pow( 1.0 - up, 2.2 );
    float horBand = pow( 1.0 - up, 7.5 );
    vec3 skyCol = mix( uZenith, uMidSky, midBand );
    skyCol = mix( skyCol, uHorizon, horBand );

    // Layered Mie scattering corona + compact blazing solar core
    float mieBroad = pow( sunCos, 4.0 ) * 0.26;
    float mieMid   = pow( sunCos, 22.0 ) * 0.46;
    float mieTight = pow( sunCos, 160.0 ) * 1.35;
    float sunDisc  = smoothstep( 0.99945, 0.99985, sunCos ) * 4.2;
    float horizonWarmth = pow( sunCos, 2.5 ) * pow( 1.0 - up, 3.8 ) * 0.34;
    vec3 warmCorona = mix( uSunColor, vec3( 1.0, 0.82, 0.52 ), 0.45 );
    skyCol += warmCorona * ( mieBroad + mieMid + horizonWarmth ) + vec3( 1.0, 0.96, 0.88 ) * ( mieTight + sunDisc );

    // Volumetric multi-octave drifting clouds with sunlit silver-lining and cool undersides
    #ifdef SKY_CLOUDS
        if ( d.y > 0.005 ) {
            vec2 wind = vec2( uTime * 0.0055, uTime * 0.0022 );
            vec2 cp = d.xz / ( up + 0.16 ) * 0.82 + wind;
            float baseNoise = fbm( cp );
            float detailNoise = fbm( cp * 2.4 - wind * 1.8 );
            float density = smoothstep( 0.43, 0.79, baseNoise * 0.72 + detailNoise * 0.28 );

            vec2 sunStep = uSunDir.xz / ( max( uSunDir.y, 0.18 ) + 0.16 ) * 0.09;
            float litSample = fbm( cp + sunStep );
            float selfShadow = clamp( 1.0 - ( litSample - baseNoise ) * 2.7, 0.30, 1.0 );

            float horizonFade = smoothstep( 0.015, 0.24, d.y );
            float cloudMask = density * horizonFade * 0.86;

            vec3 cloudDark = mix( uZenith * 0.58, uHorizon * 0.70, 0.45 );
            vec3 cloudLit = mix( vec3( 0.93, 0.95, 0.98 ), uSunColor * 1.18, 0.42 + 0.42 * pow( sunCos, 3.0 ) );
            float silverLining = pow( sunCos, 9.0 ) * ( 1.0 - density * 0.55 ) * 0.68;
            vec3 cloudCol = mix( cloudDark, cloudLit, selfShadow ) + warmCorona * silverLining;

            skyCol = mix( skyCol, cloudCol, cloudMask );
        }
    #endif

    // Distant hazy steppe ridge & treeline silhouette along the horizon
    float az = atan( d.z, d.x );
    float ridge1 = ( vnoise( vec2( az * 4.5, 1.3 ) ) * 0.022 + vnoise( vec2( az * 13.0, 4.7 ) ) * 0.008 );
    float ridge2 = vnoise( vec2( az * 29.0, 9.1 ) ) * 0.0055;
    float ridgeH = ridge1 + ridge2 - 0.004;
    if ( d.y < ridgeH && d.y > -0.06 ) {
        float ridgeMask = smoothstep( ridgeH, ridgeH - 0.0045, d.y );
        vec3 distantTint = mix( uHorizon * 0.68, uGround * 1.18, 0.48 );
        distantTint += warmCorona * pow( sunCos, 4.0 ) * 0.15;
        skyCol = mix( skyCol, distantTint, ridgeMask * 0.78 );
    }

    // Ground hemisphere bounce blend
    skyCol = mix( skyCol, uGround, smoothstep( 0.0, -0.18, d.y ) );

    gl_FragColor = vec4( skyCol, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export const ULTRA_POSTFX_SHADER = {
    name: 'UltraBodycamCinematicShader',
    uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1280, 720) },
        uTime: { value: 0 },
        uSunScreenPos: { value: new THREE.Vector2(0.5, 0.75) },
        uSunVisible: { value: 0 },
        uGodRayStrength: { value: 0.24 },
        uAnamorphicStrength: { value: 0.14 },
        uSharpen: { value: 0.36 },
        uVignette: { value: 0.38 },
        uGrain: { value: 0.032 },
        uSaturation: { value: 0.96 },
        uContrast: { value: 1.04 },
        uChroma: { value: 0.0014 },
        uDistort: { value: 0.022 },
        uFlash: { value: 0 },
        uTrauma: { value: 0 },
        uShadowTint: { value: new THREE.Vector3(0.95, 0.98, 1.04) },
        uHighlightTint: { value: new THREE.Vector3(1.05, 1.01, 0.94) }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform vec2 uSunScreenPos;
        uniform float uSunVisible;
        uniform float uGodRayStrength;
        uniform float uAnamorphicStrength;
        uniform float uSharpen;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uChroma;
        uniform float uDistort;
        uniform float uFlash;
        uniform float uTrauma;
        uniform vec3 uShadowTint;
        uniform vec3 uHighlightTint;
        varying vec2 vUv;

        float hash12( vec2 p ) {
            vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
            p3 += dot( p3, p3.yzx + 33.33 );
            return fract( ( p3.x + p3.y ) * p3.z );
        }

        float luma( vec3 c ) {
            return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        }

        vec3 sampleChromatic( vec2 uv, vec2 caOff ) {
            float r = texture2D( tDiffuse, clamp( uv + caOff, 0.001, 0.999 ) ).r;
            float g = texture2D( tDiffuse, clamp( uv, 0.001, 0.999 ) ).g;
            float b = texture2D( tDiffuse, clamp( uv - caOff, 0.001, 0.999 ) ).b;
            return vec3( r, g, b );
        }

        void main() {
            vec2 p = vUv - 0.5;
            float distSq = dot( p, p );
            vec2 texel = 1.0 / max( uResolution, vec2( 1.0 ) );

            float shockDist = uDistort + uTrauma * 0.04;
            vec2 warpedUv = 0.5 + p * ( 1.0 + shockDist * distSq );
            vec2 caOffset = p * distSq * ( uChroma * 3.6 + uFlash * 0.010 + uTrauma * 0.014 );

            vec3 col = sampleChromatic( warpedUv, caOffset );

            // FidelityFX-inspired Contrast-Adaptive Sharpening (CAS) in HDR linear space
            if ( uSharpen > 0.001 ) {
                vec3 n = texture2D( tDiffuse, clamp( warpedUv + vec2( 0.0, texel.y ), 0.001, 0.999 ) ).rgb;
                vec3 s = texture2D( tDiffuse, clamp( warpedUv - vec2( 0.0, texel.y ), 0.001, 0.999 ) ).rgb;
                vec3 e = texture2D( tDiffuse, clamp( warpedUv + vec2( texel.x, 0.0 ), 0.001, 0.999 ) ).rgb;
                vec3 w = texture2D( tDiffuse, clamp( warpedUv - vec2( texel.x, 0.0 ), 0.001, 0.999 ) ).rgb;
                vec3 mn = min( col, min( min( n, s ), min( e, w ) ) );
                vec3 mx = max( col, max( max( n, s ), max( e, w ) ) );
                vec3 amp = clamp( min( mn, max( vec3( 0.0 ), 2.0 - mx ) ) / max( mx, vec3( 1e-4 ) ), 0.0, 1.0 );
                amp = sqrt( amp );
                vec3 wgt = amp * ( -0.12 * uSharpen );
                vec3 sharp = ( col + ( n + s + e + w ) * wgt ) / max( vec3( 0.001 ), 1.0 + 4.0 * wgt );
                col = max( vec3( 0.0 ), sharp );
            }

            // Screen-space radial volumetric sun shafts (God Rays)
            if ( uGodRayStrength > 0.001 && uSunVisible > 0.005 ) {
                vec2 rayVec = ( warpedUv - uSunScreenPos );
                float rayDist = length( rayVec );
                if ( rayDist < 1.15 ) {
                    vec2 stepUv = rayVec * ( 0.85 / 10.0 );
                    float jitter = hash12( gl_FragCoord.xy + fract( uTime ) * 97.0 );
                    vec2 sampleUv = warpedUv - stepUv * jitter;
                    vec3 shafts = vec3( 0.0 );
                    float decay = 1.0;
                    for ( int i = 0; i < 10; i++ ) {
                        sampleUv -= stepUv;
                        vec3 tap = texture2D( tDiffuse, clamp( sampleUv, 0.001, 0.999 ) ).rgb;
                        float bright = smoothstep( 0.65, 1.45, luma( tap ) );
                        shafts += tap * bright * decay;
                        decay *= 0.84;
                    }
                    float radialAtten = smoothstep( 1.15, 0.0, rayDist );
                    col += shafts * ( 0.088 * uGodRayStrength * uSunVisible * radialAtten ) * vec3( 1.05, 0.94, 0.78 );
                }
            }

            // Subtle horizontal anamorphic streak on intense HDR highlights
            if ( uAnamorphicStrength > 0.001 ) {
                vec3 streak = vec3( 0.0 );
                for ( int i = -3; i <= 3; i++ ) {
                    if ( i == 0 ) continue;
                    vec2 off = vec2( float( i ) * texel.x * 7.5, 0.0 );
                    vec3 tap = texture2D( tDiffuse, clamp( warpedUv + off, 0.001, 0.999 ) ).rgb;
                    float hi = max( 0.0, luma( tap ) - 0.98 );
                    streak += tap * hi * ( 1.0 - abs( float( i ) ) * 0.22 );
                }
                col += streak * ( 0.052 * uAnamorphicStrength * ( 1.0 + uFlash * 2.5 ) ) * vec3( 0.88, 0.95, 1.12 );
            }

            gl_FragColor = vec4( col, 1.0 );
            #include <tonemapping_fragment>
            #include <colorspace_fragment>

            vec3 c = gl_FragColor.rgb;

            // Preserve deep armor shadow legibility while applying cinematic split-tone grading
            c = pow( max( c, vec3( 0.0 ) ), vec3( 0.95 ) );

            // Muzzle flash & explosion dynamic exposure kick
            c *= 1.0 + uFlash * 0.45;
            c += vec3( 1.0, 0.84, 0.58 ) * uFlash * 0.08;

            // Gentle filmic split-toning & contrast without crushing dark vehicles
            float y = luma( c );
            vec3 splitTone = mix( uShadowTint, uHighlightTint, smoothstep( 0.14, 0.80, y ) );
            c *= splitTone;
            c = clamp( ( c - 0.5 ) * uContrast + 0.5, 0.0, 1.0 );

            // Tactical color saturation
            float y2 = luma( c );
            c = mix( vec3( y2 ), c, uSaturation );

            // Optical lens vignette + dynamic concussion darkening
            float vigAmt = uVignette + uTrauma * 0.22;
            c *= 1.0 - vigAmt * smoothstep( 0.22, 1.0, distSq * 1.95 );

            // Animated shadow-weighted organic sensor grain
            if ( uGrain > 0.001 ) {
                float n = hash12( gl_FragCoord.xy + fract( uTime ) * 311.7 ) - 0.5;
                c += n * uGrain * ( 1.0 - 0.55 * y2 );
            }

            gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
        }`
};

export function enhanceGroundMaterialShader(material) {
    if (!material) return material;
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `
                #include <common>
                varying vec3 vGroundWorldPos;
            `)
            .replace('#include <worldpos_vertex>', `
                #include <worldpos_vertex>
                vGroundWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
            `);

        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `
                #include <common>
                varying vec3 vGroundWorldPos;

                float gHash( vec2 p ) {
                    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
                    p3 += dot( p3, p3.yzx + 33.33 );
                    return fract( ( p3.x + p3.y ) * p3.z );
                }

                float gNoise( vec2 p ) {
                    vec2 i = floor( p );
                    vec2 f = fract( p );
                    vec2 u = f * f * ( 3.0 - 2.0 * f );
                    return mix(
                        mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                        mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), u.x ),
                        u.y
                    );
                }

                float computePuddleField( vec2 wp ) {
                    float m1 = gNoise( wp * 0.048 );
                    float m2 = gNoise( wp * 0.15 + vec2( 11.4, -7.2 ) );
                    return m1 * 0.64 + m2 * 0.36;
                }
            `)
            .replace('#include <map_fragment>', `
                vec2 wp = vGroundWorldPos.xz;
                vec3 groundNear = texture2D( map, vMapUv ).rgb;
                vec3 groundMid  = texture2D( map, mat2( 0.8, 0.6, -0.6, 0.8 ) * vMapUv * 0.31 ).rgb;
                vec3 groundFar  = texture2D( map, mat2( -0.5, 0.866, -0.866, -0.5 ) * vMapUv * 0.075 ).rgb;
                float camDist   = length( vGroundWorldPos - cameraPosition );
                float distBlend = smoothstep( 18.0, 110.0, camDist );

                vec3 blended = mix( mix( groundNear, groundMid, 0.42 ), groundFar, distBlend * 0.48 );

                float macro1 = gNoise( wp * 0.048 );
                float micro  = gNoise( wp * 2.8 ) * 0.14 - 0.07;

                // Subtle armored track ruts along proving ground road corridors
                float laneDist = abs( abs( wp.x ) - 9.0 );
                float trackMask = smoothstep( 1.6, 0.15, laneDist ) * smoothstep( 80.0, 10.0, abs( wp.y ) ) * 0.35;

                // Selective rainwater mud puddles in shallow depressions
                float puddleField = computePuddleField( wp );
                float dampRing = smoothstep( 0.68, 0.74, puddleField );
                float puddleCore = smoothstep( 0.745, 0.785, puddleField );

                blended *= clamp( 0.84 + 0.34 * macro1 + micro, 0.74, 1.20 );
                blended = mix( blended, blended * vec3( 0.78, 0.74, 0.68 ), trackMask );
                blended = mix( blended, blended * vec3( 0.54, 0.52, 0.50 ), dampRing * 0.70 );
                blended = mix( blended, blended * vec3( 0.48, 0.50, 0.52 ), puddleCore * 0.45 );

                diffuseColor.rgb *= blended;
            `)
            .replace('#include <roughnessmap_fragment>', `
                #include <roughnessmap_fragment>
                float pFieldR = computePuddleField( vGroundWorldPos.xz );
                float pDampR  = smoothstep( 0.68, 0.74, pFieldR );
                float pCoreR  = smoothstep( 0.745, 0.785, pFieldR );
                roughnessFactor = mix( roughnessFactor, 0.56, pDampR );
                roughnessFactor = mix( roughnessFactor, 0.06, pCoreR );
            `)
            .replace('#include <normal_fragment_maps>', `
                #include <normal_fragment_maps>
                float pFieldN = computePuddleField( vGroundWorldPos.xz );
                float pCoreN  = smoothstep( 0.74, 0.785, pFieldN );
                normal = normalize( mix( normal, normalize( vNormal ), pCoreN * 0.94 ) );
            `);
    };
    material.customProgramCacheKey = () => 'ultra_ground_pbr_v2';
    material.needsUpdate = true;
    return material;
}

export function createInstancedSteppeGrass(scene, count = 3200) {
    // Organic fanned multi-blade steppe meadow tuft (6 slender arching blades per clump)
    const blades = 6;
    const positions = [];
    const normals = [];
    const indices = [];

    for (let b = 0; b < blades; b++) {
        const ang = (b / blades) * Math.PI * 2 + (b % 2) * 0.31;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const px = -sa;
        const pz = ca;

        const baseOffset = 0.03 + (b % 3) * 0.025;
        const bx = ca * baseOffset;
        const bz = sa * baseOffset;

        const hw = 0.019;
        const h = 0.14 + ((b * 37) % 10) * 0.011;
        const lean = 0.06 + (b % 3) * 0.035;
        const base = positions.length / 3;

        positions.push(bx - hw * px, 0, bz - hw * pz);
        positions.push(bx + hw * px, 0, bz + hw * pz);
        positions.push(bx + ca * lean * 0.45 + hw * 0.6 * px, h * 0.55, bz + sa * lean * 0.45 + hw * 0.6 * pz);
        positions.push(bx + ca * lean * 0.45 - hw * 0.6 * px, h * 0.55, bz + sa * lean * 0.45 - hw * 0.6 * pz);
        positions.push(bx + ca * lean, h, bz + sa * lean);

        for (let k = 0; k < 5; k++) normals.push(0, 1, 0);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 3, base + 2, base + 4);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const windUniform = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.86,
        metalness: 0.0,
        envMapIntensity: 1.0,
        side: THREE.DoubleSide
    });
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = windUniform;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `
                #include <common>
                uniform float uWindTime;
                varying float vBladeH;
            `)
            .replace('#include <begin_vertex>', `
                #include <begin_vertex>
                vBladeH = clamp( position.y / 0.24, 0.0, 1.0 );
                vec4 instPos = instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
                float sway = sin( uWindTime * 1.9 + instPos.x * 0.35 + instPos.z * 0.28 ) * 0.055
                           + sin( uWindTime * 3.5 + instPos.x * 0.85 ) * 0.018;
                transformed.x += sway * vBladeH * vBladeH;
                transformed.z += sway * 0.55 * vBladeH * vBladeH;
            `);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `
                #include <common>
                varying float vBladeH;
            `)
            .replace('#include <color_fragment>', `
                #include <color_fragment>
                diffuseColor.rgb *= mix( vec3( 0.62, 0.65, 0.50 ), vec3( 1.28, 1.24, 0.96 ), vBladeH );
            `);
    };

    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.name = 'ultra_steppe_grass';
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;

    let seed = 77341;
    const rng = () => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return seed / 4294967296;
    };

    // Place tufts in natural clustered patches rather than uniform isolated pins
    const clusterCenters = [];
    for (let c = 0; c < 130; c++) {
        const cr = 7 + Math.sqrt(rng()) * 88;
        const ca = rng() * Math.PI * 2;
        clusterCenters.push([Math.cos(ca) * cr, Math.sin(ca) * cr, 1.4 + rng() * 4.2]);
    }

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 5) {
        guard++;
        const cl = clusterCenters[Math.floor(rng() * clusterCenters.length)];
        const offR = Math.sqrt(rng()) * cl[2];
        const offA = rng() * Math.PI * 2;
        const x = cl[0] + Math.cos(offA) * offR;
        const z = cl[1] + Math.sin(offA) * offR;

        // Keep player spawn area, vehicle lineup pads, and concrete ramps completely clear
        if (Math.hypot(x, z - 16) < 4.5) continue;
        if (Math.abs(z - 12) < 4.8 && Math.abs(x) < 33) continue;
        if (z > -10.5 && z < 0.5 && Math.abs(x) < 23) continue;
        if (Math.abs(z + 24) < 2.2 && Math.abs(x) < 24) continue;
        if (Math.abs(z + 29) < 3.0 && Math.abs(x) < 22) continue;

        dummy.position.set(x, 0, z);
        dummy.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
        const s = 0.78 + rng() * 0.68;
        dummy.scale.set(s * (0.9 + rng() * 0.3), s * (0.8 + rng() * 0.45), s * (0.9 + rng() * 0.3));
        dummy.updateMatrix();
        inst.setMatrixAt(placed, dummy.matrix);

        // Natural sunlit olive-green & dry steppe straw hues (bright enough to read as real grass, not black spikes)
        const hue = 0.155 + rng() * 0.085;
        const sat = 0.28 + rng() * 0.18;
        const lit = 0.42 + rng() * 0.16;
        col.setHSL(hue, sat, lit);
        inst.setColorAt(placed, col);
        placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();

    if (scene) scene.add(inst);
    return {
        mesh: inst,
        update(time) {
            windUniform.value = time;
        }
    };
}
