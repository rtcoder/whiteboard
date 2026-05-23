import {moveCursor} from './cursor.js';
import {
    clear,
    createCallout,
    createComment,
    createFrame,
    createLabel,
    createList,
    createPath,
    createShape,
    createSticky,
    createText,
    deleteObjectById,
    duplicateObject,
    exportBoardPng,
    draw,
    findObjectAt,
    floodFill,
    getObjectBounds,
    getObjectsInBounds,
    getObjectsBounds,
    getSelectedObjects,
    getSelectedObjectsBounds,
    moveObjects,
    moveObjectLayer,
    normalizeFrame,
    copyBoardImage,
    redo,
    render,
    resizeObjects,
    saveHistory,
    undo,
} from './drawing.js';
import {getObjectName} from './activity.js';
import {app, setMousePosition} from './main.js';
import {broadcastActivity, broadcastBoardState, sendCursorPosition} from './network.js';
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
    app.selectedObjectIds = objects.map(object => object.id);
    app.selectedObjectId = app.selectedObjectIds[0] || null;
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
    const selectedObjects = getSelectedObjects();

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

    const selectedObjects = getObjectsInBounds(app.lassoBounds);
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
    });

    if (presence) {
        presence.innerHTML = `
            <span class="avatar active" style="--avatar-color: ${app.localUser.color}" title="${app.localUser.name}">${app.localUser.initials}</span>
            ${[...app.collaborators.values()].map(user => (
                `<span class="avatar" style="--avatar-color: ${user.color}" title="${user.name}">${user.initials}</span>`
            )).join('')}
        `;
    }
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
    const boardName = localStorage.getItem(`whiteboard:boardName:${app.roomId}`) || `Whiteboard / ${app.roomId.slice(0, 8)}`;
    document.querySelector('.board-title span:last-child').textContent = boardName;
    shareButton.addEventListener('click', copyShareLink);
    fitBoardButton.addEventListener('click', () => {
        fitBoundsToScreen(getObjectsBounds() || {x: 0, y: 0, width: app.canvas.width, height: app.canvas.height});
    });
    zoomSelectionButton.addEventListener('click', () => {
        fitBoundsToScreen(getSelectedObjectsBounds());
    });
    fillColorInput.addEventListener('input', () => {
        app.fillColor = fillColorInput.value;
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
                if (clear()) {
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
                const duplicate = duplicateObject(app.selectedObjectId);

                if (duplicate) {
                    broadcastActivity('object-duplicated', {
                        objectId: duplicate.id,
                        objectName: getObjectName(duplicate),
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

            if (toolbarButton.id === 'copyImage') {
                copyBoardImage().catch(() => false);
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

            if (object) {
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
    });

    window.addEventListener('keydown', event => {
        const selectedObjects = getSelectedObjects();

        if (!['Backspace', 'Delete'].includes(event.key) || !selectedObjects.length) {
            return;
        }

        event.preventDefault();
        selectedObjects.forEach(object => deleteObjectById(object.id));
        broadcastActivity('object-deleted', {
            objectName: selectedObjects.length === 1 ? getObjectName(selectedObjects[0]) : `${selectedObjects.length} objects`,
        });
    });

    window.addEventListener('wheel', e => {
        app.zoom.offsetX += -e.deltaX / app.zoom.scale;
        app.zoom.offsetY += -e.deltaY / app.zoom.scale;
        applyCanvasTransform();
    });
}
