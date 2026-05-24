import {app} from './app.js';
import {addActivityEntries, refreshActivityLog} from './activity.js';
import {BoardOperationKind} from './enums/board-operation-kind.js';
import {ConnectionStatus, ConnectionStatusLabels} from './enums/connection-status';
import {NetworkMessageType} from './enums/network-message-type.js';
import {ObjectType} from './enums/object-type.js';
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
let pendingBoardStates = new Map();
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

function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8ClampedArray(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function imageDataPayloadToDataUrl(payload = {}) {
    const width = payload.width || 1;
    const height = payload.height || 1;
    let bytes = payload.dataBase64
        ? base64ToUint8(payload.dataBase64)
        : new Uint8ClampedArray(payload.data || []);
    const expectedLength = width * height * 4;

    if (bytes.length !== expectedLength) {
        bytes = new Uint8ClampedArray(expectedLength);
    }

    const imageData = new ImageData(bytes, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

function serializeObject(object) {
    return {
        ...object,
        schemaVersion: CURRENT_SCHEMA_VERSION,
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

    if (object.type !== ObjectType.Bitmap) {
        return object;
    }

    return migrateObject({
        id: object.id,
        type: ObjectType.Image,
        x: object.x,
        y: object.y,
        width: object.width || object.imageData?.width || 1,
        height: object.height || object.imageData?.height || 1,
        src: imageDataPayloadToDataUrl(object.imageData),
        linkedObjectIds: object.linkedObjectIds || [],
        legacyBitmapFill: true,
        rotation: object.rotation || 0,
        opacity: object.opacity,
    });
}

function getSerializedObjects() {
    return app.objects.map(serializeObject);
}

function syncLocalObjectCache(objects) {
    localObjectCache = new Map(objects.map(object => [object.id, JSON.stringify(object)]));
    localObjectOrder = objects.map(object => object.id);
}

function markBoardStatePending(revision, objects) {
    pendingBoardStates.set(revision, objects);
    clearTimeout(syncedStatusTimer);
    setConnectionStatus(ConnectionStatus.Saving);
    syncedStatusTimer = setTimeout(() => setConnectionStatus(ConnectionStatus.Connected), 8000);
}

function acknowledgeBoardState(clientRevision) {
    const pendingRevision = pendingBoardStates.has(clientRevision)
        ? clientRevision
        : pendingBoardStates.keys().next().value;

    if (pendingRevision !== undefined) {
        const pendingObjects = pendingBoardStates.get(pendingRevision);
        syncLocalObjectCache(pendingObjects);
        pendingBoardStates.delete(pendingRevision);
    }

    clearTimeout(syncedStatusTimer);

    if (pendingBoardStates.size) {
        setConnectionStatus(ConnectionStatus.Saving);
        syncedStatusTimer = setTimeout(() => setConnectionStatus(ConnectionStatus.Connected), 8000);
    } else {
        setConnectionStatus(ConnectionStatus.Synced);
        syncedStatusTimer = setTimeout(() => setConnectionStatus(ConnectionStatus.Connected), 2000);
    }
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
            ? BoardOperationKind.ObjectDeleted
            : created.length && !updated.length
                ? BoardOperationKind.ObjectCreated
                : orderChanged && !upsert.length
                    ? BoardOperationKind.ObjectsReordered
                    : BoardOperationKind.ObjectUpdated,
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
        return false;
    }

    const payload = JSON.stringify(message);
    if (message.type !== NetworkMessageType.Cursor || DEBUG_CURSOR) {
        logNetwork('send', {
            type: message.type,
            revision: message.revision,
            bytes: payload.length,
            objects: message.objects?.length,
            bitmapObjects: message.objects?.filter(object => object.type === ObjectType.Bitmap).length,
        });
    }
    socket.send(payload);
    return true;
}

let syncedStatusTimer = null;

function setConnectionStatus(state) {
    app.connectionState = state;
    const status = document.querySelector('.connection-status');

    if (!status) {
        return;
    }

    status.dataset.state = state;
    status.textContent = ConnectionStatusLabels[state] || state;
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

        logNetwork('broadcast board-operation requested', {
            revision,
            upsert: operation.upsert.length,
            deleteIds: operation.deleteIds.length,
            orderChanged: Boolean(operation.orderIds),
        });
        const sent = send({
            type: NetworkMessageType.BoardOperation,
            revision,
            operation,
        });
        if (sent) {
            markBoardStatePending(revision, objects);
        }
        return;
    }

    logNetwork('broadcast board-state requested', {
        revision,
        mode,
        objects: objects.length,
        bitmapObjects: objects.filter(object => object.type === ObjectType.Bitmap).length,
    });

    const sent = send({
        type: NetworkMessageType.BoardState,
        revision,
        mode,
        objects,
    });
    if (sent) {
        markBoardStatePending(revision, objects);
    }
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
        type: NetworkMessageType.Activity,
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
        type: NetworkMessageType.Cursor,
        x: point.x,
        y: point.y,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
}

export function sendSelectionState(objectIds = []) {
    send({
        type: NetworkMessageType.Selection,
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
        type: NetworkMessageType.ObjectLock,
        objectIds,
        name: app.localUser.name,
        color: app.localUser.color,
        initials: app.localUser.initials,
    });
}

export function sendReaction(emoji, point) {
    send({
        type: NetworkMessageType.Reaction,
        emoji,
        x: point.x,
        y: point.y,
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
        type: NetworkMessageType.Laser,
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
        setConnectionStatus(reconnectAttempts ? ConnectionStatus.Reconnecting : ConnectionStatus.Connecting);
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
            setConnectionStatus(ConnectionStatus.Connected);
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
                setConnectionStatus(ConnectionStatus.Offline);
                return;
            }

            reconnectAttempts += 1;
            setConnectionStatus(reconnectAttempts > 1 ? ConnectionStatus.Offline : ConnectionStatus.Reconnecting);
            const delay = Math.min(MAX_RECONNECT_DELAY, 600 * reconnectAttempts);
            reconnectTimer = window.setTimeout(connect, delay);
        });

        socket.addEventListener('error', event => {
            logNetwork('error', event);
            setConnectionStatus(ConnectionStatus.Offline);
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

        if (message.type !== NetworkMessageType.Cursor || DEBUG_CURSOR) {
            logNetwork('receive', {
                type: message.type,
                revision: message.revision,
                bytes: event.data?.length,
                objects: message.objects?.length,
                boardState: message.boardState?.length,
                locks: message.locks?.length,
                bitmapObjects: message.objects?.filter(object => object.type === ObjectType.Bitmap).length,
            });
        }

        if (message.type === NetworkMessageType.Init) {
            clientId = message.clientId;
            app.clientId = clientId;
            refreshLocalUserAvatar();
            currentRevision = message.revision || 0;
            pendingBoardStates = new Map();
            app.objectLocks = new Map((message.objectLocks || []).map(lock => [lock.objectId, lock]));
            addActivityEntries(message.activityLog || []);
            const serverBoardState = migrateObjects(message.boardState || []);
            const hasServerSnapshot = serverBoardState.length > 0 || currentRevision > 0;
            const boardState = hasServerSnapshot ? serverBoardState : loadLocalBoardState();
            logNetwork('apply init state', {
                revision: currentRevision,
                serverObjects: message.boardState?.length || 0,
                appliedObjects: boardState.length,
                localFallback: !hasServerSnapshot && boardState.length > 0,
            });
            suppressBroadcast = true;
            app.objects = boardState.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            const serializedObjects = getSerializedObjects();
            saveLocalBoardState(serializedObjects);
            syncLocalObjectCache(hasServerSnapshot ? serializedObjects : serverBoardState);
            renderBoard();
            refreshActivityLog();
            updatePeers();
            if (!hasServerSnapshot && boardState.length) {
                broadcastBoardState({ mode: 'replace' });
            }
            return;
        }

        if (message.type === NetworkMessageType.BoardAck) {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            logNetwork('board-state acknowledged', {
                revision: currentRevision,
            });
            acknowledgeBoardState(message.clientRevision);
            return;
        }

        if (message.type === NetworkMessageType.BoardReject) {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            pendingBoardStates = new Map();
            clearTimeout(syncedStatusTimer);
            setConnectionStatus(ConnectionStatus.Connected);
            const incomingObjects = migrateObjects(message.boardState || []);
            suppressBroadcast = true;
            app.objects = incomingObjects.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            const serializedObjects = getSerializedObjects();
            saveLocalBoardState(serializedObjects);
            syncLocalObjectCache(serializedObjects);
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

        if (message.type === NetworkMessageType.ObjectLockState) {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            app.objectLocks = new Map((message.locks || []).map(lock => [lock.objectId, lock]));

            if (message.deniedIds?.length) {
                window.whiteboardShowStatus?.('Someone else is editing that object');
            }

            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            return;
        }

        if (message.type === NetworkMessageType.Error) {
            logNetwork('server error', {
                code: message.code,
                message: message.message,
            });
            clearTimeout(syncedStatusTimer);
            setConnectionStatus(ConnectionStatus.Connected);
            window.whiteboardShowStatus?.(message.message || 'Sync error');
            return;
        }

        if (message.type === NetworkMessageType.BoardState) {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            const incomingObjects = migrateObjects(message.objects || []);
            suppressBroadcast = true;
            app.objects = incomingObjects.map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            const serializedObjects = getSerializedObjects();
            saveLocalBoardState(serializedObjects);
            syncLocalObjectCache(serializedObjects);
            renderBoard();
            window.whiteboardUpdateSelectionUi?.();
            refreshActivityLog();
            logNetwork('applied remote board-state', {
                revision: currentRevision,
                objects: app.objects.length,
                bitmapObjects: app.objects.filter(object => object.type === ObjectType.Bitmap).length,
            });
            return;
        }

        if (message.type === NetworkMessageType.BoardOperation) {
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

        if (message.type === NetworkMessageType.Cursor) {
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

        if (message.type === NetworkMessageType.Selection) {
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

        if (message.type === NetworkMessageType.Laser) {
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

        if (message.type === NetworkMessageType.Reaction) {
            const fallbackAvatar = getUserAvatar(message.name || 'Guest', `${message.name || 'Guest'}:${message.clientId}`);
            const collaborator = app.collaborators.get(message.clientId) || {
                id: message.clientId,
                name: message.name || 'Guest',
                color: message.color || fallbackAvatar.color,
                initials: message.initials || fallbackAvatar.initials,
            };
            if (!collaborator.reactions) {
                collaborator.reactions = [];
            }
            collaborator.reactions.push({
                emoji: message.emoji,
                x: message.x,
                y: message.y,
                id: crypto.randomUUID(),
                expiresAt: Date.now() + 4000,
            });
            app.collaborators.set(message.clientId, collaborator);
            window.whiteboardUpdateRemoteLasers?.();
            return;
        }

        if (message.type === NetworkMessageType.Activity) {
            addActivityEntries([message.event]);
            return;
        }

        if (message.type === NetworkMessageType.PeerLeft) {
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
