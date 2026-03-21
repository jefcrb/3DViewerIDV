import * as THREE from 'three';

// Light management system
const sceneLights = new Map(); // Map of light name -> THREE.Light object

export function createSceneLight(scene, lightName, lightType, properties) {
    let light;

    switch (lightType) {
        case 'point':
            light = new THREE.PointLight(properties.color || 0xffffff, properties.intensity !== undefined ? properties.intensity : 1);
            light.castShadow = true;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            break;

        case 'spot':
            light = new THREE.SpotLight(properties.color || 0xffffff, properties.intensity !== undefined ? properties.intensity : 1);
            light.angle = properties.angle || Math.PI / 4;
            light.penumbra = properties.penumbra || 0.1;
            light.decay = 2;
            light.castShadow = true;
            light.shadow.mapSize.width = 1024;
            light.shadow.mapSize.height = 1024;
            break;

        case 'directional':
            light = new THREE.DirectionalLight(properties.color || 0xffffff, properties.intensity !== undefined ? properties.intensity : 1);
            light.castShadow = true;
            light.shadow.mapSize.width = 2048;
            light.shadow.mapSize.height = 2048;
            light.shadow.camera.left = -20;
            light.shadow.camera.right = 20;
            light.shadow.camera.top = 20;
            light.shadow.camera.bottom = -20;
            light.shadow.camera.near = 0.5;
            light.shadow.camera.far = 50;
            break;

        default:
            console.error(`Unknown light type: ${lightType}`);
            return null;
    }

    light.name = lightName;
    light.position.set(
        properties.position?.x || 0,
        properties.position?.y || 5,
        properties.position?.z || 0
    );

    if (properties.rotation) {
        light.rotation.set(
            properties.rotation.x || 0,
            properties.rotation.y || 0,
            properties.rotation.z || 0
        );
    }

    // Setup spotlight target (points downward by default like Blender)
    if (lightType === 'spot') {
        const target = new THREE.Object3D();
        target.position.copy(light.position);
        target.position.y -= 1; // Point downward
        light.target = target;
        light.userData.target = target; // Store reference for later updates
    }

    // Add helper for visualization (hidden by default)
    let helper;
    if (lightType === 'point') {
        helper = new THREE.PointLightHelper(light, 0.5);
    } else if (lightType === 'spot') {
        helper = new THREE.SpotLightHelper(light);
    } else if (lightType === 'directional') {
        helper = new THREE.DirectionalLightHelper(light, 1);
    }

    scene.add(light);

    // Add spotlight target to scene and update its position
    if (light.isSpotLight && light.userData.target) {
        scene.add(light.userData.target);
        updateSpotlightTarget(light);
    }

    if (helper) {
        helper.visible = false; // Hide by default
        scene.add(helper);
        light.userData.helper = helper;
    }

    sceneLights.set(lightName, light);
    console.log(`Created ${lightType} light "${lightName}" in scene`);

    return light;
}

export function getSceneLight(lightName) {
    return sceneLights.get(lightName);
}

export function updateLightProperties(lightName, properties) {
    const light = sceneLights.get(lightName);
    if (!light) {
        console.error(`Light "${lightName}" not found in scene`);
        return false;
    }

    if (properties.color !== undefined) {
        light.color.setHex(properties.color);
    }

    if (properties.intensity !== undefined) {
        light.intensity = properties.intensity;
    }

    if (properties.position) {
        light.position.set(properties.position.x, properties.position.y, properties.position.z);
    }

    if (properties.rotation) {
        light.rotation.set(properties.rotation.x, properties.rotation.y, properties.rotation.z);
    }

    // Update type-specific properties
    if (light.isSpotLight) {
        if (properties.angle !== undefined) {
            light.angle = properties.angle;
        }
        if (properties.penumbra !== undefined) {
            light.penumbra = properties.penumbra;
        }

        // Update spotlight target position when position/rotation changes
        if (properties.position || properties.rotation) {
            updateSpotlightTarget(light);
        }
    }

    // Update helper if it exists
    if (light.userData.helper) {
        light.userData.helper.update();
    }

    return true;
}

export function deleteSceneLight(scene, lightName) {
    const light = sceneLights.get(lightName);
    if (!light) {
        console.error(`Light "${lightName}" not found in scene`);
        return false;
    }

    // Remove helper if it exists
    if (light.userData.helper) {
        scene.remove(light.userData.helper);
        light.userData.helper.dispose();
    }

    // Remove spotlight target if it exists
    if (light.isSpotLight && light.userData.target) {
        scene.remove(light.userData.target);
    }

    scene.remove(light);
    sceneLights.delete(lightName);

    console.log(`Deleted light "${lightName}" from scene`);
    return true;
}

export function getAllSceneLights() {
    return sceneLights;
}

// Update spotlight target based on light's rotation
export function updateSpotlightTarget(light) {
    if (!light.isSpotLight || !light.userData.target) {
        return;
    }

    // Calculate target position: light position + direction vector
    const direction = new THREE.Vector3(0, -1, 0); // Default: point down
    direction.applyQuaternion(light.quaternion); // Apply light's rotation

    light.userData.target.position.copy(light.position).add(direction);
}

// Initialize lights from animation data
export function initializeLightsFromData(scene, animationData) {
    if (!animationData || !animationData.animatableObjects) {
        return;
    }

    Object.entries(animationData.animatableObjects).forEach(([name, obj]) => {
        if (obj.type === 'light') {
            createSceneLight(scene, name, obj.lightType, obj.properties);
        }
    });

    console.log(`Initialized ${sceneLights.size} lights from animation data`);
}
