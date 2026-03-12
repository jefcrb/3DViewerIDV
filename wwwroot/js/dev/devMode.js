import { AVAILABLE_HUNTERS, AVAILABLE_SURVIVORS } from '../config.js';

export function populateDevDropdowns() {
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

export function setupDevMode() {
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
}
