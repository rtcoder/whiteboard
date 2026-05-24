import {app} from './main.js';
import {addActivityEntries, refreshActivityLog} from './activity.js';
import {CURRENT_SCHEMA_VERSION, migrateObject, migrateObjects} from './schema.js';
import {getUserAvatar} from './utils.js';

let socket = null;
let clientId = crypto.randomUUID();
let renderBoard = () => {};
let updatePeers = () => {};
let suppressBroadcast = false;
let currentRevision = 0;
let lastCursorSentAt = 0;
let lastLaserSentAt = 0;
let lastObjectLockSentAt = 0;
let localObjectCache = new Map();
let localObjectOrder = [];
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualClose = false;
const DEBUG_NETWORK = true;
const DEBUG_CURSOR = false;
const CURSOR_SEND_INTERVAL = 50;
const LASER_SEND_INTERVAL = 40;
const OBJECT_LOCK_SEND_INTERVAL = 1200;
const MAX_RECONNECT_DELAY = 8000;

function logNetwork(...args) {
    if (DEBUG_NETWORK) {
        console.log('[whiteboard:network]', ...args);
    }
}

function getRoomStorageKey() {
    return `whiteboard:roomState:${app.roomId}`;
}

function uint8ToBase64(bytes) {
    let binary = '';
    const chunkSize = 32768;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8ClampedArray(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function serializeObject(object) {
    const withSchema = {
        ...object,
        schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    if (object.type !== 'bitmap') {
        return withSchema;
    }

    return {
        ...withSchema,
        imageData: {
            width: object.imageData.width,
            height: object.imageData.height,
            dataBase64: uint8ToBase64(object.imageData.data),
        },
    };
}

function saveLocalBoardState(objects) {
    if (!app.roomId) {
        return;
    }

    try {
        localStorage.setItem(getRoomStorageKey(), JSON.stringify(objects));
    } catch {
        // Large bitmap regions can exceed localStorage quota; the server remains the source of truth.
    }
}

function loadLocalBoardState() {
    if (!app.roomId) {
        return [];
    }

    try {
        return migrateObjects(JSON.parse(localStorage.getItem(getRoomStorageKey()) || '[]'));
    } catch {
        return [];
    }
}

function deserializeObject(object) {
    object = migrateObject(object);

    if (object.type !== 'bitmap') {
        return object;
    }

    const imageBytes = object.imageData.dataBase64
        ? base64ToUint8(object.imageData.dataBase64)
        : new Uint8ClampedArray(object.imageData.data || []);

    return {
        ...object,
        imageData: new ImageData(imageBytes, object.imageData.width, object.imageData.height),
    };
}

function getSerializedObjects() {
    return app.objects.map(serializeObject);
}

function syncLocalObjectCache(objects) {
    localObjectCache = new Map(objects.map(object => [object.id, JSON.stringify(object)]));
    localObjectOrder = objects.map(object => object.id);
}

function getBoardOperation(objects) {
    const nextCache = new Map(objects.map(object => [object.id, JSON.stringify(object)]));
    const upsert = objects.filter(object => nextCache.get(object.id) !== localObjectCache.get(object.id));
    const deleteIds = [...localObjectCache.keys()].filter(id => !nextCache.has(id));
    const orderIds = objects.map(object => object.id);
    const orderChanged = orderIds.length !== localObjectOrder.length ||
        orderIds.some((id, index) => id !== localObjectOrder[index]);

    const created = upsert.filter(object => !localObjectCache.has(object.id));
    const updated = upsert.filter(object => localObjectCache.has(object.id));

    return {
        kind: deleteIds.length
            ? 'object-deleted'
            : created.length && !updated.length
                ? 'object-created'
                : orderChanged && !upsert.length
                    ? 'objects-reordered'
                    : 'object-updated',
        upsert,
        deleteIds,
        orderIds: orderChanged ? orderIds : undefined,
        changed: upsert.length > 0 || deleteIds.length > 0 || orderChanged,
    };
}

function applyBoardOperation(operation = {}) {
    const objectsById = new Map(app.objects.map(object => [object.id, object]));

    (operation.deleteIds || []).forEach(id => objectsById.delete(id));
    (operation.upsert || []).forEach(object => {
        objectsById.set(object.id, deserializeObject(object));
    });

    if (operation.orderIds?.length) {
        const orderedObjects = operation.orderIds
            .map(id => objectsById.get(id))
            .filter(Boolean);
        const remainingObjects = [...objectsById.values()].filter(object => !operation.orderIds.includes(object.id));
        app.objects = [...orderedObjects, ...remainingObjects];
    } else {
        app.objects = [...objectsById.values()];
    }
}

function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        logNetwork('skip send, socket not open', {
            type: message.type,
            readyState: socket?.readyState,
        });
        return;
    }

    const payload = JSON.stringify(message);
    if (message.type !== 'cursor' || DEBUG_CURSOR) {
        logNetwork('send', {
            type: message.type,
            revision: message.revision,
            bytes: payload.length,
            objects: message.objects?.length,
            bitmapObjects: message.objects?.filter(object => object.type === 'bitmap').length,
        });
    }
    socket.send(payload);
}

function setConnectionStatus(state) {
    app.connectionState = state;
    const status = document.querySelector('.connection-status');

    if (!status) {
        return;
    }

    status.dataset.state = state;
    status.textContent = {
        connecting: 'Connecting',
        connected: 'Connected',
        reconnecting: 'Reconnecting',
        offline: 'Offline',
    }[state] || state;
}

export function getClientId() {
    return clientId;
}

function refreshLocalUserAvatar() {
    const avatar = getUserAvatar(app.localUser.name, `${app.localUser.name}:${clientId}`);
    app.localUser.color = avatar.color;
    app.localUser.initials = avatar.initials;
}

export function isApplyingRemoteState() {
    return suppressBroadcast;
}

export function broadcastBoardState({mode = 'merge'} = {}) {
    if (suppressBroadcast) {
        logNetwork('skip board-state broadcast while applying remote state');
        return;
    }

    const objects = getSerializedObjects();
    const revision = currentRevision;
    currentRevision += 1;
    saveLocalBoardState(objects);
    refreshActivityLog();

    if (mode === 'merge') {
        const operation = getBoardOperation(objects);

        if (!operation.changed) {
            return;
        }

        syncLocalObjectCache(objects);
        logNetwork('broadcast board-operation requested', {
            revision,
            upsert: operation.upsert.length,
            deleteIds: operation.deleteIds.length,
            orderChanged: Boolean(operation.orderIds),
        });
        send({
            type: 'board-operation',
            revision,
            operation,
        });
        return;
    }

    syncLocalObjectCache(objects);
    logNetwork('broadcast board-state requested', {
        revision,
        mode,
        objects: objects.length,
        bitmapObjects: objects.filter(object => object.type === 'bitmap').length,
    });

    send({
        type: 'board-state',
        revision,
        mode,
        objects,
    });
}

export function broadcastActivity(kind, details = {}) {
    const event = {
        id: crypto.randomUUID(),
        kind,
        details,
        timestamp: new Date().toISOString(),
        user: {
            id: clientId,
            name: app.localUser.name,
            color: app.localUser.color,
            initials: app.localUser.initials,
        },
    };

    addActivityEntries([event]);
    send({
        type: 'activity',
        event,
    });
}

export function sendCursorPosition(point) {
    const now = performance.now();

    if (now - lastCursorSentAt < CURSOR_SEND_INTERVAL) {
        return;
    }

    lastCursorSentAt = now;

    send({
        type: 'cursor',
        x: point.x,
        y: point.y,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
}

export function sendSelectionState(objectIds = []) {
    send({
        type: 'selection',
        objectIds,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
    sendObjectLockState(objectIds, true);
}

export function sendObjectLockState(objectIds = [], force = false) {
    const now = performance.now();

    if (!force && now - lastObjectLockSentAt < OBJECT_LOCK_SEND_INTERVAL) {
        return;
    }

    lastObjectLockSentAt = now;
    send({
        type: 'object-lock',
        objectIds,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
}

export function sendLaserPosition(point, active = true) {
    const now = performance.now();

    if (active && now - lastLaserSentAt < LASER_SEND_INTERVAL) {
        return;
    }

    lastLaserSentAt = now;
    send({
        type: 'laser',
        active,
        x: point.x,
        y: point.y,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
}

export function initNetwork({render, onPeersChange}) {
    renderBoard = render;
    updatePeers = onPeersChange;
    clientId = app.clientId || clientId;
    refreshLocalUserAvatar();

    if (!app.roomId) {
        return;
    }

    const connect = () => {
        window.clearTimeout(reconnectTimer);
        setConnectionStatus(reconnectAttempts ? 'reconnecting' : 'connecting');
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const params = new URLSearchParams({
            room: app.roomId,
            client: clientId,
            name: app.localUser.name,
            color: app.localUser.color,
            initials: app.localUser.initials,
        });
        socket = new WebSocket(`${protocol}://${location.host}/ws?${params.toString()}`);
        logNetwork('connecting', {
            roomId: app.roomId,
            clientId,
            reconnectAttempts,
        });

        socket.addEventListener('open', () => {
            reconnectAttempts = 0;
            setConnectionStatus('connected');
            logNetwork('open', {
                roomId: app.roomId,
                clientId,
            });
            sendSelectionState(app.selectedObjectIds);
        });

        socket.addEventListener('close', event => {
            logNetwork('close', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean,
            });

            if (manualClose) {
                setConnectionStatus('offline');
                return;
            }

            reconnectAttempts += 1;
            setConnectionStatus(reconnectAttempts > 1 ? 'offline' : 'reconnecting');
            const delay = Math.min(MAX_RECONNECT_DELAY, 600 * reconnectAttempts);
            reconnectTimer = window.setTimeout(connect, delay);
        });

        socket.addEventListener('error', event => {
            logNetwork('error', event);
            setConnectionStatus('offline');
        });

        socket.addEventListener('message', event => {
        let message;

        try {
            message = JSON.parse(event.data);
        } catch (error) {
            logNetwork('message parse error', {
                bytes: event.data?.length,
                error,
            });
            return;
        }

        if (message.type !== 'cursor' || DEBUG_CURSOR) {
            logNetwork('receive', {
                type: message.type,
                revision: message.revision,
                bytes: event.data?.length,
                objects: message.objects?.length,
                boardState: message.boardState?.length,
                locks: message.locks?.length,
                bitmapObjects: message.objects?.filter(object => object.type === 'bitmap').length,
            });
        }

        if (message.type === 'init') {
            clientId = message.clientId;
            app.clientId = clientId;
            refreshLocalUserAvatar();
            currentRevision = message.revision || 0;
            app.objectLocks = new Map((message.objectLocks || []).map(lock => [lock.objectId, lock]));
            addActivityEntries(message.activityLog || []);
            const boardState = message.boardState?.length ? migrateObjects(message.boardState) : loadLocalBoardState();
            logNetwork('apply init state', {
                revision: currentRevision,
                serverObjects: message.boardState?.length || 0,
                appliedObjects: boardState.length,
                localFallback: !message.boardState?.length && boardState.length > 0,
            });
            suppressBroadcast = true;
            app.objects = boardState.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            syncLocalObjectCache(boardState);
            renderBoard();
            refreshActivityLog();
            updatePeers();
            if (!message.boardState?.length && boardState.length) {
                broadcastBoardState();
            }
            return;
        }

        if (message.type === 'board-ack') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            logNetwork('board-state acknowledged', {
                revision: currentRevision,
            });
            return;
        }

        if (message.type === 'board-reject') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            const incomingObjects = migrateObjects(message.boardState || []);
            saveLocalBoardState(incomingObjects);
            suppressBroadcast = true;
            app.objects = incomingObjects.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            syncLocalObjectCache(incomingObjects);
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            logNetwork('board-state rejected', {
                reason: message.reason,
                objectIds: message.objectIds,
                revision: currentRevision,
            });
            window.whiteboardShowStatus?.('Someone else is editing that object');
            return;
        }

        if (message.type === 'object-lock-state') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            app.objectLocks = new Map((message.locks || []).map(lock => [lock.objectId, lock]));

            if (message.deniedIds?.length) {
                window.whiteboardShowStatus?.('Someone else is editing that object');
            }

            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            return;
        }

        if (message.type === 'error') {
            logNetwork('server error', {
                code: message.code,
                message: message.message,
            });
            window.whiteboardShowStatus?.(message.message || 'Sync error');
            return;
        }

        if (message.type === 'board-state') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            const incomingObjects = migrateObjects(message.objects || []);
            saveLocalBoardState(incomingObjects);
            suppressBroadcast = true;
            app.objects = incomingObjects.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            syncLocalObjectCache(incomingObjects);
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            refreshActivityLog();
            logNetwork('applied remote board-state', {
                revision: currentRevision,
                objects: app.objects.length,
                bitmapObjects: app.objects.filter(object => object.type === 'bitmap').length,
            });
            return;
        }

        if (message.type === 'board-operation') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            suppressBroadcast = true;
            applyBoardOperation(message.operation);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            const objects = getSerializedObjects();
            saveLocalBoardState(objects);
            syncLocalObjectCache(objects);
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            refreshActivityLog();
            logNetwork('applied remote board-operation', {
                revision: currentRevision,
                upsert: message.operation?.upsert?.length || 0,
                deleteIds: message.operation?.deleteIds?.length || 0,
                objects: app.objects.length,
            });
            return;
        }

        if (message.type === 'cursor') {
            const fallbackAvatar = getUserAvatar(message.name || 'Guest', `${message.name || 'Guest'}:${message.clientId}`);
            const existingCollaborator = app.collaborators.get(message.clientId) || {};
            app.collaborators.set(message.clientId, {
                ...existingCollaborator,
                id: message.clientId,
                name: message.name || 'Guest',
                color: message.color || fallbackAvatar.color,
                initials: message.initials || fallbackAvatar.initials,
                x: message.x,
                y: message.y,
            });
            updatePeers();
            return;
        }

        if (message.type === 'selection') {
            const fallbackAvatar = getUserAvatar(message.name || 'Guest', `${message.name || 'Guest'}:${message.clientId}`);
            const collaborator = app.collaborators.get(message.clientId) || {
                id: message.clientId,
                name: message.name || 'Guest',
                color: message.color || fallbackAvatar.color,
                initials: message.initials || fallbackAvatar.initials,
            };
            collaborator.selectedObjectIds = message.objectIds || [];
            app.collaborators.set(message.clientId, collaborator);
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            updatePeers();
            return;
        }

        if (message.type === 'laser') {
            const fallbackAvatar = getUserAvatar(message.name || 'Guest', `${message.name || 'Guest'}:${message.clientId}`);
            const collaborator = app.collaborators.get(message.clientId) || {
                id: message.clientId,
                name: message.name || 'Guest',
                color: message.color || fallbackAvatar.color,
                initials: message.initials || fallbackAvatar.initials,
            };
            collaborator.laser = message.active ? {x: message.x, y: message.y, expiresAt: Date.now() + 1200} : null;
            app.collaborators.set(message.clientId, collaborator);
            window.updateRemoteCursors?.();
            window.whiteboardUpdateRemoteLasers?.();
            return;
        }

        if (message.type === 'activity') {
            addActivityEntries([message.event]);
            return;
        }

        if (message.type === 'peer-left') {
            app.collaborators.delete(message.clientId);
            for (const [objectId, lock] of app.objectLocks) {
                if (lock.clientId === message.clientId) {
                    app.objectLocks.delete(objectId);
                }
            }
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            updatePeers();
        }
        });
    };

    window.addEventListener('beforeunload', () => {
        manualClose = true;
    });
    connect();
}
