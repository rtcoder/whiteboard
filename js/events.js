import {moveCursor} from './cursor.js';
import {
    clear,
    createPath,
    createShape,
    createSticky,
    createText,
    draw,
    findObjectAt,
    floodFill,
    moveObject,
    redo,
    render,
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

function addListener(element, events, listener) {
    events.forEach(ev => {
        element.addEventListener(ev, listener);
    });
}

function setActiveTool(button) {
    app.allTools.forEach(el => el.classList.remove('active'));
    app.currentTool = button.getAttribute('id');
    button.classList.add('active');
    app.selectedObjectId = null;
    render();
}

function applyCanvasTransform() {
    clampZoomOffset();
    app.canvas.style.transform = getCanvasTransform();
    updateRemoteCursors();
}

function startPath(point) {
    const isEraser = app.currentTool === 'eraser';
    app.draftObject = createPath(
        point,
        isEraser ? 'white' : app.fillColor,
        app.lineWidth,
        app.currentTool === 'marker' ? 0.35 : 1,
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

    saveHistory();
    app.objects.push(object);
    app.selectedObjectId = object.id;
    render();
    broadcastBoardState();

    if (['line', 'arrow', 'rectangle', 'ellipse'].includes(object.type)) {
        broadcastActivity('shape-added', {
            color: object.color,
            objectType: object.type,
        });
    } else if (object.type === 'path' && app.currentTool !== 'eraser') {
        broadcastActivity('tool-used', {
            tool: app.currentTool === 'marker' ? 'marker' : 'pen',
        });
    }
}

function addTextObject(point, type) {
    const text = window.prompt(type === 'sticky' ? 'Treść notatki' : 'Tekst');

    if (!text) {
        return;
    }

    const object = type === 'sticky' ? createSticky(point, text) : createText(point, text);
    saveHistory();
    app.objects.push(object);
    app.selectedObjectId = object.id;
    render();
    broadcastBoardState();
    broadcastActivity(type === 'sticky' ? 'sticky-added' : 'text-added', {
        text,
    });
}

function moveSelectedObject(point) {
    const object = app.objects.find(item => item.id === app.selectedObjectId);

    if (!object || !app.drag.last) {
        return;
    }

    if (!app.drag.moved) {
        saveHistory();
    }

    moveObject(object, point.x - app.drag.last.x, point.y - app.drag.last.y);
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
    window.updateRemoteCursors = updateRemoteCursors;
    const boardName = localStorage.getItem(`whiteboard:boardName:${app.roomId}`) || `Whiteboard / ${app.roomId.slice(0, 8)}`;
    document.querySelector('.board-title span:last-child').textContent = boardName;
    shareButton.addEventListener('click', copyShareLink);
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
        }

        if (zoomButton) {
            const currentZoomIndex = app.zoom._steps.findIndex(v => v === app.zoom.scale);
            document.querySelectorAll('.zoom-container .minus, .zoom-container .plus')
                .forEach(el => el.classList.remove('disabled'));

            let indexModifier = 0;

            if (zoomButton.matches('.minus')) {
                if (currentZoomIndex <= 1) {
                    zoomButton.classList.add('disabled');
                }
                if (currentZoomIndex === 0) {
                    return;
                }
                indexModifier = -1;
            }
            if (zoomButton.matches('.plus')) {
                if (currentZoomIndex >= app.zoom._steps.length - 2) {
                    zoomButton.classList.add('disabled');
                }
                if (currentZoomIndex === app.zoom._steps.length - 1) {
                    return;
                }

                indexModifier = 1;
            }
            app.zoom.scale = app.zoom._steps[currentZoomIndex + indexModifier];
            applyCanvasTransform();
            document.querySelector('.zoom-container .value').innerHTML = app.zoom.scale * 100 + '%';
            document.body.style.setProperty('--scale', app.zoom.scale);
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
            const object = findObjectAt(point);
            app.selectedObjectId = object?.id || null;
            app.drag.last = point;
            render();
            return;
        }

        if (app.currentTool === 'fill') {
            const fillResult = floodFill(app.mouse.x, app.mouse.y, hexToRgba(app.fillColor));

            if (fillResult) {
                broadcastActivity('fill-used', {
                    color: app.fillColor,
                    objectType: fillResult.objectType,
                });
            }
            return;
        }

        if (app.currentTool === 'text' || app.currentTool === 'sticky') {
            app.isDrawing = false;
            showToolbar();
            addTextObject(point, app.currentTool);
            return;
        }

        if (['rectangle', 'ellipse', 'line', 'arrow'].includes(app.currentTool)) {
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
            moveSelectedObject(point);
            return;
        }

        if (['rectangle', 'ellipse', 'line', 'arrow'].includes(app.currentTool)) {
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
        if (app.currentTool === 'select' && app.drag.moved) {
            const movedObject = app.objects.find(item => item.id === app.selectedObjectId);
            broadcastBoardState();
            broadcastActivity('object-moved', {
                objectName: getObjectName(movedObject),
            });
        }
        app.drag.start = null;
        app.drag.last = null;
        app.drag.moved = false;
    });

    window.addEventListener('keydown', event => {
        if (!['Backspace', 'Delete'].includes(event.key) || !app.selectedObjectId) {
            return;
        }

        const objectIndex = app.objects.findIndex(object => object.id === app.selectedObjectId);

        if (objectIndex === -1) {
            return;
        }

        event.preventDefault();
        saveHistory();
        const [object] = app.objects.splice(objectIndex, 1);
        app.selectedObjectId = null;
        render();
        broadcastBoardState();
        broadcastActivity('object-deleted', {
            objectName: getObjectName(object),
        });
    });

    window.addEventListener('wheel', e => {
        app.zoom.offsetX += -e.deltaX / app.zoom.scale;
        app.zoom.offsetY += -e.deltaY / app.zoom.scale;
        applyCanvasTransform();
    });
}
