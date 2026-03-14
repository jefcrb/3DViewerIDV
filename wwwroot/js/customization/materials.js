import * as THREE from 'three';

// Material and Rendering Configuration
export const MATERIAL_CONFIG = {
    shadows: {
        castShadow: true,
        receiveShadow: true
    },
    rendering: {
        toneMapping: 'ACESFilmic',
        toneMappingExposure: 1.3,
        shadowMapType: 'Basic'
    },
    overrides: {
        metalness: null,
        roughness: null,
        envMapIntensity: null
    }
};

// Shadow settings
export function applyMaterialSettings(model) {
    const config = MATERIAL_CONFIG;

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = config.shadows.castShadow;
            child.receiveShadow = config.shadows.receiveShadow;

            if (child.material) {
                if (config.overrides.metalness !== null) {
                    child.material.metalness = config.overrides.metalness;
                }
                if (config.overrides.roughness !== null) {
                    child.material.roughness = config.overrides.roughness;
                }
                if (config.overrides.envMapIntensity !== null) {
                    child.material.envMapIntensity = config.overrides.envMapIntensity;
                }
            }
        }
    });
}

export function getRendererSettings() {
    const config = MATERIAL_CONFIG.rendering;

    const toneMappingMap = {
        'NoToneMapping': THREE.NoToneMapping,
        'Linear': THREE.LinearToneMapping,
        'Reinhard': THREE.ReinhardToneMapping,
        'Cineon': THREE.CineonToneMapping,
        'ACESFilmic': THREE.ACESFilmicToneMapping
    };

    const shadowMapTypeMap = {
        'Basic': THREE.BasicShadowMap,
        'PCF': THREE.PCFShadowMap,
        'PCFSoft': THREE.PCFSoftShadowMap,
        'VSM': THREE.VSMShadowMap
    };

    return {
        toneMapping: toneMappingMap[config.toneMapping] || THREE.ACESFilmicToneMapping,
        toneMappingExposure: config.toneMappingExposure,
        shadowMapType: shadowMapTypeMap[config.shadowMapType] || THREE.PCFSoftShadowMap
    };
}
