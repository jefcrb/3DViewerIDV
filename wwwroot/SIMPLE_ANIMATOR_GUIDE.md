# Simple Animator - User Guide

## Super Simple Workflow

This animator has been redesigned to be dead simple. No complex timelines or keyframes - just drag objects and build animation steps.

## 4-Step Process

### **Step 1: Select Object**
Click any object from the list:
- Camera
- Lights (keyLight, fillLight, etc.)
- Any mesh or group from scene.glb

Transform controls automatically appear on the selected object.

### **Step 2: Record FROM Position**
1. Drag the object to its **starting position**
2. Click **"📍 Record FROM Position"**
3. You'll see: "✓ FROM position recorded"

### **Step 3: Add to Chain**
1. **Drag the object** to its **target position**
2. Set **Duration** (e.g., 2000ms = 2 seconds)
3. Choose **Easing** (Ease Out recommended)
4. Click **"➕ Add to Chain"**

The animation step is added to the chain!

**Want multiple steps?**
- Repeat steps 2-3 to add more movements
- Can animate the same object multiple times
- Can switch objects and animate different objects

### **Step 4: Set Trigger & Save**
1. Name your animation (e.g., "intro_camera")
2. Choose trigger:
   - **On Load**: Plays when scene loads
   - **Time Delay**: Plays after X milliseconds
   - **Character Change**: Plays when hunter/survivor selected
   - **Custom Event**: Your own JavaScript event
3. Click **"▶ Preview"** to test
4. Click **"💾 Save Animation"**

Your `animations_gsap.json` downloads - place it in `wwwroot/` to persist!

## Keyboard Shortcuts

While an object is selected:
- **G** - Switch to Move mode
- **R** - Switch to Rotate mode
- **S** - Switch to Scale mode

## Example: Camera Intro Animation

1. **Select** "camera" from list
2. **Drag camera** far away and up (e.g., x:-10, y:8, z:15)
3. Click **"Record FROM"**
4. **Drag camera** close to center (e.g., x:0, y:5, z:10)
5. Set duration: **2000ms**
6. Set easing: **Ease Out**
7. Click **"Add to Chain"**
8. Name: **"intro_camera"**
9. Trigger: **On Load**, Delay: **500ms**
10. **Preview** → **Save**

Done! Camera will sweep in every time the page loads.

## Example: Multi-Step Animation

Create a camera tour with 3 movements:

**Step 1:**
- Select camera
- Record FROM at position A
- Move to position B (duration: 2000ms)
- Add to chain

**Step 2:**
- Record FROM at current position B
- Move to position C (duration: 1500ms)
- Add to chain

**Step 3:**
- Record FROM at current position C
- Move to position D (duration: 2000ms)
- Add to chain

Now you have a 3-step camera tour! Preview and save.

## Managing Animations

### Edit Chain
- Click **✕** next to any step to remove it
- Click **"🗑️ Clear Chain"** to start over

### Saved Animations
- Click **▶** to play any saved animation
- Click **✕** to delete

## Tips

1. **Preview Often** - Click preview before saving to make sure it looks good
2. **Start Simple** - Begin with 1-2 steps, add more later
3. **Use Ease Out** - Makes animations feel smooth and natural
4. **Record FROM First** - Always record starting position before moving to target
5. **Multiple Objects** - You can animate camera, then lights, then meshes in one chain

## Troubleshooting

**"Add to Chain" is disabled**
→ You need to record a FROM position first

**Objects don't move when I drag**
→ Make sure an object is selected (transform controls should be visible)

**Animation doesn't play**
→ Check trigger conditions match (e.g., onLoad only fires once on page load)

**Preview does nothing**
→ You need at least one step in the chain

## That's It!

No complex timelines, no confusing keyframes. Just:
1. Select
2. Record FROM
3. Move & Add to Chain
4. Save

Enjoy animating! 🎬
