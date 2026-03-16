import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEV } from '../config.js';
import { getRendererSettings } from '../customization/materials.js';

export async function setupRenderer(canvas, rendererType = 'webgpu') {
    let renderer;

    if (rendererType === 'webgl') {
        console.log('Initializing WebGL Renderer');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } else {
        console.log('Initializing WebGPU Renderer');
        renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
        await renderer.init();
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    const settings = getRendererSettings();
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = settings.toneMappingExposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    console.log(`${rendererType.toUpperCase()} Renderer initialized:`, {
        type: rendererType,
        backend: renderer.backend?.constructor?.name,
        shadowMap: renderer.shadowMap.enabled,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure
    });

    return renderer;
}

export function setupScene(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Environment map disabled

    return scene;
}

export function setupCamera() {
    const camera = new THREE.PerspectiveCamera(
        50,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(8, 6, 8);
    camera.lookAt(0, 1, 0);

    return camera;
}

export function setupControls(camera, canvas) {
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1, 0);
    controls.minDistance = 4;
    controls.maxDistance = 20;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false;

    return controls;
}

export { setupStudioLighting } from '../customization/lighting.js';

export function setupWindowResize(camera, renderer) {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}
