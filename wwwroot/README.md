# 3D Character Viewer

A Three.js-based 3D viewer for Identity V characters with dynamic model loading and studio lighting.

## Project Structure

```
wwwroot/
├── index.html                  # Main HTML file
├── custom_scales.json          # Per-character scale adjustments
├── styles/
│   └── main.css               # Styles for the viewer
├── js/
│   ├── main.js                # Entry point, initialization & animation loop
│   ├── config.js              # Configuration constants
│   ├── scene/
│   │   ├── setup.js           # Renderer, camera, controls, lighting setup
│   │   └── loader.js          # Blender scene loading & dummy management
│   ├── characters/
│   │   ├── loader.js          # Character model loading & scaling
│   │   └── api.js             # External API (window.loadCharactersJson)
│   └── dev/
│       └── devMode.js         # Dev mode UI controls
├── assets/
│   └── scene.glb              # Blender scene (environment, dummies, optional lights)
├── hunters/
│   └── [Character_Name]/
│       └── Character_Name.gltf
└── survivors/
    └── [Character_Name]/
        └── Character_Name.gltf
```

## Module Overview

### `js/config.js`
Contains all configuration constants:
- Scene configuration (URLs, dummy names, light multipliers)
- Default positions for characters
- Available hunters/survivors lists
- Dev mode test data

### `js/scene/setup.js`
Scene infrastructure:
- Renderer setup with shadow mapping and tone mapping
- Camera and orbit controls
- **3-point studio lighting** (ambient + key + fill + rim)
- Window resize handling

### `js/scene/loader.js`
Blender scene management:
- GLB scene loading
- Dummy model detection (`_HUNTER`, `_SURVIVOR_1-4`)
- Position extraction from dummies
- Blender light configuration (optional, uses 0.3x multiplier)
- Fallback scene generation

### `js/characters/loader.js`
Character model handling:
- GLTF model loading
- Auto-scaling to normalized height (2.5 units)
- Custom scale overrides from `custom_scales.json`
- Animation playback
- Shadow configuration

### `js/characters/api.js`
External API for WPF integration:
- `window.loadCharactersJson(jsonData)` - Main API
- `window.loadHunterFromJson(jsonData)` - Alias
- Character change detection and model swapping

### `js/dev/devMode.js`
Development tools:
- Dropdown population for character selection
- `window.applyDevSelection()` for testing

### `js/main.js`
Application entry point:
- Initializes all systems
- Animation loop
- Error handling
- Dev mode activation

## Usage

### External API

```javascript
window.loadCharactersJson({
    hunter: {
        name: "Hell Ember",
        hasModel: true,
        modelPath: "./hunters/Hell_Ember/",
        modelFile: "Hell_Ember.gltf"
    },
    survivors: [
        { name: "Doctor", hasModel: true, modelPath: "./survivors/Doctor/", modelFile: "Doctor.gltf" },
        { name: "Thief", hasModel: true, modelPath: "./survivors/Thief/", modelFile: "Thief.gltf" }
    ]
});
```

### Dev Mode

Set `DEV = true` in `config.js` to enable:
- Orbit controls for camera
- Dev panel with character selection dropdowns
- Auto-load test data on startup

## Lighting System

**3-Point Studio Lighting** (always active):
- **Ambient**: 0.4 intensity - soft base illumination
- **Key Light**: 1.2 intensity - main directional light with shadows (front-right)
- **Fill Light**: 0.5 intensity - softer opposite side light (front-left)
- **Rim Light**: 0.6 intensity - back highlights (behind characters)

**Blender Lights** (optional):
- Loaded from scene.glb if present
- Intensity multiplied by 0.3x to serve as accents
- Can be disabled by not including lights in GLB export

## Character Scaling

All characters normalized to 2.5 units tall. Override with `custom_scales.json`:

```json
{
  "Little Girl": 0.85,
  "Night Watch": 3.0
}
```

## Dummy Model System

Place dummy objects in Blender scene:
- `_HUNTER` - Hunter spawn position
- `_SURVIVOR_1` through `_SURVIVOR_4` - Survivor positions

These are detected, their world positions extracted, then hidden and replaced with actual character models.
