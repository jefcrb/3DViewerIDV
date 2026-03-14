import * as THREE from 'three';

// 3-Point Studio Lighting Configuration
export const LIGHTING_CONFIG = {
    hemisphere: {
        color: 0xffffff,
        groundColor: 0x444444,
        intensity: 0.8,
        position: [0, 20, 0]
    },
    keyLight: {
        color: 0xffffff,
        intensity: 1.8,
        position: [5, 8, 5],
        target: [0, 1, 0]
    },
    fillLight: {
        color: 0xffffff,
        intensity: 0.8,
        position: [-5, 4, 5],
        target: [0, 1, 0]
    },
    rimLight: {
        color: 0xffffff,
        intensity: 0.9,
        position: [0, 6, -8],
        target: [0, 1, 0]
    },
    shadows: {
        mapSize: 2048,
        cameraBounds: 15,
        near: 0.5,
        far: 50,
        bias: -0.0001,
        normalBias: 0.02
    }
};

// General lighting
export function setupStudioLighting(scene) {
    const config = LIGHTING_CONFIG;

    const hemisphereLight = new THREE.HemisphereLight(
        config.hemisphere.color,
        config.hemisphere.groundColor,
        config.hemisphere.intensity
    );
    hemisphereLight.position.set(...config.hemisphere.position);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(config.keyLight.color, config.keyLight.intensity);
    keyLight.position.set(...config.keyLight.position);
    keyLight.target.position.set(...config.keyLight.target);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = config.shadows.mapSize;
    keyLight.shadow.mapSize.height = config.shadows.mapSize;
    keyLight.shadow.camera.near = config.shadows.near;
    keyLight.shadow.camera.far = config.shadows.far;
    keyLight.shadow.camera.left = -config.shadows.cameraBounds;
    keyLight.shadow.camera.right = config.shadows.cameraBounds;
    keyLight.shadow.camera.top = config.shadows.cameraBounds;
    keyLight.shadow.camera.bottom = -config.shadows.cameraBounds;
    keyLight.shadow.bias = config.shadows.bias;
    keyLight.shadow.normalBias = config.shadows.normalBias;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const fillLight = new THREE.DirectionalLight(config.fillLight.color, config.fillLight.intensity);
    fillLight.position.set(...config.fillLight.position);
    fillLight.target.position.set(...config.fillLight.target);
    scene.add(fillLight);
    scene.add(fillLight.target);

    const rimLight = new THREE.DirectionalLight(config.rimLight.color, config.rimLight.intensity);
    rimLight.position.set(...config.rimLight.position);
    rimLight.target.position.set(...config.rimLight.target);
    scene.add(rimLight);
    scene.add(rimLight.target);
}
