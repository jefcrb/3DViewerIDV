// Three.js-based 3D Character Viewer
// Loads Blender-exported GLB scenes and replaces dummy models with character GLTFs

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Configuration
const SCENE_CONFIG = {
    sceneUrl: './assets/scene.glb',
    dummyNames: {
        hunter: '_HUNTER',
        survivors: ['_SURVIVOR_1', '_SURVIVOR_2', '_SURVIVOR_3', '_SURVIVOR_4']
    },
    lightIntensityMultiplier: 0.05
};

const DEFAULT_POSITIONS = {
    hunter: new THREE.Vector3(0, 0, 4),
    survivors: [
        new THREE.Vector3(-3, 0, -1),
        new THREE.Vector3(-1, 0, -1),
        new THREE.Vector3(1, 0, -1),
        new THREE.Vector3(3, 0, -1)
    ]
};

// Dev mode
const DEV = false;

const AVAILABLE_HUNTERS = [
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

const AVAILABLE_SURVIVORS = [
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
    { name: "Magician", folder: "Magician" }
];

const DEV_DATA = {
    hunter: {
        name: "Hell Ember",
        hasModel: true,
        modelPath: "./hunters/Hell_Ember/",
        modelFile: "Hell_Ember.gltf"
    },
    survivors: [
        { name: "Doctor", hasModel: true, modelPath: "./survivors/Doctor/", modelFile: "Doctor.gltf" },
        { name: "Lawyer", hasModel: true, modelPath: "./survivors/Lawyer/", modelFile: "Lawyer.gltf" },
        { name: "Thief", hasModel: true, modelPath: "./survivors/Thief/", modelFile: "Thief.gltf" },
        { name: "Gardener", hasModel: true, modelPath: "./survivors/Gardener/", modelFile: "Gardener.gltf" }
    ]
};

const TARGET_HEIGHT = 2.5;

// Scene setup
const canvas = document.getElementById('renderCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(8, 6, 8);
camera.lookAt(0, 1, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.minDistance = 4;
controls.maxDistance = 20;
controls.enableDamping = true;
controls.dampingFactor = 0.05;

if (!DEV) {
    // controls.enabled = false;
}

// Dummy model management
let dummyModels = {
    hunter: null,
    survivors: []
};

let characterPositions = {
    hunter: null,
    survivors: []
};

let sceneLoaded = false;

function configureLightShadow(light, mapSize = 1024) {
    light.castShadow = true;
    light.shadow.mapSize.width = mapSize;
    light.shadow.mapSize.height = mapSize;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 2;
}

function findDummyModels(loadedScene) {
    const hunter = loadedScene.getObjectByName(SCENE_CONFIG.dummyNames.hunter);
    const survivors = SCENE_CONFIG.dummyNames.survivors.map(name =>
        loadedScene.getObjectByName(name)
    ).filter(obj => obj !== undefined);

    if (hunter) {
        console.log(`Found hunter dummy: ${SCENE_CONFIG.dummyNames.hunter}`);
    } else {
        console.warn(`Hunter dummy not found: ${SCENE_CONFIG.dummyNames.hunter}`);
    }

    console.log(`Found ${survivors.length} survivor dummies`);

    return { hunter, survivors };
}

function getPositionsFromDummies(dummies) {
    const positions = {
        hunter: dummies.hunter ?
            dummies.hunter.getWorldPosition(new THREE.Vector3()) :
            DEFAULT_POSITIONS.hunter.clone(),
        survivors: []
    };

    for (let i = 0; i < 4; i++) {
        if (dummies.survivors[i]) {
            positions.survivors.push(dummies.survivors[i].getWorldPosition(new THREE.Vector3()));
        } else {
            positions.survivors.push(DEFAULT_POSITIONS.survivors[i].clone());
        }
    }

    return positions;
}

function hideDummyModels(dummies) {
    if (dummies.hunter) {
        dummies.hunter.visible = false;
    }
    dummies.survivors.forEach(dummy => {
        if (dummy) dummy.visible = false;
    });
}

// Blender scene loading
function loadBlenderScene() {
    return new Promise((resolve, reject) => {
        console.log(`Loading Blender scene from: ${SCENE_CONFIG.sceneUrl}`);

        const loader = new GLTFLoader();
        loader.load(
            SCENE_CONFIG.sceneUrl,
            (gltf) => {
                console.log('Blender scene loaded successfully');

                scene.add(gltf.scene);

                let lightCount = 0;
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }

                    if (child.isLight) {
                        lightCount++;

                        const originalIntensity = child.intensity;
                        child.intensity *= SCENE_CONFIG.lightIntensityMultiplier;

                        if (child.isDirectionalLight) {
                            configureLightShadow(child, 2048);
                            child.shadow.camera.near = 0.5;
                            child.shadow.camera.far = 50;
                            child.shadow.camera.left = -20;
                            child.shadow.camera.right = 20;
                            child.shadow.camera.top = 20;
                            child.shadow.camera.bottom = -20;
                            console.log(`  Configured DirectionalLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else if (child.isPointLight) {
                            configureLightShadow(child);
                            console.log(`  Configured PointLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else if (child.isSpotLight) {
                            configureLightShadow(child);
                            console.log(`  Configured SpotLight: ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        } else {
                            console.log(`  Found light: ${child.type}, ${originalIntensity.toFixed(2)} → ${child.intensity.toFixed(2)}`);
                        }
                    }
                });

                if (lightCount === 0) {
                    console.error('No lights found in Blender scene! Models will appear dark.');
                    console.error('Make sure to export with "Punctual Lights" checked in Blender.');
                } else {
                    console.log(`Found and configured ${lightCount} light(s) from Blender`);
                }

                if (gltf.cameras && gltf.cameras.length > 0) {
                    const blenderCamera = gltf.cameras[0];
                    camera.position.copy(blenderCamera.position);
                    camera.rotation.copy(blenderCamera.rotation);
                    console.log('Using camera from Blender scene');
                }

                dummyModels = findDummyModels(gltf.scene);
                characterPositions = getPositionsFromDummies(dummyModels);
                hideDummyModels(dummyModels);

                sceneLoaded = true;
                resolve();
            },
            (progress) => {
                const percent = (progress.loaded / progress.total) * 100;
                console.log(`Loading: ${percent.toFixed(1)}%`);
            },
            (error) => {
                console.error('Failed to load Blender scene:', error);
                reject(error);
            }
        );
    });
}

// Minimal fallback scene
function createMinimalFallbackScene() {
    console.log('Creating minimal fallback scene (no lighting)...');

    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.8,
        metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    characterPositions = {
        hunter: DEFAULT_POSITIONS.hunter.clone(),
        survivors: DEFAULT_POSITIONS.survivors.map(p => p.clone())
    };

    console.log('Minimal fallback scene created (models will appear dark without lights)');
}

// Scene initialization
async function initializeScene() {
    try {
        await loadBlenderScene();
        console.log('Scene initialization complete');
    } catch (error) {
        console.error('Blender scene loading failed:', error);
        console.error('Error details:', error.message);
        console.warn('Creating fallback scene. Please add scene.glb to assets/ folder.');

        createMinimalFallbackScene();
    }
}

// Character loading
let loadedCharacters = {
    hunter: null,
    survivors: [null, null, null, null]
};
const clock = new THREE.Clock();

window.loadCharactersJson = function(jsonData) {
    console.log('Received character data from backend:', jsonData);

    if (sceneLoaded) {
        hideDummyModels(dummyModels);
    }

    const hunterUrl = (jsonData.hunter && jsonData.hunter.hasModel)
        ? jsonData.hunter.modelPath + jsonData.hunter.modelFile
        : null;

    if (hunterUrl !== (loadedCharacters.hunter?.url || null)) {
        if (loadedCharacters.hunter) {
            scene.remove(loadedCharacters.hunter.model);
            loadedCharacters.hunter = null;
            console.log('Removed old hunter');
        }

        if (hunterUrl) {
            loadCharacterModel(
                hunterUrl,
                jsonData.hunter.name,
                characterPositions.hunter,
                'hunter',
                -1
            );
        }
    } else if (hunterUrl) {
        console.log(`Hunter unchanged: ${jsonData.hunter.name}`);
    }

    if (jsonData.survivors && Array.isArray(jsonData.survivors)) {
        jsonData.survivors.forEach((survivor, index) => {
            if (index >= 4) return;

            const survivorUrl = (survivor && survivor.hasModel)
                ? survivor.modelPath + survivor.modelFile
                : null;

            if (survivorUrl !== (loadedCharacters.survivors[index]?.url || null)) {
                if (loadedCharacters.survivors[index]) {
                    scene.remove(loadedCharacters.survivors[index].model);
                    loadedCharacters.survivors[index] = null;
                    console.log(`Removed old survivor at position ${index}`);
                }

                if (survivorUrl) {
                    loadCharacterModel(
                        survivorUrl,
                        survivor.name,
                        characterPositions.survivors[index],
                        'survivor',
                        index
                    );
                }
            } else if (survivorUrl) {
                console.log(`Survivor ${index} unchanged: ${survivor.name}`);
            }
        });
    }

    for (let i = (jsonData.survivors?.length || 0); i < 4; i++) {
        if (loadedCharacters.survivors[i]) {
            scene.remove(loadedCharacters.survivors[i].model);
            loadedCharacters.survivors[i] = null;
            console.log(`Removed survivor at position ${i} (no longer in data)`);
        }
    }
};

window.loadHunterFromJson = window.loadCharactersJson;

function loadCharacterModel(url, name, position, type, index) {
    console.log(`Loading ${type}: ${name} from ${url}`);

    const loader = new GLTFLoader();
    loader.load(
        url,
        (gltf) => {
            console.log(`Successfully loaded ${type}: ${name}`);

            const model = gltf.scene;

            model.position.set(0, 0, 0);
            model.scale.set(1, 1, 1);

            model.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const height = size.y;

            if (height > 0) {
                const scale = TARGET_HEIGHT / height;
                model.scale.setScalar(scale);
                console.log(`Normalized ${name}: height=${height.toFixed(2)}, scale=${scale.toFixed(2)}`);
            }

            model.position.copy(position);

            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            let mixer = null;
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);

                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });

                console.log(`Loaded ${gltf.animations.length} animation(s) for ${name}`);
            }

            scene.add(model);

            const characterData = {
                model: model,
                mixer: mixer,
                name: name,
                url: url
            };

            if (type === 'hunter') {
                loadedCharacters.hunter = characterData;
            } else if (type === 'survivor' && index >= 0 && index < 4) {
                loadedCharacters.survivors[index] = characterData;
            }
        },
        undefined,
        (error) => {
            console.error(`Error loading ${type} ${name}:`, error);
        }
    );
}

// Dev mode functions
function populateDevDropdowns() {
    const hunterSelect = document.getElementById('hunterSelect');
    const survivor1Select = document.getElementById('survivor1Select');
    const survivor2Select = document.getElementById('survivor2Select');
    const survivor3Select = document.getElementById('survivor3Select');
    const survivor4Select = document.getElementById('survivor4Select');

    AVAILABLE_HUNTERS.forEach(hunter => {
        const option = document.createElement('option');
        option.value = hunter.folder;
        option.textContent = hunter.name;
        hunterSelect.appendChild(option);
    });

    [survivor1Select, survivor2Select, survivor3Select, survivor4Select].forEach(select => {
        AVAILABLE_SURVIVORS.forEach(survivor => {
            const option = document.createElement('option');
            option.value = survivor.folder;
            option.textContent = survivor.name;
            select.appendChild(option);
        });
    });

    hunterSelect.value = 'Hell_Ember';
    survivor1Select.value = 'Doctor';
    survivor2Select.value = 'Lawyer';
    survivor3Select.value = 'Thief';
    survivor4Select.value = 'Gardener';
}

window.applyDevSelection = function() {
    const hunterFolder = document.getElementById('hunterSelect').value;
    const survivor1Folder = document.getElementById('survivor1Select').value;
    const survivor2Folder = document.getElementById('survivor2Select').value;
    const survivor3Folder = document.getElementById('survivor3Select').value;
    const survivor4Folder = document.getElementById('survivor4Select').value;

    const gameData = {
        hunter: null,
        survivors: []
    };

    if (hunterFolder) {
        const hunterInfo = AVAILABLE_HUNTERS.find(h => h.folder === hunterFolder);
        gameData.hunter = {
            name: hunterInfo.name,
            hasModel: true,
            modelPath: `./hunters/${hunterFolder}/`,
            modelFile: `${hunterFolder}.gltf`
        };
    }

    [survivor1Folder, survivor2Folder, survivor3Folder, survivor4Folder].forEach(folder => {
        if (folder) {
            const survivorInfo = AVAILABLE_SURVIVORS.find(s => s.folder === folder);
            gameData.survivors.push({
                name: survivorInfo.name,
                hasModel: true,
                modelPath: `./survivors/${folder}/`,
                modelFile: `${folder}.gltf`
            });
        }
    });

    console.log('DEV MODE: Applying new selection...', gameData);
    window.loadCharactersJson(gameData);
};

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (loadedCharacters.hunter?.mixer) {
        loadedCharacters.hunter.mixer.update(delta);
    }
    loadedCharacters.survivors.forEach(survivor => {
        if (survivor?.mixer) {
            survivor.mixer.update(delta);
        }
    });

    if (controls.enabled) {
        controls.update();
    }

    renderer.render(scene, camera);
}

// Window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialization
(async function() {
    try {
        await initializeScene();
        console.log('Scene ready');
    } catch (error) {
        console.error('Fatal initialization error:', error);
        document.getElementById('error').style.display = 'block';
        document.getElementById('errorMessage').textContent = `Fatal error: ${error.message}`;
    }

    animate();

    if (DEV) {
        console.log('DEV MODE: Enabled');
        document.getElementById('devPanel').style.display = 'block';
        populateDevDropdowns();

        setTimeout(() => {
            window.loadCharactersJson(DEV_DATA);
        }, 500);
    }
})();
