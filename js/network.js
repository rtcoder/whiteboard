import {app} from './main.js';
import {addActivityEntries, refreshActivityLog} from './activity.js';
import {getUserAvatar} from './utils.js';

let socket = null;
let clientId = crypto.randomUUID();
let renderBoard = () => {};
let updatePeers = () => {};
let suppressBroadcast = false;
let currentRevision = 0;
let lastCursorSentAt = 0;
const DEBUG_NETWORK = true;
const DEBUG_CURSOR = false;
const CURSOR_SEND_INTERVAL = 50;

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
    if (object.type !== 'bitmap') {
        return object;
    }

    return {
        ...object,
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
        return JSON.parse(localStorage.getItem(getRoomStorageKey()) || '[]');
    } catch {
        return [];
    }
}

function deserializeObject(object) {
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

    const objects = app.objects.map(serializeObject);
    const revision = currentRevision;
    currentRevision += 1;
    saveLocalBoardState(objects);
    refreshActivityLog();
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

export function initNetwork({render, onPeersChange}) {
    renderBoard = render;
    updatePeers = onPeersChange;
    clientId = app.clientId || clientId;
    refreshLocalUserAvatar();

    if (!app.roomId) {
        return;
    }

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
    });

    socket.addEventListener('open', () => {
        logNetwork('open', {
            roomId: app.roomId,
            clientId,
        });
    });

    socket.addEventListener('close', event => {
        logNetwork('close', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
        });
    });

    socket.addEventListener('error', event => {
        logNetwork('error', event);
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
                bitmapObjects: message.objects?.filter(object => object.type === 'bitmap').length,
            });
        }

        if (message.type === 'init') {
            clientId = message.clientId;
            app.clientId = clientId;
            refreshLocalUserAvatar();
            currentRevision = message.revision || 0;
            addActivityEntries(message.activityLog || []);
            const boardState = message.boardState?.length ? message.boardState : loadLocalBoardState();
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

        if (message.type === 'board-state') {
            currentRevision = Math.max(currentRevision, message.revision || 0);
            saveLocalBoardState(message.objects || []);
            suppressBroadcast = true;
            app.objects = (message.objects || []).map(deserializeObject);
            app.selectedObjectId = null;
            app.selectedObjectIds = [];
            suppressBroadcast = false;
            renderBoard();
            refreshActivityLog();
            logNetwork('applied remote board-state', {
                revision: currentRevision,
                objects: app.objects.length,
                bitmapObjects: app.objects.filter(object => object.type === 'bitmap').length,
            });
            return;
        }

        if (message.type === 'cursor') {
            const fallbackAvatar = getUserAvatar(message.name || 'Guest', `${message.name || 'Guest'}:${message.clientId}`);
            app.collaborators.set(message.clientId, {
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

        if (message.type === 'activity') {
            addActivityEntries([message.event]);
            return;
        }

        if (message.type === 'peer-left') {
            app.collaborators.delete(message.clientId);
            updatePeers();
        }
    });
}
