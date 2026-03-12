import * as THREE from 'three';

export const SCENE_CONFIG = {
    sceneUrl: './assets/scene.glb',
    dummyNames: {
        hunter: '_HUNTER',
        survivors: ['_SURVIVOR_1', '_SURVIVOR_2', '_SURVIVOR_3', '_SURVIVOR_4']
    },
    lightIntensityMultiplier: 0.3
};

export const DEFAULT_POSITIONS = {
    hunter: new THREE.Vector3(0, 0, 4),
    survivors: [
        new THREE.Vector3(-3, 0, -1),
        new THREE.Vector3(-1, 0, -1),
        new THREE.Vector3(1, 0, -1),
        new THREE.Vector3(3, 0, -1)
    ]
};

export const TARGET_HEIGHT = 2.5;

export const DEV = false;

export const AVAILABLE_HUNTERS = [
    { name: "Hell Ember", folder: "Hell_Ember" },
    { name: "Ripper", folder: "Ripper" },
    { name: "Gamekeeper", folder: "Gamekeeper" },
    { name: "Soul Weaver", folder: "Soul_Weaver" },
    { name: "Geisha", folder: "Geisha" },
    { name: "Feaster", folder: "Feaster" },
    { name: "Wu Chang", folder: "Wu_Chang" },
    { name: "Photographer", folder: "Photographer" },
    { name: "Mad Eyes", folder: "Mad_Eyes" },
    { name: "Dream Witch", folder: "Dream_Witch" }
];

export const AVAILABLE_SURVIVORS = [
    { name: "Doctor", folder: "Doctor" },
    { name: "Lawyer", folder: "Lawyer" },
    { name: "Thief", folder: "Thief" },
    { name: "Gardener", folder: "Gardener" },
    { name: "Mechanic", folder: "Mechanic" },
    { name: "Coordinator", folder: "Coordinator" },
    { name: "Mercenary", folder: "Mercenary" },
    { name: "Forward", folder: "Forward" },
    { name: "Priestess", folder: "Priestess" },
    { name: "Perfumer", folder: "Perfumer" },
    { name: "Seer", folder: "Seer" },
    { name: "Magician", folder: "Magician" },
    { name: "Little Girl", folder: "Little_Girl"}
];

export const DEV_DATA = {
    hunter: {
        name: "Hell Ember",
        hasModel: true,
        modelPath: "./hunters/Hell_Ember/",
        modelFile: "Hell_Ember.gltf"
    },
    survivors: [
        { name: "Doctor", hasModel: true, modelPath: "./survivors/Doctor/", modelFile: "Doctor.gltf" },
        { name: "Night Watch", hasModel: true, modelPath: "./hunters/Night_Watch/", modelFile: "Night_Watch.gltf" },
        { name: "Thief", hasModel: true, modelPath: "./survivors/Thief/", modelFile: "Thief.gltf" },
        { name: "Gardener", hasModel: true, modelPath: "./survivors/Gardener/", modelFile: "Gardener.gltf" }
    ]
};
