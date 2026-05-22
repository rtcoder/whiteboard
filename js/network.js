import {app} from './main.js';

let socket = null;
let clientId = crypto.randomUUID();
let renderBoard = () => {};
let updatePeers = () => {};
let suppressBroadcast = false;

function serializeObject(object) {
    if (object.type !== 'bitmap') {
        return object;
    }

    return {
        ...object,
        imageData: {
            width: object.imageData.width,
            height: object.imageData.height,
            data: Array.from(object.imageData.data),
        },
    };
}

function deserializeObject(object) {
    if (object.type !== 'bitmap') {
        return object;
    }

    return {
        ...object,
        imageData: new ImageData(new Uint8ClampedArray(object.imageData.data), object.imageData.width, object.imageData.height),
    };
}

function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    socket.send(JSON.stringify(message));
}

export function getClientId() {
    return clientId;
}

export function isApplyingRemoteState() {
    return suppressBroadcast;
}

export function broadcastBoardState() {
    if (suppressBroadcast) {
        return;
    }

    send({
        type: 'board-state',
        objects: app.objects.map(serializeObject),
    });
}

export function sendCursorPosition(point) {
    send({
        type: 'cursor',
        x: point.x,
        y: point.y,
        name: app.localUser.name,
        color: app.localUser.color,
    });
}

export function initNetwork({render, onPeersChange}) {
    renderBoard = render;
    updatePeers = onPeersChange;

    if (!app.roomId) {
        return;
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws?room=${app.roomId}&client=${clientId}`);

    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);

        if (message.type === 'init') {
            clientId = message.clientId;
            suppressBroadcast = true;
            app.objects = (message.boardState || []).map(deserializeObject);
            suppressBroadcast = false;
            renderBoard();
            updatePeers();
            return;
        }

        if (message.type === 'board-state') {
            suppressBroadcast = true;
            app.objects = (message.objects || []).map(deserializeObject);
            app.selectedObjectId = null;
            suppressBroadcast = false;
            renderBoard();
            return;
        }

        if (message.type === 'cursor') {
            app.collaborators.set(message.clientId, {
                id: message.clientId,
                name: message.name || 'Guest',
                color: message.color || '#10b981',
                x: message.x,
                y: message.y,
            });
            updatePeers();
            return;
        }

        if (message.type === 'peer-left') {
            app.collaborators.delete(message.clientId);
            updatePeers();
        }
    });
}
