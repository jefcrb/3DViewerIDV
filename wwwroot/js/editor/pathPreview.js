// Visualizes the interpolation path between two consecutive keyframes for the
// currently selected keyframe. Only draws for position (a straight line — the
// snapshot interp is per-component linear; easing controls timing along that
// line, not its shape) and for liveCamera rotation (forward-direction arrows
// at each endpoint). Light "rotation" isn't meaningful here — lights are aimed
// via their target point.
//
// Re-renders cheaply: the group is destroyed + rebuilt on every showPath call.
// Geometry is tiny (a 2-vertex line + two small spheres + maybe two arrows).

import * as THREE from 'three';
import { registry } from './registry.js';

const pathsBySeq = new Map(); // seqId -> THREE.Group

const COLOR_FROM = 0x5a4baf;
const COLOR_TO   = 0x9b85ff;
const COLOR_LINE = 0x7b61ff;

function getPosition(snapshot, target) {
    if (!snapshot) return null;
    if (target === 'liveCamera') return snapshot.liveCamera?.position;
    if (target.startsWith('light:')) {
        return snapshot.lights?.[target.slice('light:'.length)]?.position;
    }
    if (target.startsWith('slot:')) {
        return snapshot.slots?.[target.slice('slot:'.length)]?.position;
    }
    return null;
}

function getRotation(snapshot, target) {
    if (!snapshot) return null;
    if (target === 'liveCamera') return snapshot.liveCamera?.rotation;
    if (target.startsWith('slot:')) {
        return snapshot.slots?.[target.slice('slot:'.length)]?.rotation;
    }
    return null;
}

function disposeGroup(group) {
    group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => m && m.dispose());
        }
    });
}

function overlayBasicMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        depthTest: false, depthWrite: false
    });
}

function addForwardArrow(group, position, rotation, color) {
    // Camera looks down -Z in its local frame.
    const dir = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'));
    const arrow = new THREE.ArrowHelper(
        dir,
        new THREE.Vector3(...position),
        0.6,    // shaft length
        color,
        0.15,   // head length
        0.08    // head width
    );
    [arrow.line.material, arrow.cone.material].forEach(m => {
        m.depthTest = false;
        m.depthWrite = false;
    });
    arrow.line.renderOrder = 999;
    arrow.cone.renderOrder = 999;
    group.add(arrow);
}

export function hidePath(seqId) {
    const group = pathsBySeq.get(seqId);
    if (!group) return;
    if (registry.scene) registry.scene.remove(group);
    disposeGroup(group);
    pathsBySeq.delete(seqId);
}

export function hideAllPaths() {
    for (const seqId of Array.from(pathsBySeq.keys())) hidePath(seqId);
}

export function showPath(seq, kf, prevKf) {
    const scene = registry.scene;
    if (!scene) return;
    hidePath(seq.id);

    const target = seq.targets[0];
    if (!target || !prevKf) return;

    const fromPos = getPosition(prevKf.snapshot, target);
    const toPos = getPosition(kf.snapshot, target);
    if (!fromPos || !toPos) return;

    const group = new THREE.Group();
    group.userData.isPathPreview = true;

    // Line between positions
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...fromPos),
        new THREE.Vector3(...toPos)
    ]);
    const lineMat = new THREE.LineBasicMaterial({
        color: COLOR_LINE, transparent: true, opacity: 0.9,
        depthTest: false, depthWrite: false
    });
    const line = new THREE.Line(lineGeom, lineMat);
    line.renderOrder = 999;
    group.add(line);

    // From marker (smaller, darker)
    const fromSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        overlayBasicMaterial(COLOR_FROM, 0.75)
    );
    fromSphere.position.set(...fromPos);
    fromSphere.renderOrder = 999;
    group.add(fromSphere);

    // To marker (larger, brighter — this is the keyframe the user just selected)
    const toSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        overlayBasicMaterial(COLOR_TO, 0.95)
    );
    toSphere.position.set(...toPos);
    toSphere.renderOrder = 999;
    group.add(toSphere);

    // Forward-direction arrows only for camera targets (lights don't have a
    // rotation that's meaningful for visualization; slot/character rotation is
    // model-dependent so the +Z/-Z convention is unreliable).
    if (target === 'liveCamera') {
        const fromRot = getRotation(prevKf.snapshot, target);
        const toRot = getRotation(kf.snapshot, target);
        if (fromRot) addForwardArrow(group, fromPos, fromRot, COLOR_FROM);
        if (toRot) addForwardArrow(group, toPos, toRot, COLOR_TO);
    }

    scene.add(group);
    pathsBySeq.set(seq.id, group);
}
