import {moveCursor} from './cursor.js';
import {
    clear,
    cloneObjects,
    createCallout,
    createComment,
    createFrame,
    createConnector,
    createImageObject,
    createLabel,
    createList,
    createPath,
    createShape,
    createSticky,
    createText,
    deleteObjectById,
    deleteObjectsByIds,
    duplicateObject,
    duplicateObjects,
    exportBoardPdf,
    exportBoardPng,
    exportBoardSvg,
    draw,
    findObjectAt,
    floodFill,
    getObjectBounds,
    getObjectsInBounds,
    getObjectsBounds,
    getSelectedObjects,
    getSelectedObjectsBounds,
    groupObjects,
    moveObjects,
    moveObjectLayer,
    normalizeFrame,
    copyBoardImage,
    redo,
    render,
    resizeObjects,
    rotateObjects,
    saveHistory,
    setObjectsLocked,
    ungroupObjects,
    undo,
} from './drawing.js';
import {getObjectName} from './activity.js';
import {app, setMousePosition} from './main.js';
import {broadcastActivity, broadcastBoardState, sendCursorPosition, sendLaserPosition, sendSelectionState} from './network.js';
import {activateMovingToolbar, deactivateMovingToolbar, hideToolbar, moveToolbar, showToolbar} from './toolbar.js';
import {clampZoomOffset, getCanvasPoint, getCanvasTransform, hexToRgba} from './utils.js';

const fillColorInput = document.getElementById('fillColor');
const linePreview = document.querySelector('.line-width-preview');
const remoteCursors = document.querySelector('.remote-cursors');
const presence = document.querySelector('.presence');
const shareButton = document.querySelector('.share-button');
const fitBoardButton = document.querySelector('.fit-board');
const zoomSelectionButton = document.querySelector('.zoom-selection');
const toolTooltip = document.querySelector('.tool-tooltip');
const toolMenuTriggers = document.querySelectorAll('.tool-menu-trigger');
const imageImportInput = document.getElementById('imageImport');
const minimap = document.querySelector('.minimap');
const minimapSvg = document.querySelector('.minimap svg');
const laserLayer = document.querySelector('.laser-layer');
const snapshotPanel = document.querySelector('.snapshot-panel');
const snapshotList = document.querySelector('.snapshot-list');
const snapshotClose = document.querySelector('.snapshot-close');
const selectionActionIds = ['duplicate', 'group', 'ungroup', 'lock', 'unlock', 'bringForward', 'sendBackward'];

function addListener(element, events, listener) {
    events.forEach(ev => {
        element.addEventListener(ev, listener);
    });
}

function setActiveTool(button) {
    app.allTools.forEach(el => el.classList.remove('active'));
    toolMenuTriggers.forEach(resetToolMenuTrigger);
    app.currentTool = button.getAttribute('id');
    button.classList.add('active');
    updateActiveToolMenu(button);
    app.selectedObjectId = null;
    app.selectedObjectIds = [];
    app.lassoBounds = null;
    render();
}

function getTooltipText(element) {
    return element?.dataset.tooltip || element?.getAttribute('aria-label') || '';
}

function setupTooltips() {
    document.querySelectorAll('[title], .line-width-preview').forEach(element => {
        const title = element.getAttribute('title');
        const label = title || element.getAttribute('aria-label');

        if (!label) {
            return;
        }

        element.dataset.tooltip = label;
        element.removeAttribute('title');
    });
}

function positionTooltip(target) {
    if (!toolTooltip) {
        return;
    }

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = toolTooltip.getBoundingClientRect();
    const gap = 10;
    let left = targetRect.left + targetRect.width / 2;
    let top = targetRect.top - tooltipRect.height / 2 - gap;

    if (targetRect.top >= tooltipRect.height + gap + 8) {
        top = targetRect.top - tooltipRect.height / 2 - gap;
    } else if (window.innerHeight - targetRect.bottom >= tooltipRect.height + gap + 8) {
        top = targetRect.bottom + tooltipRect.height / 2 + gap;
    } else if (window.innerWidth - targetRect.right >= tooltipRect.width + gap + 8) {
        left = targetRect.right + tooltipRect.width / 2 + gap;
        top = targetRect.top + targetRect.height / 2;
    } else if (targetRect.left >= tooltipRect.width + gap + 8) {
        left = targetRect.left - tooltipRect.width / 2 - gap;
        top = targetRect.top + targetRect.height / 2;
    } else {
        top = Math.min(window.innerHeight - tooltipRect.height / 2 - 8, targetRect.bottom + tooltipRect.height / 2 + gap);
    }

    left = Math.max(tooltipRect.width / 2 + 8, Math.min(window.innerWidth - tooltipRect.width / 2 - 8, left));
    top = Math.max(tooltipRect.height / 2 + 8, Math.min(window.innerHeight - tooltipRect.height / 2 - 8, top));
    toolTooltip.style.left = `${left}px`;
    toolTooltip.style.top = `${top}px`;
}

function showTooltip(target) {
    const text = getTooltipText(target);

    if (!toolTooltip || !text) {
        return;
    }

    toolTooltip.textContent = text;
    toolTooltip.classList.add('visible');
    positionTooltip(target);
}

function hideTooltip() {
    toolTooltip?.classList.remove('visible');
}

function initTooltips() {
    setupTooltips();

    document.addEventListener('mouseover', event => {
        const target = event.target.closest('[data-tooltip]');

        if (target) {
            showTooltip(target);
        }
    });
    document.addEventListener('mouseout', event => {
        const target = event.target.closest('[data-tooltip]');

        if (target && !target.contains(event.relatedTarget)) {
            hideTooltip();
        }
    });
    document.addEventListener('focusin', event => {
        const target = event.target.closest('[data-tooltip]');

        if (target) {
            showTooltip(target);
        }
    });
    document.addEventListener('focusout', hideTooltip);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
}

function resetToolMenuTrigger(trigger) {
    trigger.classList.remove('active');

    if (!trigger.dataset.defaultIcon) {
        trigger.dataset.defaultIcon = trigger.innerHTML;
    }

    if (!trigger.dataset.defaultLabel) {
        trigger.dataset.defaultLabel = getTooltipText(trigger);
    }

    trigger.innerHTML = trigger.dataset.defaultIcon;
    trigger.dataset.tooltip = trigger.dataset.defaultLabel;
    trigger.setAttribute('aria-label', trigger.dataset.defaultLabel);
}

function initToolMenuTriggers() {
    toolMenuTriggers.forEach(trigger => {
        trigger.dataset.defaultIcon = trigger.innerHTML;
        trigger.dataset.defaultLabel = getTooltipText(trigger);
    });
}

function updateActiveToolMenu(button) {
    const trigger = button.closest('.tool-menu')?.querySelector('.tool-menu-trigger');

    if (!trigger) {
        return;
    }

    const label = getTooltipText(button);
    trigger.classList.add('active');
    trigger.innerHTML = button.innerHTML;
    trigger.dataset.tooltip = label;
    trigger.setAttribute('aria-label', label);
}

function applyCanvasTransform() {
    clampZoomOffset();
    app.canvas.style.transform = getCanvasTransform();
    app.svg.style.transform = getCanvasTransform();
    updateRemoteCursors();
    updateRemoteLasers();
    updateMinimap();
}

function setZoomValue(scale) {
    const maxScale = app.zoom._steps[app.zoom._steps.length - 1];
    const clampedScale = Math.max(app.zoom._steps[0], Math.min(maxScale, scale));
    app.zoom.scale = Math.round(clampedScale * 100) / 100;
    document.querySelector('.zoom-container .value').textContent = `${Math.round(app.zoom.scale * 100)}%`;
    document.body.style.setProperty('--scale', app.zoom.scale);
}

function fitBoundsToScreen(bounds) {
    if (!bounds || !bounds.width || !bounds.height) {
        return;
    }

    const padding = 96;
    const availableWidth = Math.max(240, window.innerWidth - padding);
    const availableHeight = Math.max(240, window.innerHeight - padding);
    const scale = Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height);

    setZoomValue(scale);
    app.zoom.offsetX = window.innerWidth / 2 / app.zoom.scale - (bounds.x + bounds.width / 2);
    app.zoom.offsetY = window.innerHeight / 2 / app.zoom.scale - (bounds.y + bounds.height / 2);
    applyCanvasTransform();
}

function setSelection(objects) {
    const groupIds = new Set(objects.map(object => object.groupId).filter(Boolean));
    const expandedObjects = groupIds.size
        ? app.objects.filter(object => groupIds.has(object.groupId))
        : objects;
    app.selectedObjectIds = expandedObjects.map(object => object.id);
    app.selectedObjectId = app.selectedObjectIds[0] || null;
    sendSelectionState(app.selectedObjectIds);
    updateToolbarState();
    render();
}

function updateToolbarState() {
    const selectedObjects = getSelectedObjects();
    const hasSelection = selectedObjects.length > 0;
    const hasMultiSelection = selectedObjects.length > 1;
    const hasGroupSelection = selectedObjects.some(object => object.groupId);
    const hasUnlockedSelection = selectedObjects.some(object => !object.locked);
    const hasLockedSelection = selectedObjects.some(object => object.locked);

    selectionActionIds.forEach(id => {
        const button = document.getElementById(id);

        if (!button) {
            return;
        }

        if (id === 'group') {
            button.disabled = !hasMultiSelection;
        } else if (id === 'ungroup') {
            button.disabled = !hasGroupSelection;
        } else if (id === 'lock') {
            button.disabled = !hasUnlockedSelection;
        } else if (id === 'unlock') {
            button.disabled = !hasLockedSelection;
        } else {
            button.disabled = !hasSelection;
        }
    });
}

function getNormalizedBounds(start, end) {
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
    };
}

function getResizeHandleAt(point) {
    const bounds = getSelectedObjectsBounds();

    if (!bounds) {
        return null;
    }

    const size = Math.max(12, 14 / app.zoom.scale);
    const handles = [
        {handle: 'nw', x: bounds.x, y: bounds.y},
        {handle: 'ne', x: bounds.x + bounds.width, y: bounds.y},
        {handle: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height},
        {handle: 'sw', x: bounds.x, y: bounds.y + bounds.height},
    ];

    return handles.find(item => (
        Math.abs(point.x - item.x) <= size &&
        Math.abs(point.y - item.y) <= size
    ))?.handle || null;
}

function beginResize(handle) {
    const selectedObjects = getSelectedObjects().filter(object => !object.locked);

    if (!handle || !selectedObjects.length) {
        return false;
    }

    const objectsToResize = new Set(selectedObjects);
    selectedObjects.forEach(object => {
        if (object.linkedObjectIds?.length) {
            app.objects
                .filter(item => object.linkedObjectIds.includes(item.id))
                .forEach(item => objectsToResize.add(item));
        }

        app.objects
            .filter(item => item.linkedObjectIds?.includes(object.id))
            .forEach(item => objectsToResize.add(item));
    });

    app.drag.resizeHandle = handle;
    app.drag.resizeBounds = getSelectedObjectsBounds();
    app.drag.resizeObjects = [...objectsToResize].map(object => ({
        object,
        bounds: getObjectBounds(object),
        original: {...object},
        points: object.points?.map(point => ({...point})) || null,
    }));
    saveHistory();
    return true;
}

function beginRotate(point) {
    const selectedObjects = getSelectedObjects().filter(object => !object.locked);
    const bounds = getSelectedObjectsBounds();

    if (!selectedObjects.length || !bounds) {
        return false;
    }

    const center = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    app.drag.rotateStart = {
        center,
        angle: Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI,
        rotations: new Map(selectedObjects.map(object => [object.id, object.rotation || 0])),
    };
    app.drag.rotateObjects = selectedObjects;
    saveHistory();
    return true;
}

function getRotateHandleAt(point) {
    const bounds = getSelectedObjectsBounds();

    if (!bounds) {
        return false;
    }

    const handle = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y - Math.max(34, 34 / app.zoom.scale),
    };
    const size = Math.max(14, 16 / app.zoom.scale);
    return Math.abs(point.x - handle.x) <= size && Math.abs(point.y - handle.y) <= size;
}

function updateRotate(point, event) {
    if (!app.drag.rotateStart || !app.drag.rotateObjects) {
        return;
    }

    const angle = Math.atan2(
        point.y - app.drag.rotateStart.center.y,
        point.x - app.drag.rotateStart.center.x,
    ) * 180 / Math.PI;
    let angleDelta = angle - app.drag.rotateStart.angle;

    if (event?.shiftKey) {
        angleDelta = Math.round(angleDelta / 15) * 15;
    }

    rotateObjects(app.drag.rotateObjects, app.drag.rotateStart.rotations, angleDelta);
    app.drag.moved = true;
    render();
}

function getResizedBounds(startBounds, handle, point) {
    const minSize = 16;
    const left = handle.includes('w') ? Math.min(point.x, startBounds.x + startBounds.width - minSize) : startBounds.x;
    const right = handle.includes('e') ? Math.max(point.x, startBounds.x + minSize) : startBounds.x + startBounds.width;
    const top = handle.includes('n') ? Math.min(point.y, startBounds.y + startBounds.height - minSize) : startBounds.y;
    const bottom = handle.includes('s') ? Math.max(point.y, startBounds.y + minSize) : startBounds.y + startBounds.height;

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

function updateResize(point) {
    if (!app.drag.resizeHandle || !app.drag.resizeBounds || !app.drag.resizeObjects) {
        return;
    }

    resizeObjects(
        app.drag.resizeObjects,
        app.drag.resizeBounds,
        getResizedBounds(app.drag.resizeBounds, app.drag.resizeHandle, point),
    );
    app.drag.moved = true;
    render();
}

function startPath(point) {
    const isEraser = app.currentTool === 'eraser';
    const isPencil = app.currentTool === 'pencil';
    app.draftObject = createPath(
        point,
        isEraser ? 'white' : app.fillColor,
        isPencil ? Math.max(2, Math.round(app.lineWidth * 0.45)) : app.lineWidth,
        app.currentTool === 'marker' ? 0.35 : isPencil ? 0.72 : 1,
    );
}

function startShape(point) {
    app.draftObject = createShape(app.currentTool, point, app.fillColor, app.lineWidth);
}

function finishDraft() {
    if (!app.draftObject) {
        return;
    }

    const object = app.draftObject;
    app.draftObject = null;

    if (object.type === 'path' && object.points.length < 2) {
        render();
        return;
    }

    if ('x2' in object && Math.abs(object.x2 - object.x) < 8 && Math.abs(object.y2 - object.y) < 8) {
        render();
        return;
    }

    if (object.type === 'frame') {
        normalizeFrame(object);
    }

    saveHistory();
    app.objects.push(object);
    setSelection([object]);
    render();
    broadcastBoardState();

    if (['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon', 'frame'].includes(object.type)) {
        broadcastActivity('shape-added', {
            color: object.color,
            objectId: object.id,
            objectType: object.type,
        });
    } else if (object.type === 'path' && app.currentTool !== 'eraser') {
        broadcastActivity('tool-used', {
            objectId: object.id,
            tool: app.currentTool === 'marker' ? 'marker' : app.currentTool === 'pencil' ? 'pencil' : 'pen',
        });
    }
}

function addTextObject(point, type) {
    const promptLabel = {
        callout: 'Callout text',
        label: 'Label text',
        list: 'List items, separated by commas',
        comment: 'Comment',
        sticky: 'Note content',
        text: 'Text',
    }[type] || 'Text';
    const text = window.prompt(promptLabel);

    if (!text?.trim()) {
        return;
    }

    const objectFactories = {
        callout: createCallout,
        label: createLabel,
        list: createList,
        comment: createComment,
        sticky: createSticky,
        text: createText,
    };
    const object = (objectFactories[type] || createText)(point, text.trim());
    saveHistory();
    app.objects.push(object);
    setSelection([object]);
    render();
    broadcastBoardState();
    broadcastActivity(type === 'sticky' ? 'sticky-added' : type === 'comment' ? 'comment-added' : 'text-added', {
        objectId: object.id,
        objectType: object.type,
        text,
    });
}

function moveSelectedObject(point) {
    const selectedObjects = getSelectedObjects();

    if (!selectedObjects.length || !app.drag.last) {
        return;
    }

    if (!app.drag.moved) {
        saveHistory();
    }

    moveObjects(selectedObjects, point.x - app.drag.last.x, point.y - app.drag.last.y);
    app.drag.last = point;
    app.drag.moved = true;
    render();
}

function movePan(e) {
    if (!app.drag.last) {
        return;
    }

    const dx = (e.clientX - app.drag.last.x) / app.zoom.scale;
    const dy = (e.clientY - app.drag.last.y) / app.zoom.scale;
    app.zoom.offsetX += dx;
    app.zoom.offsetY += dy;
    app.drag.last = {x: e.clientX, y: e.clientY};
    applyCanvasTransform();
}

function updateDraftShape(point) {
    if (!app.draftObject || !('x2' in app.draftObject)) {
        return;
    }

    app.draftObject.x2 = point.x;
    app.draftObject.y2 = point.y;
    render();
}

function updateLasso(point) {
    if (!app.drag.start) {
        return;
    }

    app.lassoBounds = getNormalizedBounds(app.drag.start, point);
    render();
}

function finishLasso() {
    if (!app.lassoBounds) {
        return;
    }

    const selectedObjects = getObjectsInBounds(app.lassoBounds).filter(object => object.type !== 'connector');
    setSelection(selectedObjects);
    app.lassoBounds = null;
    render();
}

function updateRemoteCursors() {
    if (!remoteCursors) {
        return;
    }

    const activePeerIds = new Set(app.collaborators.keys());

    remoteCursors.querySelectorAll('.remote-cursor').forEach(cursor => {
        if (!activePeerIds.has(cursor.dataset.userId)) {
            cursor.remove();
        }
    });

    app.collaborators.forEach(user => {
        let cursor = remoteCursors.querySelector(`[data-user-id="${user.id}"]`);

        if (!cursor) {
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.dataset.userId = user.id;
            cursor.style.setProperty('--remote-color', user.color);
            cursor.innerHTML = `<span>${user.name}</span>`;
            remoteCursors.appendChild(cursor);
        }

        cursor.style.left = `${(user.x + app.zoom.offsetX) * app.zoom.scale}px`;
        cursor.style.top = `${(user.y + app.zoom.offsetY) * app.zoom.scale}px`;

        if (app.followUserId === user.id) {
            app.zoom.offsetX = window.innerWidth / 2 / app.zoom.scale - user.x;
            app.zoom.offsetY = window.innerHeight / 2 / app.zoom.scale - user.y;
            clampZoomOffset();
            app.canvas.style.transform = getCanvasTransform();
            app.svg.style.transform = getCanvasTransform();
        }
    });

    if (presence) {
        presence.innerHTML = `
            <span class="avatar active" style="--avatar-color: ${app.localUser.color}" title="${app.localUser.name}">${app.localUser.initials}</span>
            ${[...app.collaborators.values()].map(user => (
                `<button class="avatar${app.followUserId === user.id ? ' following' : ''}" type="button" data-follow-user="${user.id}" style="--avatar-color: ${user.color}" title="Follow ${user.name}">${user.initials}</button>`
            )).join('')}
        `;
    }
}

function updateRemoteLasers() {
    if (!laserLayer) {
        return;
    }

    laserLayer.replaceChildren();
    app.collaborators.forEach(user => {
        if (!user.laser) {
            return;
        }

        if (user.laser.expiresAt && user.laser.expiresAt < Date.now()) {
            user.laser = null;
            return;
        }

        const dot = document.createElement('div');
        dot.className = 'laser-dot';
        dot.style.setProperty('--laser-color', user.color);
        dot.style.left = `${(user.laser.x + app.zoom.offsetX) * app.zoom.scale}px`;
        dot.style.top = `${(user.laser.y + app.zoom.offsetY) * app.zoom.scale}px`;
        dot.innerHTML = `<span>${user.name}</span>`;
        laserLayer.appendChild(dot);
    });
}

function updateMinimap() {
    if (!minimapSvg) {
        return;
    }

    const scaleX = 240 / app.canvas.width;
    const scaleY = 160 / app.canvas.height;
    const objectRects = app.objects
        .map(object => getObjectBounds(object))
        .filter(Boolean)
        .map(bounds => `<rect class="mini-object" x="${bounds.x * scaleX}" y="${bounds.y * scaleY}" width="${Math.max(1, bounds.width * scaleX)}" height="${Math.max(1, bounds.height * scaleY)}"></rect>`)
        .join('');
    const viewport = {
        x: -app.zoom.offsetX * scaleX,
        y: -app.zoom.offsetY * scaleY,
        width: window.innerWidth / app.zoom.scale * scaleX,
        height: window.innerHeight / app.zoom.scale * scaleY,
    };
    minimapSvg.innerHTML = `${objectRects}<rect class="mini-viewport" x="${viewport.x}" y="${viewport.y}" width="${viewport.width}" height="${viewport.height}"></rect>`;
}

function resizeImageForBoard(image, sourceType = 'image/png') {
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = sourceType === 'image/png' || sourceType === 'image/webp' ? sourceType : 'image/jpeg';
    const src = canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.86 : undefined);

    return {
        src,
        width: canvas.width,
        height: canvas.height,
    };
}

function loadImageFile(file, point = getCanvasPoint(window.innerWidth / 2, window.innerHeight / 2)) {
    if (!file?.type?.startsWith('image/')) {
        return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
        const image = new Image();
        image.addEventListener('load', () => {
            const resizedImage = resizeImageForBoard(image, file.type);
            const object = createImageObject(point, resizedImage.src, resizedImage.width, resizedImage.height);
            saveHistory();
            app.objects.push(object);
            setSelection([object]);
            broadcastBoardState();
            broadcastActivity('image-imported', {
                objectId: object.id,
                objectName: getObjectName(object),
            });
        });
        image.src = reader.result;
    });
    reader.readAsDataURL(file);
}

function getStoredSnapshots() {
    try {
        return JSON.parse(localStorage.getItem(`whiteboard:snapshots:${app.roomId}`) || '[]');
    } catch {
        return [];
    }
}

function getAllSnapshots() {
    const snapshots = [...app.snapshots, ...getStoredSnapshots()]
        .filter((snapshot, index, all) => all.findIndex(item => item.id === snapshot.id) === index)
        .slice(-10);

    return snapshots;
}

function renderSnapshotPanel() {
    if (!snapshotList) {
        return;
    }

    const snapshots = getAllSnapshots().slice().reverse();

    if (!snapshots.length) {
        snapshotList.innerHTML = '<li class="activity-empty">No snapshots yet</li>';
        return;
    }

    snapshotList.innerHTML = snapshots.map(snapshot => `
        <li class="snapshot-item">
            <div>
                <strong>${new Date(snapshot.timestamp).toLocaleString()}</strong>
                <span>${snapshot.objects?.length || 0} objects</span>
            </div>
            <button type="button" data-snapshot-id="${snapshot.id}">Restore</button>
        </li>
    `).join('');
}

function openSnapshotPanel() {
    renderSnapshotPanel();
    document.body.classList.add('snapshot-open');
}

function closeSnapshotPanel() {
    document.body.classList.remove('snapshot-open');
}

function restoreSnapshot(snapshot) {
    if (!snapshot) {
        return;
    }

    saveHistory();
    app.objects = cloneObjects(snapshot.objects || []);
    setSelection([]);
    broadcastBoardState({mode: 'replace'});
    broadcastActivity('snapshot-restored');
    closeSnapshotPanel();
}

async function copyShareLink() {
    const shareUrl = `${window.location.origin}/${app.roomId}`;

    try {
        await navigator.clipboard.writeText(shareUrl);
        shareButton.textContent = 'Copied';
    } catch {
        window.prompt('Copy board link', shareUrl);
        shareButton.textContent = 'Copy link';
    }

    window.setTimeout(() => {
        shareButton.textContent = 'Share';
    }, 1600);
}

export function initEvents() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    initTooltips();
    initToolMenuTriggers();
    window.updateRemoteCursors = updateRemoteCursors;
    window.whiteboardUpdateMinimap = updateMinimap;
    window.whiteboardUpdateRemoteLasers = updateRemoteLasers;
    updateToolbarState();
    window.setInterval(updateRemoteLasers, 500);
    const boardName = localStorage.getItem(`whiteboard:boardName:${app.roomId}`) || `Whiteboard / ${app.roomId.slice(0, 8)}`;
    document.querySelector('.board-title span:last-child').textContent = boardName;
    shareButton.addEventListener('click', copyShareLink);
    snapshotClose?.addEventListener('click', closeSnapshotPanel);
    snapshotList?.addEventListener('click', event => {
        const button = event.target.closest('[data-snapshot-id]');

        if (!button) {
            return;
        }

        const snapshot = getAllSnapshots().find(item => item.id === button.dataset.snapshotId);
        restoreSnapshot(snapshot);
    });
    presence?.addEventListener('click', event => {
        const followButton = event.target.closest('[data-follow-user]');

        if (!followButton) {
            return;
        }

        app.followUserId = app.followUserId === followButton.dataset.followUser ? null : followButton.dataset.followUser;
        updateRemoteCursors();
    });
    minimap?.addEventListener('click', event => {
        const rect = minimap.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * app.canvas.width;
        const y = (event.clientY - rect.top) / rect.height * app.canvas.height;
        app.zoom.offsetX = window.innerWidth / 2 / app.zoom.scale - x;
        app.zoom.offsetY = window.innerHeight / 2 / app.zoom.scale - y;
        applyCanvasTransform();
    });
    fitBoardButton.addEventListener('click', () => {
        fitBoundsToScreen(getObjectsBounds() || {x: 0, y: 0, width: app.canvas.width, height: app.canvas.height});
    });
    zoomSelectionButton.addEventListener('click', () => {
        fitBoundsToScreen(getSelectedObjectsBounds());
    });
    fillColorInput.addEventListener('input', () => {
        app.fillColor = fillColorInput.value;
    });
    imageImportInput?.addEventListener('change', event => {
        loadImageFile(event.target.files?.[0]);
        event.target.value = '';
    });
    window.addEventListener('paste', event => {
        const imageItem = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));

        if (imageItem) {
            loadImageFile(imageItem.getAsFile());
        }
    });
    window.addEventListener('dragover', event => {
        if ([...(event.dataTransfer?.items || [])].some(item => item.type.startsWith('image/'))) {
            event.preventDefault();
            document.body.classList.add('drag-import');
        }
    });
    window.addEventListener('dragleave', event => {
        if (!event.relatedTarget) {
            document.body.classList.remove('drag-import');
        }
    });
    window.addEventListener('drop', event => {
        const imageFile = [...(event.dataTransfer?.files || [])].find(file => file.type.startsWith('image/'));

        if (!imageFile) {
            return;
        }

        event.preventDefault();
        document.body.classList.remove('drag-import');
        loadImageFile(imageFile, getCanvasPoint(event.clientX, event.clientY));
    });

    linePreview.querySelector('.list').addEventListener('click', e => {
        const item = e.target.closest('.item');

        if (!item) {
            return;
        }

        linePreview.querySelectorAll('.list .item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const value = item.dataset.value;
        document.body.style.setProperty('--lineWidth', value + 'px');
        app.lineWidth = parseInt(value);
    });

    window.addEventListener('click', e => {
        const toolbarButton = e.target.closest('.toolbar button');
        const zoomButton = e.target.closest('.zoom-container .minus, .zoom-container .plus');

        if (toolbarButton) {
            if (toolbarButton.classList.contains('tool')) {
                setActiveTool(toolbarButton);
                return;
            }

            if (toolbarButton.id === 'clear') {
                const lockedObjects = app.objects.filter(object => object.locked);

                if (clear()) {
                    if (lockedObjects.length) {
                        app.objects = lockedObjects;
                        broadcastBoardState({mode: 'replace'});
                        render();
                    }
                    broadcastActivity('board-cleared');
                }
                return;
            }

            if (toolbarButton.id === 'undo') {
                if (undo()) {
                    broadcastActivity('history-used', {
                        action: 'undo',
                    });
                }
                return;
            }

            if (toolbarButton.id === 'redo') {
                if (redo()) {
                    broadcastActivity('history-used', {
                        action: 'redo',
                    });
                }
                return;
            }

            if (toolbarButton.id === 'duplicate') {
                const selectedObjects = getSelectedObjects();
                const duplicates = selectedObjects.length > 1 ? duplicateObjects(selectedObjects) : [];
                const duplicate = duplicates[0] || duplicateObject(app.selectedObjectId);

                if (duplicate || duplicates.length) {
                    broadcastActivity('object-duplicated', {
                        objectId: duplicates.length === 1 ? duplicates[0].id : duplicate?.id,
                        objectName: duplicates.length > 1 ? `${duplicates.length} objects` : getObjectName(duplicate || duplicates[0]),
                    });
                }
                return;
            }

            if (toolbarButton.id === 'group') {
                const selectedObjects = getSelectedObjects();
                const groupId = groupObjects(selectedObjects);

                if (groupId) {
                    broadcastActivity('objects-grouped', {
                        objectName: `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'ungroup') {
                const selectedObjects = getSelectedObjects();

                if (ungroupObjects(selectedObjects)) {
                    broadcastActivity('objects-ungrouped', {
                        objectName: `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'lock' || toolbarButton.id === 'unlock') {
                const selectedObjects = getSelectedObjects();
                const locked = toolbarButton.id === 'lock';

                if (setObjectsLocked(selectedObjects, locked)) {
                    broadcastActivity(locked ? 'objects-locked' : 'objects-unlocked', {
                        objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'bringForward' || toolbarButton.id === 'sendBackward') {
                const direction = toolbarButton.id === 'bringForward' ? 'forward' : 'backward';
                const object = moveObjectLayer(app.selectedObjectId, direction);

                if (object) {
                    broadcastActivity('object-layered', {
                        direction,
                        objectId: object.id,
                        objectName: getObjectName(object),
                    });
                }
                return;
            }

            if (toolbarButton.id === 'exportPng') {
                exportBoardPng();
                return;
            }

            if (toolbarButton.id === 'exportSvg') {
                exportBoardSvg();
                return;
            }

            if (toolbarButton.id === 'exportPdf') {
                exportBoardPdf();
                return;
            }

            if (toolbarButton.id === 'copyImage') {
                copyBoardImage().catch(() => false);
                return;
            }

            if (toolbarButton.id === 'importImage') {
                imageImportInput?.click();
                return;
            }

            if (toolbarButton.id === 'snapshot') {
                const serializableObjects = app.objects.filter(object => object.type !== 'bitmap');
                const snapshot = {
                    id: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    objects: cloneObjects(app.objects),
                };
                app.snapshots.push(snapshot);
                app.snapshots = app.snapshots.slice(-10);
                const storedSnapshots = [...getStoredSnapshots(), {
                    id: snapshot.id,
                    timestamp: snapshot.timestamp,
                    objects: JSON.parse(JSON.stringify(serializableObjects)),
                }].slice(-10);
                localStorage.setItem(`whiteboard:snapshots:${app.roomId}`, JSON.stringify(storedSnapshots));
                renderSnapshotPanel();
                broadcastActivity('snapshot-created');
                return;
            }

            if (toolbarButton.id === 'restoreSnapshot') {
                openSnapshotPanel();
                return;
            }
        }

        if (zoomButton) {
            const currentZoomIndex = app.zoom._steps.findIndex(v => v >= app.zoom.scale);
            const normalizedZoomIndex = currentZoomIndex === -1 ? app.zoom._steps.length - 1 : currentZoomIndex;
            document.querySelectorAll('.zoom-container .minus, .zoom-container .plus')
                .forEach(el => el.classList.remove('disabled'));

            let indexModifier = 0;

            if (zoomButton.matches('.minus')) {
                if (normalizedZoomIndex <= 1) {
                    zoomButton.classList.add('disabled');
                }
                if (normalizedZoomIndex === 0) {
                    return;
                }
                indexModifier = -1;
            }
            if (zoomButton.matches('.plus')) {
                if (normalizedZoomIndex >= app.zoom._steps.length - 2) {
                    zoomButton.classList.add('disabled');
                }
                if (normalizedZoomIndex === app.zoom._steps.length - 1) {
                    return;
                }

                indexModifier = 1;
            }
            setZoomValue(app.zoom._steps[normalizedZoomIndex + indexModifier]);
            applyCanvasTransform();
        }
    });

    addListener(window, ['mousedown', 'touchstart'], e => {
        if (e.target.matches('.move-handler')) {
            activateMovingToolbar();
            return;
        }

        if (!e.target.matches('.draw-handler')) {
            return;
        }

        const ev = e.touches?.[0] || e;
        setMousePosition(e);
        app.isDrawing = true;
        app.drag.moved = false;
        hideToolbar();
        moveCursor();

        const point = getCanvasPoint(app.mouse.x, app.mouse.y);

        if (app.currentTool === 'pan') {
            app.drag.last = {x: ev.clientX, y: ev.clientY};
            return;
        }

        if (app.currentTool === 'select') {
            if (getRotateHandleAt(point) && beginRotate(point)) {
                app.drag.last = point;
                return;
            }

            const resizeHandle = getResizeHandleAt(point);

            if (beginResize(resizeHandle)) {
                app.drag.last = point;
                return;
            }

            const object = findObjectAt(point);
            setSelection(object ? [object] : []);
            app.drag.last = point;
            render();
            return;
        }

        if (app.currentTool === 'lasso') {
            app.drag.start = point;
            app.drag.last = point;
            app.lassoBounds = getNormalizedBounds(point, point);
            render();
            return;
        }

        if (app.currentTool === 'object-eraser') {
            const object = findObjectAt(point);

            if (object && !object.locked) {
                const deletedObject = deleteObjectById(object.id);
                broadcastActivity('object-deleted', {
                    objectName: getObjectName(deletedObject),
                });
            } else {
                render();
            }

            return;
        }

        if (app.currentTool === 'fill') {
            const fillResult = floodFill(app.mouse.x, app.mouse.y, hexToRgba(app.fillColor));

            if (fillResult) {
                broadcastActivity('fill-used', {
                    color: app.fillColor,
                    objectId: fillResult.objectId,
                    objectType: fillResult.objectType,
                });
            }
            return;
        }

        if (app.currentTool === 'connector') {
            const object = findObjectAt(point);

            if (object && !object.locked) {
                app.drag.start = point;
                app.drag.last = point;
                app.drag.connectorStartId = object.id;
            }
            return;
        }

        if (app.currentTool === 'laser') {
            sendLaserPosition(point, true);
            return;
        }

        if (['text', 'sticky', 'callout', 'list', 'label', 'comment'].includes(app.currentTool)) {
            app.isDrawing = false;
            showToolbar();
            addTextObject(point, app.currentTool);
            return;
        }

        if (app.currentTool === 'frame') {
            const title = window.prompt('Frame name', 'Frame');

            if (!title?.trim()) {
                app.isDrawing = false;
                showToolbar();
                render();
                return;
            }

            app.draftObject = createFrame(point, title.trim());
            return;
        }

        if (['rectangle', 'ellipse', 'diamond', 'polygon', 'line', 'arrow'].includes(app.currentTool)) {
            startShape(point);
            return;
        }

        startPath(point);
    });

    addListener(window, ['mousemove', 'touchmove'], e => {
        const ev = e.touches?.[0] || e;
        setMousePosition(e);
        moveCursor();
        moveToolbar();
        sendCursorPosition(getCanvasPoint(app.mouse.x, app.mouse.y));

        if (!app.isDrawing) {
            return;
        }

        const point = getCanvasPoint(app.mouse.x, app.mouse.y);

        if (app.currentTool === 'pan') {
            movePan(ev);
            return;
        }

        if (app.currentTool === 'select') {
            updateRotate(point, e);
            if (app.drag.rotateStart) {
                return;
            }
            updateResize(point);
            if (app.drag.resizeHandle) {
                return;
            }
            moveSelectedObject(point);
            return;
        }

        if (app.currentTool === 'lasso') {
            updateLasso(point);
            return;
        }

        if (app.currentTool === 'laser') {
            sendLaserPosition(point, true);
            return;
        }

        if (['rectangle', 'ellipse', 'diamond', 'polygon', 'line', 'arrow', 'frame'].includes(app.currentTool)) {
            updateDraftShape(point);
            return;
        }

        draw();
    });

    addListener(window, ['mouseup', 'touchend'], () => {
        app.isDrawing = false;
        showToolbar();
        deactivateMovingToolbar();

        finishDraft();
        if (app.currentTool === 'lasso') {
            finishLasso();
        }
        if (app.currentTool === 'connector' && app.drag.connectorStartId) {
            const point = getCanvasPoint(app.mouse.x, app.mouse.y);
            const startObject = app.objects.find(object => object.id === app.drag.connectorStartId);
            const endObject = findObjectAt(point);

            if (startObject && endObject && !endObject.locked && startObject.id !== endObject.id) {
                const connector = createConnector(startObject, endObject, app.fillColor);
                saveHistory();
                app.objects.push(connector);
                setSelection([connector]);
                broadcastBoardState();
                broadcastActivity('shape-added', {
                    color: connector.color,
                    objectId: connector.id,
                    objectType: connector.type,
                });
            }
        }
        if (app.currentTool === 'laser') {
            sendLaserPosition(getCanvasPoint(app.mouse.x, app.mouse.y), false);
        }
        if (app.currentTool === 'select' && app.drag.rotateStart && app.drag.moved) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            broadcastActivity('object-rotated', {
                objectId: selectedObjects.length === 1 ? selectedObjects[0].id : undefined,
                objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
            });
        }
        if (app.currentTool === 'select' && app.drag.resizeHandle && app.drag.moved) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            broadcastActivity('object-resized', {
                objectId: selectedObjects.length === 1 ? selectedObjects[0].id : undefined,
                objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
            });
        }
        if (app.currentTool === 'select' && app.drag.moved) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            if (!app.drag.resizeHandle) {
                broadcastActivity('object-moved', {
                    objectId: selectedObjects.length === 1 ? selectedObjects[0].id : undefined,
                    objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
                });
            }
        }
        app.drag.start = null;
        app.drag.last = null;
        app.drag.moved = false;
        app.drag.resizeHandle = null;
        app.drag.resizeBounds = null;
        app.drag.resizeObjects = null;
        app.drag.rotateStart = null;
        app.drag.rotateObjects = null;
        app.drag.connectorStartId = null;
    });

    window.addEventListener('keydown', event => {
        const selectedObjects = getSelectedObjects();

        if (!['Backspace', 'Delete'].includes(event.key) || !selectedObjects.length) {
            return;
        }

        event.preventDefault();
        const deletedObjects = deleteObjectsByIds(selectedObjects.map(object => object.id));

        if (!deletedObjects.length) {
            return;
        }

        broadcastActivity('object-deleted', {
            objectName: deletedObjects.length === 1 ? getObjectName(deletedObjects[0]) : `${deletedObjects.length} objects`,
        });
    });

    window.addEventListener('wheel', e => {
        app.zoom.offsetX += -e.deltaX / app.zoom.scale;
        app.zoom.offsetY += -e.deltaY / app.zoom.scale;
        applyCanvasTransform();
    });
}
