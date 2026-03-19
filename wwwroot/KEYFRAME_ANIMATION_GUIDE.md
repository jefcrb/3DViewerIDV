# Keyframe Animation System - User Guide

## Overview

The Keyframe Animation System allows you to visually create animations by manipulating objects in 3D space and recording their positions, rotations, scales, and other properties. It uses GSAP (GreenSock Animation Platform) for smooth, professional-quality animations.

## Features

- **Visual Object Manipulation**: Click and drag objects in 3D space
- **Multi-Property Recording**: Position, rotation, scale, and light intensity
- **Custom Triggers**: OnLoad, time-based, character change, or custom events
- **GSAP-Powered**: Industry-standard animation with 10+ easing functions
- **Live Preview**: Test animations before saving
- **JSON Export/Import**: Save animations to disk and reload them

## Getting Started

### 1. Enable Transform Controls

Click the **"📍 Enable Transform"** button in the editor panel. This activates the transform gizmo that lets you manipulate objects.

### 2. Select an Object

With transform controls enabled, **click any object in the 3D scene**:
- Camera
- Lights (keyLight, fillLight, rimLight, sunLight, hemisphereLight)
- Any named object from scene.glb (meshes, groups, etc.)

The selected object will show:
- Transform gizmo (arrows for position, arcs for rotation)
- Current properties displayed in the editor

### 3. Manipulate the Object

**Mouse Controls:**
- Drag the arrows to move (translate)
- Drag the arcs to rotate
- Drag the cubes to scale

**Keyboard Shortcuts:**
- `G` - Switch to translate/move mode
- `R` - Switch to rotate mode
- `S` - Switch to scale mode
- `Esc` - Deselect object

### 4. Record Keyframes

1. Move the object to your desired position/rotation/scale
2. Click **"📍 Record Keyframe"**
3. Enter the time in seconds (e.g., `0` for start, `2.0` for 2 seconds)
4. The keyframe is recorded with all current properties

**Repeat for multiple keyframes:**
- Move object to position #2 → Record at 0.5s
- Move object to position #3 → Record at 1.0s
- Move object to position #4 → Record at 2.0s

Each keyframe captures:
- Position (X, Y, Z)
- Rotation (X, Y, Z in radians)
- Scale (uniform or per-axis)
- Intensity (for lights only)

### 5. Configure Animation Settings

**Animation Name**: Give your animation a descriptive name (e.g., "intro_camera_sweep")

**Total Duration**: How long the animation takes in milliseconds (e.g., `2000` = 2 seconds)

**Easing**: Choose from 10+ easing functions:
- **Linear**: Constant speed
- **Ease Out**: Fast start, slow end (recommended)
- **Ease In-Out**: Slow start, slow end
- **Elastic**: Bouncy overshoot
- **Back**: Slight backward motion before moving forward
- **Bounce**: Bouncing effect at the end

**Trigger Type**:
- **On Load**: Plays when the scene loads
- **Time Delay**: Plays after X milliseconds
- **Character Change**: Plays when a character is selected (hunter/survivor)
- **Custom Event**: Plays on a custom JavaScript event

### 6. Preview Animation

Click **"▶ Preview"** to test your animation before saving.
- The animation will play in real-time
- All keyframes will interpolate smoothly using GSAP
- Click **"⏹ Stop"** to stop playback

### 7. Save Animation

Click **"💾 Save Animation"** to:
- Add the animation to your saved list
- Download `animations_gsap.json` file
- Clear the current keyframes (ready for next animation)

**Important**: Place the downloaded `animations_gsap.json` file in your `wwwroot/` directory to persist animations between sessions.

## Managing Saved Animations

### Play
Click the **▶** button next to any saved animation to play it immediately.

### Edit
Click the **✎** button to load the animation's keyframes back into the editor for modification.

### Delete
Click the **✕** button to remove an animation (requires confirmation).

## Trigger System

### On Load Trigger
```
Trigger: onLoad
Delay: 500ms
```
Animation plays 500ms after the scene loads.

### Time Delay Trigger
```
Trigger: time
Time: 5000ms
```
Animation plays 5 seconds after page load.

### Character Change Trigger
```
Trigger: characterChange
Role: hunter (or survivor)
```
Animation plays when a hunter (or survivor) is selected.

### Custom Event Trigger
```
Trigger: custom
Event Name: gameStart
```
Animation plays when you dispatch a custom event:
```javascript
window.dispatchEvent(new CustomEvent('gameStart'));
```

## Tips & Best Practices

### 1. Start Simple
Begin with 2-3 keyframes for your first animation. You can always add more complexity later.

### 2. Use Appropriate Easing
- **Camera movements**: `power2.out` or `power3.out` (smooth deceleration)
- **UI elements**: `back.out` or `elastic.out` (playful)
- **Precise movements**: `linear` or `power1.inOut`

### 3. Keyframe Timing
- First keyframe should typically be at time `0` (starting position)
- Distribute keyframes evenly for smooth motion
- Use uneven timing for varied pacing

### 4. Animating Lights
When you select a light, the **Intensity** property appears. You can:
- Record intensity changes over time (fade in/out)
- Combine with position changes (moving spotlight)
- Animate color (requires manual JSON editing)

### 5. Multiple Objects
You can animate multiple objects in a single animation:
1. Record keyframes for object A
2. Select object B (without clearing keyframes)
3. Record keyframes for object B
4. Both objects will animate together

### 6. Go To Keyframe
Click any keyframe in the list to:
- Jump the object to that position in the scene
- Verify the keyframe is correct
- Make adjustments if needed

## File Format

Animations are saved in `animations_gsap.json`:

```json
{
  "animations": [
    {
      "id": "1234567890",
      "name": "intro_camera",
      "keyframes": [
        {
          "time": 0,
          "objectName": "camera",
          "position": { "x": -10, "y": 8, "z": 15 },
          "rotation": { "x": 0, "y": 0, "z": 0 },
          "scale": { "x": 1, "y": 1, "z": 1 }
        },
        {
          "time": 2,
          "objectName": "camera",
          "position": { "x": 0, "y": 5, "z": 10 },
          "rotation": { "x": 0, "y": 0, "z": 0 },
          "scale": { "x": 1, "y": 1, "z": 1 }
        }
      ],
      "duration": 2000,
      "easing": "power2.out",
      "trigger": {
        "type": "onLoad",
        "delay": 500
      }
    }
  ]
}
```

You can manually edit this file for advanced control.

## Keyboard Shortcuts Summary

| Key | Action |
|-----|--------|
| `G` | Translate/Move mode |
| `R` | Rotate mode |
| `S` | Scale mode |
| `Esc` | Deselect object |
| Click | Select object |

## Troubleshooting

### Objects Not Selectable
- Make sure **Transform Controls** are enabled (button should say "✋ Disable Transform")
- Ensure you're clicking on a named object from the scene
- Check console for errors

### Animation Doesn't Play
- Verify the trigger conditions match (e.g., onLoad triggers only fire once)
- Check that `animations_gsap.json` is in the `wwwroot/` directory
- Open browser console to see animation logs

### Keyframe Not Recording
- Ensure an object is selected (object info should show the name)
- Enter a valid time in seconds (numeric value)
- Check console for error messages

### Transform Gizmo Not Visible
- Click the object again to ensure it's selected
- Check that transform controls are enabled
- Try switching modes with `G`, `R`, or `S`

## Advanced Usage

### Custom Event Triggering

In your code, trigger animations with:

```javascript
// Trigger all animations with "custom" trigger type and matching eventName
window.dispatchEvent(new CustomEvent('gameStart'));
```

### Character Change Events

The system automatically listens to `characterChanged` events:

```javascript
window.addEventListener('characterChanged', (event) => {
  // event.detail.role = 'hunter' or 'survivor'
  // Animations with matching role will play automatically
});
```

### Playing Animations Programmatically

```javascript
// Get animation ID from saved list
playAnimation('1234567890');
```

## Credits

- **GSAP**: GreenSock Animation Platform (https://greensock.com)
- **Three.js**: 3D library and TransformControls
- **Design**: Inspired by professional animation tools like Blender and Unity

---

For questions or issues, check the browser console for detailed logs.
