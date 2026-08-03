import * as THREE from 'three';

function getSceneId() {
    const p = new URLSearchParams(window.location.search).get('scene');
    if (!p || !/^[A-Za-z0-9._-]{1,64}$/.test(p)) return 'scene1';
    // Alias: earlier dev builds used 'default' as the built-in id; treat as scene1.
    if (p === 'default') return 'scene1';
    return p;
}

export const SCENE_ID = getSceneId();
export const SCENE_DISPLAY_NAME = SCENE_ID;

export const SCENE_CONFIG = {
    sceneUrl: `./scenes/${SCENE_ID}/scene.glb`,
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

function getDevMode() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('dev') === 'true';
}

export const DEV = getDevMode();

export const AVAILABLE_HUNTERS = [
    { name: "Hell Ember", folder: "厂长" },
    { name: "Ripper", folder: "杰克" },
    { name: "Gamekeeper", folder: "鹿头" },
    { name: "Soul Weaver", folder: "蜘蛛" },
    { name: "Geisha", folder: "红蝶" },
    { name: "Feaster", folder: "黄衣之主" },
    { name: "Wu Chang", folder: "白无常" },
    { name: "Photographer", folder: "摄影师" },
    { name: "Mad Eyes", folder: "疯眼" },
    { name: "Dream Witch", folder: "梦之女巫" }
];

export const AVAILABLE_SURVIVORS = [
    { name: "Doctor", folder: "医生" },
    { name: "Lawyer", folder: "律师" },
    { name: "Thief", folder: "慈善家" },
    { name: "Gardener", folder: "园丁" },
    { name: "Mechanic", folder: "机械师" },
    { name: "Coordinator", folder: "空军" },
    { name: "Mercenary", folder: "佣兵" },
    { name: "Forward", folder: "前锋" },
    { name: "Priestess", folder: "祭司" },
    { name: "Perfumer", folder: "调香师" },
    { name: "Seer", folder: "先知" },
    { name: "Magician", folder: "魔术师" },
    { name: "Little Girl", folder: "小女孩"}
];

export const DEV_DATA = {
    hunter: {
        name: "Hell Ember",
        hasModel: true,
        modelPath: "./hunters/厂长/",
        modelFile: "厂长.gltf"
    },
    survivors: [
        { name: "Doctor", hasModel: true, modelPath: "./survivors/医生/", modelFile: "医生.gltf" },
        { name: "Seer", hasModel: true, modelPath: "./survivors/先知/", modelFile: "先知.gltf" },
        { name: "Thief", hasModel: true, modelPath: "./survivors/慈善家/", modelFile: "慈善家.gltf" },
        { name: "Gardener", hasModel: true, modelPath: "./survivors/园丁/", modelFile: "园丁.gltf" }
    ]
};
