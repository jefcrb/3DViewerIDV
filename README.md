# IDV 3D graphics customization

[简体中文](README_CN.md)
This project is a plugin for [neo-bpsys-wpf](https://github.com/PLFJY/neo-bpsys-wpf) to support 3D graphics.

**!! This project is new and only tested on my own PC and full of bugs, feel free to give feedback (discord: dostojefsky)**

![showcase](assets/showcase.gif)

## Setup

1. Install [neo-bpsys-wpf](https://github.com/PLFJY/neo-bpsys-wpf/releases/tag/v2.1.0-beta%2B1e61260) and install from plugin store, or:
2. Clone this repository (or download as zip and extract):
   ```
   git clone git@github.com:jefcrb/3DViewerIDV.git
   ```
3. Move project to `%APPDATA%\neo-bpsys-wpf\Plugins`:
   ```
   mv 3DViewerIDV %APPDATA%\neo-bpsys-wpf\Plugins
   ```

   

## Quick Start
![settingspage](assets/settingspage.png)

1. Upload your own .glb scene or use the built-in one, you can edit it using 3D editing software like Blender or [threejs editor](https://threejs.org/editor/)
2. Download the character models
3. Start dev server and open the url http://localhost:9090?dev=true
4. Edit components, add characters, create animations as you like
5. Preview your creation
6. Configure OBS to use the OBS url as a browser source


## Features

Configure your own lighting, camera positions renderer settings and more in the dev panel.
Create your own keyframe animations to move lights or the camera based on various triggers.
![Camera moves when hunter is selected](assets/showcase2.gif)
![Light moves forever](assets/showcase3.gif)
