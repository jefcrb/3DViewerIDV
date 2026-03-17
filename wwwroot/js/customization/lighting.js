import * as THREE from 'three';

// 3-Point Studio Lighting Configuration
export const LIGHTING_CONFIG = {
    hemisphere: {
        color: 0xffffff,
        groundColor: 0x444444,
        intensity: 0.02,
        position: [0, 20, 0]
    },
    keyLight: {
        color: 0xffffff,
        intensity: 0.8,
        position: [5, 8, 5],
        target: [0, 1, 0]
    },
    fillLight: {
        color: 0xffffff,
        intensity: 0.02,
        position: [-5, 4, 5],
        target: [0, 1, 0]
    },
    rimLight: {
        color: 0xffffff,
        intensity: 0.02,
        position: [0, 6, -8],
        target: [0, 1, 0]
    },
    sun: {
        enabled: true,
        color: 0xffffff,
        intensity: 0.8,
        position: [5, 15, 10],
        target: [0, 0, 0],
        castShadow: true
    },
    shadows: {
        mapSize: 1024,
        cameraBounds: 15,
        near: 0.5,
        far: 50,
        bias: -0.0001,
        normalBias: 0.02,
        radius: 4
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
    keyLight.shadow.radius = config.shadows.radius;
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

    // Sun light
    let sunLight = null;
    if (config.sun.enabled) {
        sunLight = new THREE.DirectionalLight(config.sun.color, config.sun.intensity);
        sunLight.position.set(...config.sun.position);
        sunLight.target.position.set(...config.sun.target);

        if (config.sun.castShadow) {
            sunLight.castShadow = true;
            sunLight.shadow.mapSize.width = config.shadows.mapSize;
            sunLight.shadow.mapSize.height = config.shadows.mapSize;
            sunLight.shadow.camera.near = config.shadows.near;
            sunLight.shadow.camera.far = config.shadows.far;
            sunLight.shadow.camera.left = -config.shadows.cameraBounds;
            sunLight.shadow.camera.right = config.shadows.cameraBounds;
            sunLight.shadow.camera.top = config.shadows.cameraBounds;
            sunLight.shadow.camera.bottom = -config.shadows.cameraBounds;
            sunLight.shadow.bias = config.shadows.bias;
            sunLight.shadow.normalBias = config.shadows.normalBias;
            sunLight.shadow.radius = config.shadows.radius;

            console.log('Sun Light Shadow Config:', {
                castShadow: sunLight.castShadow,
                mapSize: `${sunLight.shadow.mapSize.width}x${sunLight.shadow.mapSize.height}`,
                camera: {
                    near: sunLight.shadow.camera.near,
                    far: sunLight.shadow.camera.far,
                    bounds: config.shadows.cameraBounds
                },
                bias: sunLight.shadow.bias,
                normalBias: sunLight.shadow.normalBias,
                radius: sunLight.shadow.radius
            });
        }

        scene.add(sunLight);
        scene.add(sunLight.target);
        console.log('Sun light added to scene');
    }

    return {
        hemisphere: hemisphereLight,
        keyLight: keyLight,
        fillLight: fillLight,
        rimLight: rimLight,
        sunLight: sunLight
    };
}
