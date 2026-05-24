import {moveCursor} from './cursor.js';
import {
    clear,
    clearUnlockedObjects,
    cloneObjects,
    canFillObject,
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
    erasePathAt,
    findObjectAt,
    floodFill,
    getConnectorEndpoints,
    getNearestAnchor,
    getObjectBounds,
    getObjectsInBounds,
    getObjectsBounds,
    getSelectedObjects,
    getSelectedObjectsBounds,
    groupObjects,
    moveObjects,
    moveObjectLayer,
    normalizeFrame,
    optimizePathObject,
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
import {setMousePosition} from './main.js';
import {app} from './app.js';
import {ActivityKind} from './enums/activity-kind.js';
import {ObjectType, TextEditableObjectTypes} from './enums/object-type.js';
import {DrawnShapeTools, ToolType} from './enums/tool-type.js';
import {broadcastActivity, broadcastBoardState, sendCursorPosition, sendLaserPosition, sendObjectLockState, sendSelectionState, sendReaction} from './network.js';
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
const propertiesClose = document.querySelector('.properties-close');
const propertiesSummary = document.querySelector('.properties-summary');
const propertyStroke = document.getElementById('propertyStroke');
const propertyFill = document.getElementById('propertyFill');
const propertyLineWidth = document.getElementById('propertyLineWidth');
const propertyRotation = document.getElementById('propertyRotation');
const propertyLocked = document.getElementById('propertyLocked');
const propertyText = document.getElementById('propertyText');
const propertyFontSize = document.getElementById('propertyFontSize');
const propertyOpacity = document.getElementById('propertyOpacity');
const propertyConnectorStyle = document.getElementById('propertyConnectorStyle');
const propertyEndMarker = document.getElementById('propertyEndMarker');
const statusToast = document.querySelector('.status-toast');
const textEditorOverlay = document.querySelector('.text-editor-overlay');
const textEditorInput = textEditorOverlay?.querySelector('textarea');
const selectionActionIds = ['duplicate', 'group', 'ungroup', 'lock', 'unlock', 'bringForward', 'sendBackward'];
let statusTimer = null;
let isUpdatingProperties = false;
let activeTextEditor = null;

function showStatus(message) {
    if (!statusToast) {
        return;
    }

    statusToast.textContent = message;
    statusToast.classList.add('visible');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
        statusToast.classList.remove('visible');
    }, 1800);
}

function getPeerEditingObjectIds() {
    const objectIds = new Set();

    app.objectLocks.forEach(lock => {
        if (lock.clientId !== app.clientId && (!lock.expiresAt || lock.expiresAt > Date.now())) {
            objectIds.add(lock.objectId);
        }
    });

    return objectIds;
}

function getPeerEditingSelectedObjects(objects = getSelectedObjects()) {
    const selectedIds = new Set(objects.map(object => object.id));
    const busyIds = getPeerEditingObjectIds();

    return [...selectedIds].some(id => busyIds.has(id));
}

function getLockOwnerForObjects(objects) {
    const objectIds = new Set(objects.map(object => object.id));
    const lock = [...app.objectLocks.values()].find(item => (
        objectIds.has(item.objectId) &&
        item.clientId !== app.clientId &&
        (!item.expiresAt || item.expiresAt > Date.now())
    ));

    return lock?.user || null;
}

function canEditObjects(objects, message = 'Someone else is editing this object') {
    if (!objects.length) {
        return false;
    }

    if (getPeerEditingSelectedObjects(objects)) {
        showStatus(message);
        return false;
    }

    return true;
}

function getPropertySupport(objects) {
    return {
        fill: objects.some(canFillObject),
        lineWidth: objects.some(object => 'lineWidth' in object),
        text: objects.length === 1 && TextEditableObjectTypes.includes(objects[0].type),
        fontSize: objects.some(object => 'fontSize' in object),
        opacity: objects.some(object => 'opacity' in object || object.type === ObjectType.Path || object.type === ObjectType.Image),
        connector: objects.length === 1 && objects[0].type === ObjectType.Connector,
    };
}

function setPropertyRowState(input, enabled) {
    const row = input?.closest('label');

    if (!input || !row) {
        return;
    }

    input.disabled = !enabled;
    row.classList.toggle('property-disabled', !enabled);
}

function valuesAreMixed(objects, getter) {
    if (objects.length < 2) {
        return false;
    }

    const firstValue = getter(objects[0]);
    return objects.some(object => getter(object) !== firstValue);
}

function normalizeColorForInput(value, fallback = '#000000') {
    if (!value || value === 'transparent' || value === 'none') {
        return fallback;
    }

    const probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = fallback;
    probe.fillStyle = value;
    const color = probe.fillStyle;

    if (/^#[0-9a-f]{6}$/i.test(color)) {
        return color;
    }

    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }

    const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);

    if (!rgb) {
        return fallback;
    }

    return `#${[rgb[1], rgb[2], rgb[3]].map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

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
    app.reactionEmoji = null;
    hideReactionPicker();
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
    renderPropertyPanel();
    render();
}

function updateToolbarState() {
    const selectedObjects = getSelectedObjects();
    const hasSelection = selectedObjects.length > 0;
    const hasMultiSelection = selectedObjects.length > 1;
    const hasGroupSelection = selectedObjects.some(object => object.groupId);
    const hasUnlockedSelection = selectedObjects.some(object => !object.locked);
    const hasLockedSelection = selectedObjects.some(object => object.locked);
    const hasPeerLock = getPeerEditingSelectedObjects(selectedObjects);

    selectionActionIds.forEach(id => {
        const button = document.getElementById(id);

        if (!button) {
            return;
        }

        if (id === 'group') {
            button.disabled = !hasMultiSelection || hasPeerLock;
        } else if (id === 'ungroup') {
            button.disabled = !hasGroupSelection || hasPeerLock;
        } else if (id === 'lock') {
            button.disabled = !hasUnlockedSelection || hasPeerLock;
        } else if (id === 'unlock') {
            button.disabled = !hasLockedSelection || hasPeerLock;
        } else {
            button.disabled = !hasSelection || hasPeerLock;
        }
    });
}

function renderPropertyPanel() {
    const selectedObjects = getSelectedObjects();

    if (!selectedObjects.length) {
        document.body.classList.remove('properties-open');
        return;
    }

    const firstObject = selectedObjects[0];
    const support = getPropertySupport(selectedObjects);
    const isPeerLocked = getPeerEditingSelectedObjects(selectedObjects);
    const hasEditableObjects = selectedObjects.some(object => !object.locked);
    isUpdatingProperties = true;
    document.body.classList.add('properties-open');

    if (propertiesSummary) {
        const lockOwner = getLockOwnerForObjects(selectedObjects);
        const selectionSummary = selectedObjects.length === 1
            ? getObjectName(firstObject)
            : `${selectedObjects.length} objects selected`;
        propertiesSummary.textContent = lockOwner
            ? `${selectionSummary} · Locked by ${lockOwner.name || 'user'}`
            : selectionSummary;
    }

    if (propertyStroke) {
        propertyStroke.value = normalizeColorForInput(firstObject.stroke || firstObject.color, '#0f172a');
        setPropertyRowState(propertyStroke, hasEditableObjects && !isPeerLocked);
    }

    if (propertyFill) {
        propertyFill.value = normalizeColorForInput(firstObject.fill, '#ffffff');
        setPropertyRowState(propertyFill, support.fill && hasEditableObjects && !isPeerLocked);
    }

    if (propertyLineWidth) {
        propertyLineWidth.value = valuesAreMixed(selectedObjects, object => object.lineWidth || 2) ? '' : firstObject.lineWidth || 2;
        propertyLineWidth.placeholder = valuesAreMixed(selectedObjects, object => object.lineWidth || 2) ? 'Mixed' : '';
        setPropertyRowState(propertyLineWidth, support.lineWidth && hasEditableObjects && !isPeerLocked);
    }

    if (propertyRotation) {
        propertyRotation.value = valuesAreMixed(selectedObjects, object => Math.round(object.rotation || 0)) ? '' : Math.round(firstObject.rotation || 0);
        propertyRotation.placeholder = valuesAreMixed(selectedObjects, object => Math.round(object.rotation || 0)) ? 'Mixed' : '';
        setPropertyRowState(propertyRotation, hasEditableObjects && !isPeerLocked);
    }

    if (propertyLocked) {
        propertyLocked.checked = selectedObjects.every(object => object.locked);
        setPropertyRowState(propertyLocked, !isPeerLocked);
    }

    if (propertyText) {
        propertyText.value = support.text ? firstObject.text || firstObject.title || firstObject.label || '' : '';
        setPropertyRowState(propertyText, support.text && hasEditableObjects && !isPeerLocked);
    }

    if (propertyFontSize) {
        propertyFontSize.value = valuesAreMixed(selectedObjects, object => object.fontSize || 16) ? '' : firstObject.fontSize || 16;
        propertyFontSize.placeholder = valuesAreMixed(selectedObjects, object => object.fontSize || 16) ? 'Mixed' : '';
        setPropertyRowState(propertyFontSize, support.fontSize && hasEditableObjects && !isPeerLocked);
    }

    if (propertyOpacity) {
        propertyOpacity.value = valuesAreMixed(selectedObjects, object => Math.round((object.opacity ?? 1) * 100))
            ? ''
            : Math.round((firstObject.opacity ?? 1) * 100);
        propertyOpacity.placeholder = valuesAreMixed(selectedObjects, object => Math.round((object.opacity ?? 1) * 100)) ? 'Mixed' : '';
        setPropertyRowState(propertyOpacity, support.opacity && hasEditableObjects && !isPeerLocked);
    }

    if (propertyConnectorStyle) {
        propertyConnectorStyle.value = firstObject.connectorStyle || 'orthogonal';
        setPropertyRowState(propertyConnectorStyle, support.connector && hasEditableObjects && !isPeerLocked);
    }

    if (propertyEndMarker) {
        propertyEndMarker.value = firstObject.endMarker || 'arrow';
        setPropertyRowState(propertyEndMarker, support.connector && hasEditableObjects && !isPeerLocked);
    }

    isUpdatingProperties = false;
}

function updateSelectedProperties(updater, activityKind, activityDetails = {}) {
    if (isUpdatingProperties) {
        return;
    }

    const selectedObjects = getSelectedObjects();
    const editableObjects = selectedObjects.filter(object => !object.locked || activityDetails.allowLocked);

    if (!canEditObjects(selectedObjects) || !editableObjects.length) {
        return;
    }

    saveHistory();
    editableObjects.forEach(updater);
    render();
    renderPropertyPanel();
    broadcastBoardState();

    if (activityKind) {
        broadcastActivity(activityKind, {
            objectId: editableObjects.length === 1 ? editableObjects[0].id : undefined,
            objectName: editableObjects.length === 1 ? getObjectName(editableObjects[0]) : `${editableObjects.length} objects`,
            ...activityDetails,
        });
    }
}

function getTextEditorValueForObject(object) {
    if (object?.type === ObjectType.Frame || object?.type === ObjectType.Swimlane || object?.type === ObjectType.TemplateFrame) {
        return object.title || 'Frame';
    }

    if (object?.type === ObjectType.Connector) {
        return object.label || '';
    }

    return object?.text || '';
}

function getTextEditorSize(type, object) {
    if (object) {
        return {
            width: object.width || 260,
            height: object.height || 72,
        };
    }

    if (type === ObjectType.Sticky) {
        return {width: 220, height: 132};
    }

    if (type === ObjectType.Callout || type === ObjectType.List || type === ObjectType.Comment) {
        return {width: 280, height: 112};
    }

    if (type === ObjectType.Label) {
        return {width: 220, height: 52};
    }

    return {width: 260, height: 58};
}

function openTextEditor(point, type, object = null) {
    if (!textEditorOverlay || !textEditorInput) {
        return;
    }

    const objectsToEdit = object ? [object] : [];

    if (object && (!canEditObjects(objectsToEdit) || object.locked)) {
        return;
    }

    const size = getTextEditorSize(type, object);
    const left = (point.x + app.zoom.offsetX) * app.zoom.scale;
    const top = (point.y + app.zoom.offsetY) * app.zoom.scale;
    activeTextEditor = {
        object,
        point,
        type,
        canceled: false,
    };
    textEditorOverlay.hidden = false;
    textEditorOverlay.style.left = `${Math.max(12, Math.min(window.innerWidth - 220, left))}px`;
    textEditorOverlay.style.top = `${Math.max(12, Math.min(window.innerHeight - 90, top))}px`;
    textEditorOverlay.style.width = `${Math.max(180, Math.min(360, size.width * app.zoom.scale || size.width))}px`;
    textEditorInput.style.minHeight = `${Math.max(52, Math.min(220, size.height * app.zoom.scale || size.height))}px`;
    textEditorInput.value = object ? getTextEditorValueForObject(object) : '';
    textEditorInput.focus();
    textEditorInput.select();
}

function closeTextEditor(commit = true) {
    if (!activeTextEditor || !textEditorOverlay || !textEditorInput) {
        return;
    }

    const editor = activeTextEditor;
    const text = textEditorInput.value.trim();
    activeTextEditor = null;
    textEditorOverlay.hidden = true;

    if (!commit || !text) {
        return;
    }

    if (editor.object) {
        updateSelectedProperties(object => {
            if (object.id !== editor.object.id) {
                return;
            }

            if (object.type === ObjectType.Frame || object.type === ObjectType.Swimlane || object.type === ObjectType.TemplateFrame) {
                object.title = text;
            } else if (object.type === ObjectType.Connector) {
                object.label = text;
            } else if (object.type === ObjectType.List) {
                object.items = text
                    .split(/\n|,/)
                    .map(item => item.trim())
                    .filter(Boolean)
                    .slice(0, 8);
                object.text = object.items.join(', ');
                object.height = Math.max(92, 36 + object.items.length * 26);
            } else {
                object.text = text;
            }
        }, ActivityKind.ObjectStyled);
        return;
    }

    const objectFactories = {
        [ObjectType.Callout]: createCallout,
        [ObjectType.Label]: createLabel,
        [ObjectType.List]: createList,
        [ObjectType.Comment]: createComment,
        [ObjectType.Sticky]: createSticky,
        [ObjectType.Text]: createText,
    };
    const object = (objectFactories[editor.type] || createText)(editor.point, text);
    saveHistory();
    app.objects.push(object);
    setSelection([object]);
    render();
    broadcastBoardState();
    broadcastActivity(editor.type === ObjectType.Sticky ? ActivityKind.StickyAdded : editor.type === ObjectType.Comment ? ActivityKind.CommentAdded : ActivityKind.TextAdded, {
        objectId: object.id,
        objectType: object.type,
        text,
    });
}

function isTypingTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function duplicateSelection() {
    const selectedObjects = getSelectedObjects();

    if (!canEditObjects(selectedObjects)) {
        return false;
    }

    const duplicates = selectedObjects.length > 1 ? duplicateObjects(selectedObjects) : [];
    const duplicate = duplicates[0] || duplicateObject(app.selectedObjectId);

    if (duplicate || duplicates.length) {
        broadcastActivity(ActivityKind.ObjectDuplicated, {
            objectId: duplicates.length === 1 ? duplicates[0].id : duplicate?.id,
            objectName: duplicates.length > 1 ? `${duplicates.length} objects` : getObjectName(duplicate || duplicates[0]),
        });
        return true;
    }

    return false;
}

function groupSelection() {
    const selectedObjects = getSelectedObjects();

    if (!canEditObjects(selectedObjects)) {
        return false;
    }

    const groupId = groupObjects(selectedObjects);

    if (groupId) {
        broadcastActivity(ActivityKind.ObjectsGrouped, {
            objectName: `${selectedObjects.length} objects`,
        });
        return true;
    }

    return false;
}

function ungroupSelection() {
    const selectedObjects = getSelectedObjects();

    if (!canEditObjects(selectedObjects)) {
        return false;
    }

    if (ungroupObjects(selectedObjects)) {
        broadcastActivity(ActivityKind.ObjectsUngrouped, {
            objectName: `${selectedObjects.length} objects`,
        });
        return true;
    }

    return false;
}

function setSelectionLock(locked) {
    const selectedObjects = getSelectedObjects();

    if (!canEditObjects(selectedObjects)) {
        return false;
    }

    if (setObjectsLocked(selectedObjects, locked)) {
        broadcastActivity(locked ? ActivityKind.ObjectsLocked : ActivityKind.ObjectsUnlocked, {
            objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
        });
        return true;
    }

    return false;
}

function addMindMapChild(parent) {
    if (!parent || parent.type !== ObjectType.MindNode || !canEditObjects([parent])) {
        return false;
    }

    const bounds = getObjectBounds(parent);

    if (!bounds) {
        return false;
    }

    const child = createShape(ObjectType.MindNode, {x: bounds.x + bounds.width + 110, y: bounds.y + 8}, app.fillColor, app.lineWidth);
    child.x2 = child.x + Math.max(160, bounds.width);
    child.y2 = child.y + Math.max(84, bounds.height);
    child.text = 'Child node';
    const connector = createConnector(parent, child, app.fillColor);

    saveHistory();
    app.objects.push(child, connector);
    setSelection([child]);
    broadcastBoardState();
    broadcastActivity(ActivityKind.ShapeAdded, {
        color: child.color,
        objectId: child.id,
        objectType: child.type,
    });
    return true;
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
    const screenX = (point.x + app.zoom.offsetX) * app.zoom.scale;
    const screenY = (point.y + app.zoom.offsetY) * app.zoom.scale;
    const el = document.elementsFromPoint(screenX, screenY)
        .find(el => el.hasAttribute('data-resize-handle'));
    return el?.getAttribute('data-resize-handle') ?? null;
}

function beginResize(handle) {
    const selectedObjects = getSelectedObjects().filter(object => !object.locked);

    if (!handle || !selectedObjects.length || !canEditObjects(selectedObjects)) {
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

    if (!selectedObjects.length || !bounds || !canEditObjects(selectedObjects)) {
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
    const screenX = (point.x + app.zoom.offsetX) * app.zoom.scale;
    const screenY = (point.y + app.zoom.offsetY) * app.zoom.scale;
    return document.elementsFromPoint(screenX, screenY)
        .some(el => el.hasAttribute('data-rotate-handle'));
}

function getConnectorEndpointAt(point) {
    const selectedObjects = getSelectedObjects();
    const connector = selectedObjects.length === 1 && selectedObjects[0].type === ObjectType.Connector
        ? selectedObjects[0]
        : null;

    if (!connector) {
        return null;
    }

    const endpoints = getConnectorEndpoints(connector);
    const size = Math.max(16, 18 / app.zoom.scale);

    if (Math.hypot(point.x - endpoints.from.x, point.y - endpoints.from.y) <= size) {
        return {connector, endpoint: 'from'};
    }

    if (Math.hypot(point.x - endpoints.to.x, point.y - endpoints.to.y) <= size) {
        return {connector, endpoint: 'to'};
    }

    return null;
}

function beginConnectorEndpointDrag(target) {
    if (!target || !canEditObjects([target.connector])) {
        return false;
    }

    saveHistory();
    app.drag.connectorEndpoint = target;
    return true;
}

function updateConnectorEndpointDrag(point) {
    const target = app.drag.connectorEndpoint;

    if (!target) {
        return;
    }

    if (target.endpoint === 'from') {
        target.connector.fromId = null;
        target.connector.x = point.x;
        target.connector.y = point.y;
    } else {
        target.connector.toId = null;
        target.connector.x2 = point.x;
        target.connector.y2 = point.y;
    }

    app.drag.moved = true;
    render();
}

function finishConnectorEndpointDrag(point) {
    const target = app.drag.connectorEndpoint;

    if (!target) {
        return false;
    }

    const targetObject = findObjectAt(point);
    const otherId = target.endpoint === 'from' ? target.connector.toId : target.connector.fromId;

    if (targetObject && targetObject.type !== ObjectType.Connector && targetObject.id !== otherId && !targetObject.locked && canEditObjects([target.connector, targetObject])) {
        if (target.endpoint === 'from') {
            target.connector.fromId = targetObject.id;
            target.connector.fromAnchor = getNearestAnchor(targetObject, {x: target.connector.x2, y: target.connector.y2});
        } else {
            target.connector.toId = targetObject.id;
            target.connector.toAnchor = getNearestAnchor(targetObject, {x: target.connector.x, y: target.connector.y});
        }
    }

    broadcastBoardState();
    broadcastActivity(ActivityKind.ObjectStyled, {
        objectId: target.connector.id,
        objectName: getObjectName(target.connector),
    });
    return true;
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
    setSelection([]);
    const isEraser = app.currentTool === ToolType.Eraser;
    const isPencil = app.currentTool === ToolType.Pencil;
    const isFreeform = app.currentTool === ToolType.Freeform;
    app.draftObject = createPath(
        point,
        isEraser ? 'white' : app.fillColor,
        isPencil ? Math.max(2, Math.round(app.lineWidth * 0.45)) : app.lineWidth,
        app.currentTool === ToolType.Marker ? 0.35 : isPencil ? 0.72 : 1,
        isFreeform ? ObjectType.Freeform : ObjectType.Path,
    );
}

function startShape(point) {
    setSelection([]);
    app.draftObject = createShape(app.currentTool, point, app.fillColor, app.lineWidth);
}

function finishDraft() {
    if (!app.draftObject) {
        return;
    }

    const object = app.draftObject;
    app.draftObject = null;

    optimizePathObject(object);

    if (object.type === ObjectType.Path && object.points.length < 2) {
        render();
        return;
    }

    if (object.type === ObjectType.Freeform && object.points.length < 3) {
        render();
        return;
    }

    if (object.type === ObjectType.Freeform) {
        object.closed = true;
        object.fill = object.fill || 'transparent';
    }

    if (object.type === ObjectType.TemplateFrame && Math.abs(object.x2 - object.x) < 320) {
        object.x2 = object.x + 520;
        object.y2 = object.y + 320;
    }

    if (object.type === ObjectType.Swimlane && Math.abs(object.x2 - object.x) < 260) {
        object.x2 = object.x + 520;
        object.y2 = object.y + 260;
    }

    if (object.type === ObjectType.Kanban && Math.abs(object.x2 - object.x) < 260) {
        object.x2 = object.x + 460;
        object.y2 = object.y + 240;
    }

    if (object.type === ObjectType.MindNode && Math.abs(object.x2 - object.x) < 120) {
        object.x2 = object.x + 180;
        object.y2 = object.y + 96;
    }

    if ('x2' in object && Math.abs(object.x2 - object.x) < 8 && Math.abs(object.y2 - object.y) < 8) {
        render();
        return;
    }

    if (object.type === ObjectType.Frame) {
        normalizeFrame(object);
    }

    saveHistory();
    app.objects.push(object);
    setSelection([object]);
    render();
    broadcastBoardState();

    if (DrawnShapeTools.includes(object.type) || object.type === ObjectType.TemplateFrame || object.type === ObjectType.Freeform) {
        broadcastActivity(ActivityKind.ShapeAdded, {
            color: object.color,
            objectId: object.id,
            objectType: object.type,
        });
    } else if (object.type === ObjectType.Path && app.currentTool !== ToolType.Eraser) {
        broadcastActivity(ActivityKind.ToolUsed, {
            objectId: object.id,
            tool: app.currentTool === ToolType.Marker ? ToolType.Marker : app.currentTool === ToolType.Pencil ? ToolType.Pencil : ToolType.Pen,
        });
    }
}

function addTextObject(point, type) {
    openTextEditor(point, type);
}

function moveSelectedObject(point) {
    const selectedObjects = getSelectedObjects();

    if (!selectedObjects.length || !app.drag.last) {
        return;
    }

    if (!canEditObjects(selectedObjects)) {
        app.drag.last = point;
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

    const selectedObjects = getObjectsInBounds(app.lassoBounds).filter(object => object.type !== ObjectType.Connector);
    setSelection(selectedObjects);
    app.lassoBounds = null;
    render();
}

function updateRemoteCursors() {
    if (!remoteCursors) {
        return;
    }

    const activePeerIds = new Set(
        [...app.collaborators.values()]
            .filter(user => !user.laser || user.laser.expiresAt <= Date.now())
            .map(user => user.id),
    );

    remoteCursors.querySelectorAll('.remote-cursor').forEach(cursor => {
        if (!activePeerIds.has(cursor.dataset.userId)) {
            cursor.remove();
        }
    });

    app.collaborators.forEach(user => {
        if (user.laser && user.laser.expiresAt > Date.now()) {
            return;
        }

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

const REACTION_EMOJIS = ['👍', '❓', '✅', '⭐', '🔥', '❤️'];

function showReactionPicker(screenX, screenY, boardPoint) {
    let picker = document.getElementById('reactionPicker');
    if (!picker) {
        return;
    }
    picker.style.left = `${Math.min(screenX, window.innerWidth - 220)}px`;
    picker.style.top = `${Math.max(screenY - 60, 8)}px`;
    picker.hidden = false;
    picker.dataset.boardX = boardPoint.x;
    picker.dataset.boardY = boardPoint.y;
}

function hideReactionPicker() {
    const picker = document.getElementById('reactionPicker');
    if (picker) {
        picker.hidden = true;
    }
}

function updateRemoteLasers() {
    if (!laserLayer) {
        return;
    }

    laserLayer.replaceChildren();
    app.collaborators.forEach(user => {
        if (user.laser) {
            if (user.laser.expiresAt && user.laser.expiresAt < Date.now()) {
                user.laser = null;
                updateRemoteCursors();
            } else {
                const dot = document.createElement('div');
                dot.className = 'laser-dot';
                dot.style.setProperty('--laser-color', user.color);
                dot.style.left = `${(user.laser.x + app.zoom.offsetX) * app.zoom.scale}px`;
                dot.style.top = `${(user.laser.y + app.zoom.offsetY) * app.zoom.scale}px`;
                dot.innerHTML = `<span>${user.name}</span>`;
                laserLayer.appendChild(dot);
            }
        }

        if (user.reactions?.length) {
            const now = Date.now();
            user.reactions = user.reactions.filter(r => r.expiresAt > now);
            user.reactions.forEach(reaction => {
                const el = document.createElement('div');
                el.className = 'reaction-float';
                el.style.setProperty('--reaction-color', user.color);
                el.style.left = `${(reaction.x + app.zoom.offsetX) * app.zoom.scale}px`;
                el.style.top = `${(reaction.y + app.zoom.offsetY) * app.zoom.scale}px`;
                const remaining = reaction.expiresAt - now;
                el.style.setProperty('--reaction-progress', `${remaining / 4000}`);
                el.innerHTML = `<span class="reaction-emoji">${reaction.emoji}</span><span class="reaction-avatar">${user.initials}</span>`;
                laserLayer.appendChild(el);
            });
        }
    });

    if ([...app.collaborators.values()].some(u => u.reactions?.length)) {
        setTimeout(() => window.whiteboardUpdateRemoteLasers?.(), 100);
    }
}

function updateMinimap() {
    if (!minimapSvg) {
        return;
    }

    const scaleX = 240 / app.board.width;
    const scaleY = 160 / app.board.height;
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

function moveViewportFromMinimap(event) {
    if (!minimap) {
        return;
    }

    const rect = minimap.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * app.board.width;
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * app.board.height;
    app.zoom.offsetX = window.innerWidth / 2 / app.zoom.scale - x;
    app.zoom.offsetY = window.innerHeight / 2 / app.zoom.scale - y;
    applyCanvasTransform();
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
            broadcastActivity(ActivityKind.ImageImported, {
                objectId: object.id,
                objectName: getObjectName(object),
            });
        });
        image.src = reader.result;
    });
    reader.readAsDataURL(file);
}

function importTextObject(text, point = getCanvasPoint(window.innerWidth / 2, window.innerHeight / 2)) {
    const object = createText(point, text.trim().slice(0, 500));

    saveHistory();
    app.objects.push(object);
    setSelection([object]);
    broadcastBoardState();
    broadcastActivity(ActivityKind.TextAdded, {
        objectId: object.id,
        objectType: object.type,
        text: object.text,
    });
}

function getSvgNumber(element, name, fallback = 0) {
    const value = Number.parseFloat(element.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
}

function setImportedStyle(object, element) {
    const stroke = element.getAttribute('stroke');
    const fill = element.getAttribute('fill');

    if (stroke && stroke !== 'none') {
        object.color = stroke;
    }

    if (fill && fill !== 'none' && ![ObjectType.Line, ObjectType.Arrow].includes(object.type)) {
        object.fill = fill;
    }
}

function importSvgAsObjects(svgText, point = getCanvasPoint(window.innerWidth / 2, window.innerHeight / 2)) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');

    if (parseError) {
        return false;
    }

    const importedObjects = [];
    const origin = {x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY};
    const elements = [...doc.querySelectorAll('rect, circle, ellipse, line, text')].slice(0, 80);

    elements.forEach(element => {
        let object = null;

        if (element.tagName === 'rect') {
            object = createShape(ObjectType.Rectangle, {x: getSvgNumber(element, 'x'), y: getSvgNumber(element, 'y')}, app.fillColor, app.lineWidth);
            object.x2 = object.x + getSvgNumber(element, 'width', 120);
            object.y2 = object.y + getSvgNumber(element, 'height', 80);
        } else if (element.tagName === 'circle' || element.tagName === 'ellipse') {
            const cx = getSvgNumber(element, 'cx');
            const cy = getSvgNumber(element, 'cy');
            const rx = element.tagName === 'circle' ? getSvgNumber(element, 'r', 40) : getSvgNumber(element, 'rx', 60);
            const ry = element.tagName === 'circle' ? rx : getSvgNumber(element, 'ry', 40);
            object = createShape(ObjectType.Ellipse, {x: cx - rx, y: cy - ry}, app.fillColor, app.lineWidth);
            object.x2 = cx + rx;
            object.y2 = cy + ry;
        } else if (element.tagName === 'line') {
            object = createShape(ObjectType.Line, {x: getSvgNumber(element, 'x1'), y: getSvgNumber(element, 'y1')}, app.fillColor, app.lineWidth);
            object.x2 = getSvgNumber(element, 'x2', object.x + 120);
            object.y2 = getSvgNumber(element, 'y2', object.y);
        } else if (element.tagName === 'text') {
            object = createText({x: getSvgNumber(element, 'x'), y: getSvgNumber(element, 'y')}, element.textContent.trim() || 'Text');
            object.fontSize = getSvgNumber(element, 'font-size', object.fontSize);
        }

        if (!object) {
            return;
        }

        setImportedStyle(object, element);
        const bounds = getObjectBounds(object);
        if (bounds) {
            origin.x = Math.min(origin.x, bounds.x);
            origin.y = Math.min(origin.y, bounds.y);
        }
        importedObjects.push(object);
    });

    if (!importedObjects.length) {
        return false;
    }

    const offsetX = point.x - (Number.isFinite(origin.x) ? origin.x : 0);
    const offsetY = point.y - (Number.isFinite(origin.y) ? origin.y : 0);
    moveObjects(importedObjects, offsetX, offsetY);
    saveHistory();
    app.objects.push(...importedObjects);
    setSelection(importedObjects);
    broadcastBoardState();
    broadcastActivity(ActivityKind.ImageImported, {
        objectName: `${importedObjects.length} SVG objects`,
    });
    return true;
}

function importSvgFallback(svgText, point = getCanvasPoint(window.innerWidth / 2, window.innerHeight / 2)) {
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    const image = new Image();

    image.addEventListener('load', () => {
        const object = createImageObject(point, src, image.naturalWidth || 480, image.naturalHeight || 320);
        saveHistory();
        app.objects.push(object);
        setSelection([object]);
        broadcastBoardState();
        broadcastActivity(ActivityKind.ImageImported, {
            objectId: object.id,
            objectName: getObjectName(object),
        });
    });
    image.src = src;
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
                <strong>${snapshot.name || 'Snapshot'}</strong>
                <span>${new Date(snapshot.timestamp).toLocaleString()} · ${snapshot.objects?.length || 0} objects · ${snapshot.author || 'Unknown author'}</span>
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

    if (!window.confirm(`Restore "${snapshot.name || 'Snapshot'}"? Current board changes will be replaced.`)) {
        return;
    }

    saveHistory();
    app.objects = cloneObjects(snapshot.objects || []);
    setSelection([]);
    broadcastBoardState({mode: 'replace'});
    broadcastActivity(ActivityKind.SnapshotRestored);
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
    window.whiteboardShowStatus = showStatus;
    window.whiteboardUpdateSelectionUi = () => {
        updateToolbarState();
        renderPropertyPanel();
    };
    updateToolbarState();
    renderPropertyPanel();
    window.setInterval(updateRemoteLasers, 500);

    document.getElementById('reactionPicker')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-emoji]');
        if (!btn) return;
        const picker = document.getElementById('reactionPicker');
        const boardPoint = {x: Number(picker.dataset.boardX), y: Number(picker.dataset.boardY)};
        app.reactionEmoji = btn.dataset.emoji;
        sendReaction(app.reactionEmoji, boardPoint);
        app.reactionEmoji = null;
        hideReactionPicker();
    });
    const boardName = localStorage.getItem(`whiteboard:boardName:${app.roomId}`) || `Whiteboard / ${app.roomId.slice(0, 8)}`;
    document.querySelector('.board-title span:last-child').textContent = boardName;
    shareButton.addEventListener('click', copyShareLink);
    snapshotClose?.addEventListener('click', closeSnapshotPanel);
    textEditorInput?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeTextEditor(false);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            closeTextEditor(true);
        }
    });
    textEditorInput?.addEventListener('blur', () => closeTextEditor(true));
    propertiesClose?.addEventListener('click', () => document.body.classList.remove('properties-open'));
    propertyStroke?.addEventListener('change', event => {
        updateSelectedProperties(object => {
            if ('stroke' in object && !('color' in object)) {
                object.stroke = event.target.value;
            } else {
                object.color = event.target.value;
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyFill?.addEventListener('change', event => {
        updateSelectedProperties(object => {
            if (![ObjectType.Line, ObjectType.Arrow, ObjectType.Connector, ObjectType.Path].includes(object.type)) {
                object.fill = event.target.value;
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyLineWidth?.addEventListener('change', event => {
        const lineWidth = Math.max(1, Math.min(80, Number(event.target.value) || 1));
        updateSelectedProperties(object => {
            if ('lineWidth' in object) {
                object.lineWidth = lineWidth;
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyRotation?.addEventListener('change', event => {
        const rotation = Math.max(-360, Math.min(360, Number(event.target.value) || 0));
        updateSelectedProperties(object => {
            object.rotation = rotation;
        }, ActivityKind.ObjectRotated);
    });
    propertyLocked?.addEventListener('change', event => {
        const selectedObjects = getSelectedObjects();

        if (!canEditObjects(selectedObjects)) {
            renderPropertyPanel();
            return;
        }

        if (setObjectsLocked(selectedObjects, event.target.checked)) {
            broadcastActivity(event.target.checked ? ActivityKind.ObjectsLocked : ActivityKind.ObjectsUnlocked, {
                objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
            });
        }
    });
    propertyText?.addEventListener('change', event => {
        updateSelectedProperties(object => {
            if (object.type === ObjectType.Frame || object.type === ObjectType.Swimlane || object.type === ObjectType.TemplateFrame) {
                object.title = event.target.value || 'Frame';
                return;
            }

            if (object.type === ObjectType.Connector) {
                object.label = event.target.value;
                return;
            }

            object.text = event.target.value;
            if (object.type === ObjectType.List) {
                object.items = event.target.value
                    .split(/\n|,/)
                    .map(item => item.trim())
                    .filter(Boolean)
                    .slice(0, 8);
                object.text = object.items.join(', ');
                object.height = Math.max(92, 36 + object.items.length * 26);
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyFontSize?.addEventListener('change', event => {
        const fontSize = Math.max(8, Math.min(96, Number(event.target.value) || 16));
        updateSelectedProperties(object => {
            if ('fontSize' in object) {
                object.fontSize = fontSize;
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyOpacity?.addEventListener('change', event => {
        const opacity = Math.max(5, Math.min(100, Number(event.target.value) || 100)) / 100;
        updateSelectedProperties(object => {
            object.opacity = opacity;
        }, ActivityKind.ObjectStyled);
    });
    propertyConnectorStyle?.addEventListener('change', event => {
        updateSelectedProperties(object => {
            if (object.type === ObjectType.Connector) {
                object.connectorStyle = event.target.value;
            }
        }, ActivityKind.ObjectStyled);
    });
    propertyEndMarker?.addEventListener('change', event => {
        updateSelectedProperties(object => {
            if (object.type === ObjectType.Connector) {
                object.endMarker = event.target.value;
            }
        }, ActivityKind.ObjectStyled);
    });
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
    minimap?.addEventListener('pointerdown', event => {
        event.preventDefault();
        minimap.setPointerCapture?.(event.pointerId);
        app.drag.minimap = true;
        moveViewportFromMinimap(event);
    });
    minimap?.addEventListener('pointermove', event => {
        if (app.drag.minimap) {
            moveViewportFromMinimap(event);
        }
    });
    minimap?.addEventListener('pointerup', event => {
        app.drag.minimap = false;
        minimap.releasePointerCapture?.(event.pointerId);
    });
    minimap?.addEventListener('pointercancel', () => {
        app.drag.minimap = false;
    });
    fitBoardButton.addEventListener('click', () => {
        fitBoundsToScreen(getObjectsBounds() || {x: 0, y: 0, width: app.board.width, height: app.board.height});
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
        const text = event.clipboardData?.getData('text/plain') || '';

        if (imageItem) {
            event.preventDefault();
            loadImageFile(imageItem.getAsFile());
            return;
        }

        if (text.trim().startsWith('<svg')) {
            event.preventDefault();
            if (!importSvgAsObjects(text)) {
                importSvgFallback(text);
            }
            return;
        }

        if (text.trim() && !isTypingTarget(document.activeElement)) {
            event.preventDefault();
            importTextObject(text);
        }
    });
    window.addEventListener('beforeunload', () => {
        sendObjectLockState([], true);
    });
    window.setInterval(() => {
        if (app.selectedObjectIds.length) {
            sendObjectLockState(app.selectedObjectIds);
        }
    }, 2000);
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
                if (clearUnlockedObjects()) {
                    broadcastActivity(ActivityKind.BoardCleared);
                }
                return;
            }

            if (toolbarButton.id === 'undo') {
                if (undo()) {
                    broadcastActivity(ActivityKind.HistoryUsed, {
                        action: 'undo',
                    });
                }
                return;
            }

            if (toolbarButton.id === 'redo') {
                if (redo()) {
                    broadcastActivity(ActivityKind.HistoryUsed, {
                        action: 'redo',
                    });
                }
                return;
            }

            if (toolbarButton.id === 'duplicate') {
                const selectedObjects = getSelectedObjects();

                if (!canEditObjects(selectedObjects)) {
                    return;
                }

                const duplicates = selectedObjects.length > 1 ? duplicateObjects(selectedObjects) : [];
                const duplicate = duplicates[0] || duplicateObject(app.selectedObjectId);

                if (duplicate || duplicates.length) {
                    broadcastActivity(ActivityKind.ObjectDuplicated, {
                        objectId: duplicates.length === 1 ? duplicates[0].id : duplicate?.id,
                        objectName: duplicates.length > 1 ? `${duplicates.length} objects` : getObjectName(duplicate || duplicates[0]),
                    });
                }
                return;
            }

            if (toolbarButton.id === 'group') {
                const selectedObjects = getSelectedObjects();

                if (!canEditObjects(selectedObjects)) {
                    return;
                }

                const groupId = groupObjects(selectedObjects);

                if (groupId) {
                    broadcastActivity(ActivityKind.ObjectsGrouped, {
                        objectName: `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'ungroup') {
                const selectedObjects = getSelectedObjects();

                if (!canEditObjects(selectedObjects)) {
                    return;
                }

                if (ungroupObjects(selectedObjects)) {
                    broadcastActivity(ActivityKind.ObjectsUngrouped, {
                        objectName: `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'lock' || toolbarButton.id === 'unlock') {
                const selectedObjects = getSelectedObjects();
                const locked = toolbarButton.id === 'lock';

                if (!canEditObjects(selectedObjects)) {
                    return;
                }

                if (setObjectsLocked(selectedObjects, locked)) {
                    broadcastActivity(locked ? ActivityKind.ObjectsLocked : ActivityKind.ObjectsUnlocked, {
                        objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
                    });
                }
                return;
            }

            if (toolbarButton.id === 'bringForward' || toolbarButton.id === 'sendBackward') {
                const direction = toolbarButton.id === 'bringForward' ? 'forward' : 'backward';
                const selectedObjects = getSelectedObjects();

                if (!canEditObjects(selectedObjects)) {
                    return;
                }

                const object = moveObjectLayer(app.selectedObjectId, direction);

                if (object) {
                    broadcastActivity(ActivityKind.ObjectLayered, {
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
                const serializableObjects = app.objects;
                const name = window.prompt('Snapshot name', `Snapshot ${new Date().toLocaleString()}`) || 'Snapshot';
                const snapshot = {
                    id: crypto.randomUUID(),
                    name,
                    timestamp: new Date().toISOString(),
                    author: app.localUser.name,
                    objects: cloneObjects(app.objects),
                };
                app.snapshots.push(snapshot);
                app.snapshots = app.snapshots.slice(-10);
                const storedSnapshots = [...getStoredSnapshots(), {
                    id: snapshot.id,
                    name: snapshot.name,
                    timestamp: snapshot.timestamp,
                    author: snapshot.author,
                    objects: JSON.parse(JSON.stringify(serializableObjects)),
                }].slice(-10);
                localStorage.setItem(`whiteboard:snapshots:${app.roomId}`, JSON.stringify(storedSnapshots));
                renderSnapshotPanel();
                broadcastActivity(ActivityKind.SnapshotCreated);
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

    window.addEventListener('dblclick', event => {
        if (!event.target.matches('.draw-handler')) {
            return;
        }

        const point = getCanvasPoint(event.clientX, event.clientY);
        const object = findObjectAt(point);

        if (!object || !TextEditableObjectTypes.includes(object.type)) {
            return;
        }

        event.preventDefault();
        setSelection([object]);
        openTextEditor({x: object.x || point.x, y: object.y || point.y}, object.type, object);
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

        if (app.currentTool === ToolType.Pan) {
            app.drag.last = {x: ev.clientX, y: ev.clientY};
            return;
        }

        if (app.currentTool === ToolType.Select) {
            const connectorEndpoint = getConnectorEndpointAt(point);

            if (beginConnectorEndpointDrag(connectorEndpoint)) {
                app.drag.last = point;
                return;
            }

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

        if (app.currentTool === ToolType.Lasso) {
            app.drag.start = point;
            app.drag.last = point;
            app.lassoBounds = getNormalizedBounds(point, point);
            render();
            return;
        }

        if (app.currentTool === ToolType.ObjectEraser) {
            const object = findObjectAt(point);

            if (object && !object.locked && canEditObjects([object])) {
                const deletedObject = deleteObjectById(object.id);
                broadcastActivity(ActivityKind.ObjectDeleted, {
                    objectName: getObjectName(deletedObject),
                });
            } else {
                render();
            }

            return;
        }

        if (app.currentTool === ToolType.Eraser) {
            saveHistory();
            erasePathAt(point, app.lineWidth);
            return;
        }

        if (app.currentTool === ToolType.Fill) {
            const targetObject = findObjectAt(point);

            if (targetObject && !canEditObjects([targetObject])) {
                return;
            }

            const fillResult = floodFill(app.mouse.x, app.mouse.y, hexToRgba(app.fillColor));

            if (fillResult) {
                broadcastActivity(ActivityKind.FillUsed, {
                    color: app.fillColor,
                    objectId: fillResult.objectId,
                    objectType: fillResult.objectType,
                });
            } else {
                showStatus('Fill works on closed SVG objects only');
            }
            return;
        }

        if (app.currentTool === ToolType.Connector) {
            const object = findObjectAt(point);

            if (object && !object.locked && canEditObjects([object])) {
                app.drag.start = point;
                app.drag.last = point;
                app.drag.connectorStartId = object.id;
            }
            return;
        }

        if (app.currentTool === ToolType.Laser) {
            sendLaserPosition(point, true);
            return;
        }

        if (app.currentTool === ToolType.Reaction) {
            if (app.reactionEmoji) {
                sendReaction(app.reactionEmoji, point);
                app.reactionEmoji = null;
                hideReactionPicker();
            } else {
                showReactionPicker(app.mouse.x, app.mouse.y, point);
            }
            return;
        }

        if ([ObjectType.Text, ObjectType.Sticky, ObjectType.Callout, ObjectType.List, ObjectType.Label, ObjectType.Comment].includes(app.currentTool)) {
            app.isDrawing = false;
            showToolbar();
            setSelection([]);
            addTextObject(point, app.currentTool);
            return;
        }

        if (app.currentTool === ToolType.Frame) {
            setSelection([]);
            app.draftObject = createFrame(point, 'Frame');
            return;
        }

        if (DrawnShapeTools.includes(app.currentTool)) {
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

        if (app.currentTool === ToolType.Pan) {
            movePan(ev);
            return;
        }

        if (app.currentTool === ToolType.Select) {
            updateConnectorEndpointDrag(point);
            if (app.drag.connectorEndpoint) {
                return;
            }
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

        if (app.currentTool === ToolType.Lasso) {
            updateLasso(point);
            return;
        }

        if (app.currentTool === ToolType.Laser) {
            sendLaserPosition(point, true);
            return;
        }

        if (app.currentTool === ToolType.Eraser) {
            erasePathAt(point, app.lineWidth);
            return;
        }

        if (DrawnShapeTools.includes(app.currentTool)) {
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
        if (app.currentTool === ToolType.Lasso) {
            finishLasso();
        }
        if (app.currentTool === ToolType.Connector && app.drag.connectorStartId) {
            const point = getCanvasPoint(app.mouse.x, app.mouse.y);
            const startObject = app.objects.find(object => object.id === app.drag.connectorStartId);
            const endObject = findObjectAt(point);

            if (startObject && endObject && !endObject.locked && startObject.id !== endObject.id && canEditObjects([startObject, endObject])) {
                const connector = createConnector(startObject, endObject, app.fillColor);
                saveHistory();
                app.objects.push(connector);
                setSelection([connector]);
                broadcastBoardState();
                broadcastActivity(ActivityKind.ShapeAdded, {
                    color: connector.color,
                    objectId: connector.id,
                    objectType: connector.type,
                });
            }
        }
        if (app.currentTool === ToolType.Laser) {
            sendLaserPosition(getCanvasPoint(app.mouse.x, app.mouse.y), false);
        }
        if (app.currentTool === ToolType.Select && app.drag.rotateStart && app.drag.moved) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            broadcastActivity(ActivityKind.ObjectRotated, {
                objectId: selectedObjects.length === 1 ? selectedObjects[0].id : undefined,
                objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
            });
        }
        if (app.currentTool === ToolType.Select && app.drag.connectorEndpoint && app.drag.moved) {
            finishConnectorEndpointDrag(getCanvasPoint(app.mouse.x, app.mouse.y));
        }
        if (app.currentTool === ToolType.Select && app.drag.resizeHandle && app.drag.moved) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            broadcastActivity(ActivityKind.ObjectResized, {
                objectId: selectedObjects.length === 1 ? selectedObjects[0].id : undefined,
                objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
            });
        }
        if (app.currentTool === ToolType.Select && app.drag.moved && !app.drag.connectorEndpoint) {
            const selectedObjects = getSelectedObjects();
            broadcastBoardState();
            if (!app.drag.resizeHandle) {
                broadcastActivity(ActivityKind.ObjectMoved, {
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
        app.drag.connectorEndpoint = null;
    });

    window.addEventListener('keydown', event => {
        if (isTypingTarget(event.target)) {
            return;
        }

        const modifier = event.metaKey || event.ctrlKey;
        const selectedObjects = getSelectedObjects();

        if (event.key === 'Tab' && selectedObjects.length === 1 && selectedObjects[0].type === ObjectType.MindNode) {
            event.preventDefault();
            addMindMapChild(selectedObjects[0]);
            return;
        }

        if (modifier && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey ? redo() : undo()) {
                broadcastActivity(ActivityKind.HistoryUsed, {
                    action: event.shiftKey ? 'redo' : 'undo',
                });
            }
            return;
        }

        if (modifier && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            if (redo()) {
                broadcastActivity(ActivityKind.HistoryUsed, {
                    action: 'redo',
                });
            }
            return;
        }

        if (modifier && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            duplicateSelection();
            return;
        }

        if (modifier && event.shiftKey && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            ungroupSelection();
            return;
        }

        if (modifier && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            groupSelection();
            return;
        }

        if (modifier && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            const shouldLock = selectedObjects.some(object => !object.locked);
            setSelectionLock(shouldLock);
            return;
        }

        if (!['Backspace', 'Delete'].includes(event.key) || !selectedObjects.length) {
            return;
        }

        event.preventDefault();
        if (!canEditObjects(selectedObjects)) {
            return;
        }

        const deletedObjects = deleteObjectsByIds(selectedObjects.map(object => object.id));

        if (!deletedObjects.length) {
            return;
        }

        broadcastActivity(ActivityKind.ObjectDeleted, {
            objectName: deletedObjects.length === 1 ? getObjectName(deletedObjects[0]) : `${deletedObjects.length} objects`,
        });
    });

    window.addEventListener('wheel', e => {
        app.zoom.offsetX += -e.deltaX / app.zoom.scale;
        app.zoom.offsetY += -e.deltaY / app.zoom.scale;
        applyCanvasTransform();
    });
}
