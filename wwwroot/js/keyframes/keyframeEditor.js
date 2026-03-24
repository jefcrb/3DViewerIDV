import * as THREE from 'three';
import { saveKeyframeAnimations } from '../storage/keyframeAnimationStorage.js';

let animationData = null;  // Reference to loaded data

export function setAnimationData(data) {
    animationData = data;

    // Migrate old formats to new camera+light format if needed
    if (data && (data.version === "1.0" || data.version === "2.0")) {
        console.log('Migrating old animation format to camera+light format');
        animationData = {
            version: "3.0",
            animatableObjects: {
                "Camera": {
                    type: "camera",
                    properties: {
                        position: { x: 0, y: 5, z: 10 },
                        rotation: { x: 0, y: 0, z: 0 },
                        fov: 50
                    },
                    chains: data.cameraAnimations?.chains || []
                }
            }
        };
        saveKeyframeAnimations(animationData);
    }

    // Ensure Camera object has properties (for existing v3.0 files without properties)
    if (data && data.version === "3.0" && data.animatableObjects?.Camera && !data.animatableObjects.Camera.properties) {
        data.animatableObjects.Camera.properties = {
            position: { x: 0, y: 5, z: 10 },
            rotation: { x: 0, y: 0, z: 0 },
            fov: 50
        };
        saveKeyframeAnimations(data);
    }
}

export function getAnimationData() {
    return animationData;
}

// Generate UUID helper
function generateUUID() {
    return THREE.MathUtils.generateUUID();
}

// ==================== OBJECT MANAGEMENT ====================

export function createLight(lightName, lightType = 'point') {
    if (!animationData || !animationData.animatableObjects) {
        console.error('Animation data not loaded');
        return null;
    }

    // Check if name already exists
    if (animationData.animatableObjects[lightName]) {
        console.error(`Light "${lightName}" already exists`);
        return null;
    }

    const properties = {
        color: 0xffffff,
        intensity: 1,
        position: { x: 0, y: 5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }
    };

    // Add type-specific default properties
    if (lightType === 'spot') {
        properties.angle = Math.PI / 4; // 45 degrees
        properties.penumbra = 0.1;
    }

    animationData.animatableObjects[lightName] = {
        type: "light",
        lightType: lightType,
        properties: properties,
        chains: []
    };

    saveKeyframeAnimations(animationData);
    console.log(`Created light "${lightName}" of type "${lightType}"`);
    return lightName;
}

export function deleteObject(objectName) {
    if (!animationData || !animationData.animatableObjects) {
        console.error('Animation data not loaded');
        return false;
    }

    if (objectName === "Camera") {
        console.error('Cannot delete the camera');
        return false;
    }

    if (!animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    delete animationData.animatableObjects[objectName];
    saveKeyframeAnimations(animationData);
    console.log(`Deleted object "${objectName}"`);
    return true;
}

export function updateObjectProperties(objectName, properties) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    const obj = animationData.animatableObjects[objectName];
    if (!obj.properties) {
        obj.properties = {};
    }

    Object.assign(obj.properties, properties);
    saveKeyframeAnimations(animationData);
    return true;
}

export function getAllAnimatableObjects() {
    if (!animationData || !animationData.animatableObjects) {
        return {};
    }
    return animationData.animatableObjects;
}

// ==================== CHAIN OPERATIONS ====================

export function createChain(objectName, chainName = 'New Animation') {
    if (!animationData || !animationData.animatableObjects) {
        console.error('Animation data not loaded');
        return null;
    }

    if (!animationData.animatableObjects[objectName]) {
        console.error(`Object "${objectName}" not found`);
        return null;
    }

    const chainId = generateUUID();
    const newChain = {
        id: chainId,
        name: chainName,
        triggers: [],
        loop: false,
        stopConditions: [],
        keyframes: []
    };

    animationData.animatableObjects[objectName].chains.push(newChain);
    saveKeyframeAnimations(animationData);

    console.log(`Created animation chain "${chainName}" for "${objectName}"`);
    return chainId;
}

export function updateChain(objectName, chainId, updates) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    const chain = animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
    if (!chain) {
        console.error('Chain not found');
        return false;
    }

    Object.assign(chain, updates);
    saveKeyframeAnimations(animationData);

    console.log(`Updated animation chain "${chainId}" for "${objectName}"`);
    return true;
}

export function deleteChain(objectName, chainId) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    const chains = animationData.animatableObjects[objectName].chains;
    const index = chains.findIndex(c => c.id === chainId);

    if (index === -1) {
        console.error('Chain not found');
        return false;
    }

    chains.splice(index, 1);
    saveKeyframeAnimations(animationData);

    console.log(`Deleted animation chain "${chainId}" from "${objectName}"`);
    return true;
}

export function getChain(objectName, chainId) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        return null;
    }

    return animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
}

export function getChainsForObject(objectName) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        return [];
    }

    return animationData.animatableObjects[objectName].chains;
}

// ==================== KEYFRAME OPERATIONS ====================

export function addKeyframe(objectName, chainId, properties = null) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return null;
    }

    const chain = animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
    if (!chain) {
        console.error('Chain not found');
        return null;
    }

    const objectType = animationData.animatableObjects[objectName].type;
    const keyframeId = generateUUID();

    let defaultProperties;
    if (objectType === 'camera') {
        defaultProperties = {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            fov: 50
        };
    } else if (objectType === 'light') {
        defaultProperties = {
            position: { x: 0, y: 5, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            color: 0xffffff,
            intensity: 1
        };
    }

    const newKeyframe = {
        id: keyframeId,
        duration: 1000,
        delay: 0,
        easing: 'easeOutCubic',
        properties: properties || defaultProperties
    };

    chain.keyframes.push(newKeyframe);
    saveKeyframeAnimations(animationData);

    console.log(`Added keyframe to animation chain "${chainId}" for "${objectName}"`);
    return keyframeId;
}

export function updateKeyframe(objectName, chainId, keyframeId, updates) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    const chain = animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
    if (!chain) {
        console.error('Chain not found');
        return false;
    }

    const keyframe = chain.keyframes.find(k => k.id === keyframeId);
    if (!keyframe) {
        console.error('Keyframe not found');
        return false;
    }

    Object.assign(keyframe, updates);
    saveKeyframeAnimations(animationData);

    console.log(`Updated keyframe "${keyframeId}" in animation chain "${chainId}" for "${objectName}"`);
    return true;
}

export function deleteKeyframe(objectName, chainId, keyframeId) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        console.error('Object not found');
        return false;
    }

    const chain = animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
    if (!chain) {
        console.error('Chain not found');
        return false;
    }

    const index = chain.keyframes.findIndex(k => k.id === keyframeId);
    if (index === -1) {
        console.error('Keyframe not found');
        return false;
    }

    chain.keyframes.splice(index, 1);
    saveKeyframeAnimations(animationData);

    console.log(`Deleted keyframe "${keyframeId}" from animation chain "${chainId}" for "${objectName}"`);
    return true;
}

export function getKeyframe(objectName, chainId, keyframeId) {
    if (!animationData || !animationData.animatableObjects || !animationData.animatableObjects[objectName]) {
        return null;
    }

    const chain = animationData.animatableObjects[objectName].chains.find(c => c.id === chainId);
    if (!chain) {
        return null;
    }

    return chain.keyframes.find(k => k.id === keyframeId);
}
