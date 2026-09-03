import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Screen-space post-processing pipeline. World settings drive an ordered list of enabled
// filter passes that sit between the scene render and the sRGB output pass.

const PIXELATE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelSize: { value: 4 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        uniform float uPixelSize;
        varying vec2 vUv;
        void main() {
            vec2 cells = max(uResolution / max(uPixelSize, 1.0), vec2(1.0));
            vec2 uv = (floor(vUv * cells) + 0.5) / cells;
            gl_FragColor = texture2D(tDiffuse, uv);
        }`
};

const SCANLINES_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uThickness: { value: 2.0 },
        uIntensity: { value: 0.3 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        uniform float uThickness;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            // Alternating bright/dark rows every uThickness screen pixels.
            float row = floor(vUv.y * uResolution.y / max(uThickness, 1.0));
            float scan = 1.0 - uIntensity * mod(row, 2.0);
            gl_FragColor = vec4(c.rgb * scan, c.a);
        }`
};

const CHROMATIC_ABERRATION_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uOffset: { value: 0.003 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uOffset;
        varying vec2 vUv;
        void main() {
            // Radial offset from center — stronger at edges, none at center.
            vec2 dir = vUv - 0.5;
            float r = texture2D(tDiffuse, vUv - dir * uOffset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv + dir * uOffset).b;
            float a = texture2D(tDiffuse, vUv).a;
            gl_FragColor = vec4(r, g, b, a);
        }`
};

// Metadata for the world panel UI — one entry per user-selectable filter type.
export const FILTER_TYPES = {
    pixelate: {
        label: 'Pixelate',
        defaults: { pixelSize: 4 },
        params: [
            { key: 'pixelSize', label: 'Pixel size', min: 1, max: 40, step: 1, precision: 0 }
        ]
    },
    scanlines: {
        label: 'Scanlines',
        defaults: { thickness: 2, intensity: 0.3 },
        params: [
            { key: 'thickness', label: 'Thickness', min: 1, max: 10, step: 1, precision: 0 },
            { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, precision: 2 }
        ]
    },
    chromaticAberration: {
        label: 'Chromatic aberration',
        defaults: { offset: 0.003 },
        params: [
            { key: 'offset', label: 'Offset', min: 0, max: 0.02, step: 0.0005, precision: 4 }
        ]
    }
};

function buildPass(type) {
    switch (type) {
        case 'pixelate':            return new ShaderPass(PIXELATE_SHADER);
        case 'scanlines':           return new ShaderPass(SCANLINES_SHADER);
        case 'chromaticAberration': return new ShaderPass(CHROMATIC_ABERRATION_SHADER);
        default: return null;
    }
}

// Wraps EffectComposer with the machinery needed to swap cameras per-frame and rebuild the
// filter chain on world changes without leaking passes/render targets.
export class PostFxPipeline {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.composer = new EffectComposer(renderer);
        this.renderPass = new RenderPass(scene, camera);
        this.outputPass = new OutputPass();
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.outputPass);
        this.filterPasses = [];
        // Reused width/height buffer for uResolution uniforms.
        this._size = new THREE.Vector2();
        this.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
        // setPixelRatio matches the renderer so effects sample at native resolution.
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this._size.set(width * this.renderer.getPixelRatio(), height * this.renderer.getPixelRatio());
        for (const p of this.filterPasses) {
            if (p.uniforms?.uResolution) p.uniforms.uResolution.value.copy(this._size);
        }
    }

    setCamera(camera) {
        this.renderPass.camera = camera;
    }

    // Rebuild the middle pass chain from a spec array. Base RenderPass and OutputPass are
    // preserved as the first/last passes. Called on world:update whenever postFx changes.
    applyFilters(specs) {
        for (const p of this.filterPasses) {
            this.composer.removePass(p);
            p.material?.dispose?.();
        }
        this.filterPasses = [];
        if (!Array.isArray(specs)) specs = [];
        // Insert enabled passes between RenderPass (index 0) and OutputPass (index 1).
        let insertAt = 1;
        for (const spec of specs) {
            if (!spec || spec.enabled === false) continue;
            const pass = buildPass(spec.type);
            if (!pass) continue;
            const meta = FILTER_TYPES[spec.type];
            const params = { ...(meta?.defaults || {}), ...spec };
            for (const p of meta?.params || []) {
                const uniformKey = 'u' + p.key.charAt(0).toUpperCase() + p.key.slice(1);
                if (pass.uniforms[uniformKey]) {
                    pass.uniforms[uniformKey].value = params[p.key];
                }
            }
            if (pass.uniforms.uResolution) pass.uniforms.uResolution.value.copy(this._size);
            this.composer.insertPass(pass, insertAt++);
            this.filterPasses.push(pass);
        }
    }

    // True when any filter pass is active — main can use this to skip composer.render() and
    // fall back to renderer.render() for the cheapest path.
    hasFilters() {
        return this.filterPasses.length > 0;
    }

    render(delta) {
        this.composer.render(delta);
    }
}
