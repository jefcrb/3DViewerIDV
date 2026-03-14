import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEV } from '../config.js';
import { getRendererSettings } from '../customization/materials.js';

export function setupRenderer(canvas) {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    const settings = getRendererSettings();
    renderer.shadowMap.type = settings.shadowMapType;
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = settings.toneMappingExposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    return renderer;
}

export function setupScene(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0xaaaaaa);
    const envMap = pmremGenerator.fromScene(envScene).texture;
    scene.environment = envMap;
    pmremGenerator.dispose();

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
