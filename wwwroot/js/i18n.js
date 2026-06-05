// In-browser translation table. Keys are namespaced by where the string lives so
// the same English word can translate differently depending on context (e.g.
// `common.play` vs `animations.play`). `t(key)` falls back to the English value
// when a translation is missing, and to the key itself as a last resort, so a
// missing entry never blanks out the UI.

const SUPPORTED = ['en', 'zh'];
const LS_KEY = 'viewer.lang';

const translations = {
    en: {
        // === top action bar ===
        'topActions.switchToEditor': 'Switch to Editor',
        'topActions.switchToLive': 'Switch to Live',
        'topActions.export': 'Export',
        'topActions.exportTitle': 'Download viewer_settings.json',
        'topActions.import': 'Import',
        'topActions.importTitle': 'Replace settings from a JSON file',
        'topActions.langToggle': '中文',

        // === editor header ===
        'header.title': '3D EDITOR',
        'header.translateTitle': 'Translate (W)',
        'header.rotateTitle': 'Rotate (E)',
        'header.scaleTitle': 'Scale (R)',
        'header.deselectTitle': 'Deselect (Esc)',
        'header.save': 'Save',
        'header.saveTitle': 'Save all (auto-saves on change)',

        // === tab labels ===
        'tabs.lights': 'Lights',
        'tabs.characters': 'Characters',
        'tabs.cameras': 'Cameras',
        'tabs.world': 'World',
        'tabs.animations': 'Animations (BETA)',

        // === lights panel ===
        'lights.addLight': '+ Add Light',
        'lights.color': 'Color',
        'lights.ground': 'Ground',
        'lights.intensity': 'Intensity',
        'lights.pos': 'Pos',
        'lights.target': 'Target',
        'lights.angle': 'Angle',
        'lights.penumbra': 'Penumbra',
        'lights.distance': 'Distance',
        'lights.castShadows': 'Cast shadows',
        'lights.types.Directional': 'Directional',
        'lights.types.Point': 'Point',
        'lights.types.Spot': 'Spot',
        'lights.types.Hemisphere': 'Hemisphere',
        'lights.types.Ambient': 'Ambient',

        // === characters / slots panel ===
        'characters.addCharacter': '+ Add Character',
        'characters.allInUse': 'All character slots are in use.',
        'characters.position': 'Position',
        'characters.rotation': 'Rotation',
        'characters.scale': 'Scale',

        // === cameras panel ===
        'cameras.live': 'Live (Broadcast) Camera',
        'cameras.position': 'Position',
        'cameras.rotationDeg': 'Rotation (deg)',
        'cameras.fov': 'FOV',
        'cameras.snap': 'Snap to editor',
        'cameras.attachGizmo': 'Attach gizmo',

        // === world panel ===
        'world.background': 'Background',
        'world.skyboxColor': 'Skybox color',
        'world.shadows': 'Shadows',
        'world.enabled': 'Enabled',
        'world.filter': 'Filter',
        'world.mapSize': 'Map size',
        'world.bias': 'Bias',
        'world.normalBias': 'Normal bias',
        'world.softness': 'Softness (radius)',
        'world.dirBounds': 'Directional bounds',
        'world.dirFar': 'Directional far',
        'world.toneMapping': 'Tone mapping',
        'world.toneMode': 'Mode',
        'world.exposure': 'Exposure',

        // === animations panel ===
        'animations.experimental': '<strong>Experimental:</strong> this feature is still in development and may misbehave or change between updates.',
        'animations.newSequence': '+ New Sequence',
        'animations.stopAll': '■ Stop All',
        'animations.animating': 'Animating:',
        'animations.attachGizmo': 'Click to attach gizmo',
        'animations.resetTitle': 'Jump back to the value in this sequence’s first keyframe',
        'animations.noKeyframesYet': 'No keyframes yet — record one to define a home pose',
        'animations.noTarget': 'No target — recreate the sequence to pick one.',
        'animations.loop': 'Loop',
        'animations.triggers': 'Triggers:',
        'animations.startTriggers': 'Start triggers:',
        'animations.stopTriggers': 'Stop triggers:',
        'animations.keyframes': 'Keyframes',
        'animations.recordAtTime': '● Record at time',
        'animations.recordAtTimeTitle': 'Snapshot the current scene at this time',
        'animations.easingToNext': 'Easing (to next)',
        'animations.easingTooltip': 'Curve used from this keyframe to the next',
        'animations.noTriggersInline': 'no triggers',
        'animations.noTarget2': 'no target',
        'animations.start': 'start',
        'animations.on': 'on',
        'animations.stop': 'stop',
        'animations.none': 'none',
        'animations.noChange': 'no change',
        'animations.startPrefix': 'start',
        'animations.keyframeTime': 'Keyframe time',
        'animations.duplicateKf': 'Duplicate this keyframe at the end of the sequence (+1s)',
        'animations.deleteKf': 'Delete this keyframe',
        'animations.playTitle': 'Play',
        'animations.stopTitle': 'Stop',
        'animations.duplicateSeq': 'Duplicate this sequence',
        'animations.deleteSeq': 'Delete this sequence',
        'animations.loopTag': 'loop',

        // === common ===
        'common.position': 'Position',
        'common.rotation': 'Rotation',
        'common.scale': 'Scale',
    },

    zh: {
        // === top action bar ===
        'topActions.switchToEditor': '切换到编辑器',
        'topActions.switchToLive': '切换到直播',
        'topActions.export': '导出',
        'topActions.exportTitle': '下载 viewer_settings.json',
        'topActions.import': '导入',
        'topActions.importTitle': '从 JSON 文件替换设置',
        'topActions.langToggle': 'EN',

        // === editor header ===
        'header.title': '3D 编辑器',
        'header.translateTitle': '平移 (W)',
        'header.rotateTitle': '旋转 (E)',
        'header.scaleTitle': '缩放 (R)',
        'header.deselectTitle': '取消选择 (Esc)',
        'header.save': '保存',
        'header.saveTitle': '保存全部（更改时自动保存）',

        // === tab labels ===
        'tabs.lights': '灯光',
        'tabs.characters': '角色',
        'tabs.cameras': '相机',
        'tabs.world': '世界',
        'tabs.animations': '动画 (测试版)',

        // === lights panel ===
        'lights.addLight': '+ 添加灯光',
        'lights.color': '颜色',
        'lights.ground': '地面色',
        'lights.intensity': '强度',
        'lights.pos': '位置',
        'lights.target': '目标',
        'lights.angle': '角度',
        'lights.penumbra': '半影',
        'lights.distance': '距离',
        'lights.castShadows': '投射阴影',
        'lights.types.Directional': '平行光',
        'lights.types.Point': '点光源',
        'lights.types.Spot': '聚光灯',
        'lights.types.Hemisphere': '半球光',
        'lights.types.Ambient': '环境光',

        // === characters / slots panel ===
        'characters.addCharacter': '+ 添加角色',
        'characters.allInUse': '所有角色位都已使用。',
        'characters.position': '位置',
        'characters.rotation': '旋转',
        'characters.scale': '缩放',

        // === cameras panel ===
        'cameras.live': '直播相机',
        'cameras.position': '位置',
        'cameras.rotationDeg': '旋转 (度)',
        'cameras.fov': '视野',
        'cameras.snap': '对齐到编辑器',
        'cameras.attachGizmo': '附加控件',

        // === world panel ===
        'world.background': '背景',
        'world.skyboxColor': '天空盒颜色',
        'world.shadows': '阴影',
        'world.enabled': '启用',
        'world.filter': '过滤',
        'world.mapSize': '贴图大小',
        'world.bias': '偏移',
        'world.normalBias': '法线偏移',
        'world.softness': '柔和度 (半径)',
        'world.dirBounds': '平行光范围',
        'world.dirFar': '平行光远端',
        'world.toneMapping': '色调映射',
        'world.toneMode': '模式',
        'world.exposure': '曝光',

        // === animations panel ===
        'animations.experimental': '<strong>实验性功能：</strong> 此功能仍在开发中，可能会出现问题或在更新中发生变化。',
        'animations.newSequence': '+ 新建动画',
        'animations.stopAll': '■ 全部停止',
        'animations.animating': '动画对象：',
        'animations.attachGizmo': '点击附加控件',
        'animations.resetTitle': '跳回此动画第一个关键帧的值',
        'animations.noKeyframesYet': '还没有关键帧 — 记录一个以定义起始姿态',
        'animations.noTarget': '无目标 — 重新创建动画以选择目标。',
        'animations.loop': '循环',
        'animations.triggers': '触发器：',
        'animations.startTriggers': '启动触发器：',
        'animations.stopTriggers': '停止触发器：',
        'animations.keyframes': '关键帧',
        'animations.recordAtTime': '● 在该时间记录',
        'animations.recordAtTimeTitle': '在该时间记录当前场景的快照',
        'animations.easingToNext': '缓动 (到下一个)',
        'animations.easingTooltip': '从该关键帧到下一个关键帧使用的曲线',
        'animations.noTriggersInline': '无触发器',
        'animations.noTarget2': '无目标',
        'animations.start': '启动',
        'animations.on': '触发',
        'animations.stop': '停止',
        'animations.none': '无',
        'animations.noChange': '无变化',
        'animations.startPrefix': '起始',
        'animations.keyframeTime': '关键帧时间',
        'animations.duplicateKf': '在动画末尾复制此关键帧 (+1秒)',
        'animations.deleteKf': '删除此关键帧',
        'animations.playTitle': '播放',
        'animations.stopTitle': '停止',
        'animations.duplicateSeq': '复制此动画',
        'animations.deleteSeq': '删除此动画',
        'animations.loopTag': '循环',

        // === common ===
        'common.position': '位置',
        'common.rotation': '旋转',
        'common.scale': '缩放',
    }
};

function readStoredLang() {
    try {
        const v = localStorage.getItem(LS_KEY);
        return SUPPORTED.includes(v) ? v : 'en';
    } catch {
        return 'en';
    }
}

let currentLang = readStoredLang();

export function getLanguage() {
    return currentLang;
}

export function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) return;
    if (lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(LS_KEY, lang); } catch {}
}

// Toggle between supported languages and reload so every render function picks
// up the new strings. Editor state is autosaved so nothing is lost.
export function toggleLanguage() {
    const idx = SUPPORTED.indexOf(currentLang);
    setLanguage(SUPPORTED[(idx + 1) % SUPPORTED.length]);
    location.reload();
}

// `key` is a dot-namespaced lookup. Falls back to English, then to `key` itself.
export function t(key) {
    return translations[currentLang]?.[key]
        ?? translations.en[key]
        ?? key;
}
