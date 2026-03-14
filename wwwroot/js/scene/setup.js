import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEV } from '../config.js';

export function setupRenderer(canvas) {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
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

export function setupStudioLighting(scene) {
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    hemisphereLight.position.set(0, 20, 0);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(5, 8, 5);
    keyLight.target.position.set(0, 1, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.camera.left = -15;
    keyLight.shadow.camera.right = 15;
    keyLight.shadow.camera.top = 15;
    keyLight.shadow.camera.bottom = -15;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-5, 4, 5);
    fillLight.target.position.set(0, 1, 0);
    scene.add(fillLight);
    scene.add(fillLight.target);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.9);
    rimLight.position.set(0, 6, -8);
    rimLight.target.position.set(0, 1, 0);
    scene.add(rimLight);
    scene.add(rimLight.target);

    console.log('Studio lighting: Hemisphere + Key (shadows) + Fill + Rim + Environment Map');
}

export function setupWindowResize(camera, renderer) {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}
