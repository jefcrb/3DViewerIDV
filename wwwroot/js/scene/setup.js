import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getRendererSettings } from '../customization/materials.js';

export async function setupRenderer(canvas, rendererType = 'webgl') {
    let renderer;

    if (rendererType === 'webgpu') {
        console.log('Initializing WebGPU Renderer');
        renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
        await renderer.init();
    } else {
        console.log('Initializing WebGL Renderer');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
        shadowMap: renderer.shadowMap.enabled,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure
    });

    return renderer;
}

export function setupScene(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    return scene;
}

// Live (broadcast) camera — Theatre.js-driven; never gets OrbitControls.
export function setupLiveCamera() {
    const camera = new THREE.PerspectiveCamera(
        50,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(8, 6, 8);
    camera.lookAt(0, 1, 0);
    camera.name = 'liveCamera';
    return camera;
}

// Editor (free-orbit) camera — OrbitControls always bound.
export function setupEditorCamera() {
    const camera = new THREE.PerspectiveCamera(
        50,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(12, 8, 12);
    camera.lookAt(0, 1, 0);
    camera.name = 'editorCamera';
    return camera;
}

export function setupEditorControls(camera, canvas) {
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1, 0);
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false;
    return controls;
}

// Wireframe helper showing the live camera's frustum in editor mode.
export function createLiveCameraHelper(liveCamera) {
    const helper = new THREE.CameraHelper(liveCamera);
    helper.visible = false;
    return helper;
}

export { setupStudioLighting } from '../customization/lighting.js';

export function setupWindowResize(cameras, renderer) {
    window.addEventListener('resize', () => {
        cameras.forEach(cam => {
            cam.aspect = window.innerWidth / window.innerHeight;
            cam.updateProjectionMatrix();
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}
