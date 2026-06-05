import { registry } from '../editor/registry.js';

// Default 3-point + sun lighting rig. Now a registry seeder rather than direct THREE.Light creation.
// The registry creates the actual Three.js light objects and adds them to the scene.
export const DEFAULT_LIGHTS = [
    {
        id: 'hemisphere',
        name: 'Hemisphere',
        type: 'Hemisphere',
        color: '#ffffff',
        groundColor: '#444444',
        intensity: 0.02,
        position: [0, 20, 0]
    },
    {
        id: 'keyLight',
        name: 'Key Light',
        type: 'Directional',
        color: '#ffffff',
        intensity: 0.8,
        position: [5, 8, 5],
        target: [0, 1, 0],
        castShadow: true
    },
    {
        id: 'fillLight',
        name: 'Fill Light',
        type: 'Directional',
        color: '#ffffff',
        intensity: 0.02,
        position: [-5, 4, 5],
        target: [0, 1, 0]
    },
    {
        id: 'rimLight',
        name: 'Rim Light',
        type: 'Directional',
        color: '#ffffff',
        intensity: 0.02,
        position: [0, 6, -8],
        target: [0, 1, 0]
    },
    {
        id: 'sunLight',
        name: 'Sun Light',
        type: 'Directional',
        color: '#ffffff',
        intensity: 0.8,
        position: [5, 15, 10],
        target: [0, 0, 0],
        castShadow: true
    }
];

// Seed registry with default rig only if no lights have been hydrated from settings.
export function setupStudioLighting() {
    if (registry.lights.size > 0) {
        console.log('Lights already hydrated from settings, skipping default seed');
        return;
    }
    DEFAULT_LIGHTS.forEach(spec => registry.addLight(spec));
    console.log(`Seeded ${DEFAULT_LIGHTS.length} default lights into registry`);
}
