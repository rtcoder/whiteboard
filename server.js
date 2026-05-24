const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.whiteboard-rooms');
const rooms = new Map();
const DEBUG_WS = true;
const DEBUG_WS_CURSOR = false;
const MAX_ACTIVITY_ITEMS = 200;
const MAX_OPERATION_LOG_ITEMS = 500;
const OBJECT_LOCK_TTL_MS = 8000;
const CURRENT_ROOM_SCHEMA_VERSION = 2;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_BITMAP_PIXELS = 1_800_000;
const MAX_ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
const OPERATION_RATE_WINDOW_MS = 1000;
const MAX_OPERATIONS_PER_WINDOW = 16;
const ROOM_ACCESS_MODES = new Set(['open', 'closed']);
const mimeTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
};

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
}

function logWs(...args) {
    if (DEBUG_WS) {
        console.log('[whiteboard:ws]', ...args);
    }
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath);
    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
        res.end(data);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sanitizeRoomId(roomId) {
    return String(roomId || '').replace(/[^a-zA-Z0-9-]/g, '');
}

function createRoomAccessToken(room, clientId) {
    const token = crypto.randomUUID();
    room.accessTokens = room.accessTokens || new Map();
    room.accessTokens.set(clientId, token);
    return token;
}

function canClientJoinRoom(room, clientId, accessToken = '') {
    return room.accessMode !== 'closed'
        || room.host?.id === clientId
        || (Boolean(accessToken) && room.accessTokens?.get(clientId) === accessToken);
}

function getRoomMetadata(room, clientId = '', accessToken = '') {
    return {
        id: room.id,
        name: room.name || `Whiteboard / ${room.id.slice(0, 8)}`,
        host: room.host || null,
        accessMode: room.accessMode || 'open',
        canJoin: canClientJoinRoom(room, clientId, accessToken),
        revision: room.revision || 0,
        hasBoardState: Boolean(room.boardState?.length),
    };
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (req.method === 'GET' && /^\/api\/rooms\/[^/]+$/.test(pathname)) {
        const roomId = sanitizeRoomId(pathname.replace('/api/rooms/', ''));

        if (!roomId) {
            sendJson(res, 400, {error: 'Missing room id'});
            return;
        }

        const query = new URLSearchParams(parsedUrl.query || '');
        const clientId = sanitizeRoomId(query.get('client'));
        const accessToken = sanitizeRoomId(query.get('token'));
        sendJson(res, 200, getRoomMetadata(getRoom(roomId), clientId, accessToken));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/rooms') {
        try {
            const body = await readJsonBody(req);
            const roomId = sanitizeRoomId(body.roomId || crypto.randomUUID());

            if (!roomId) {
                sendJson(res, 400, {error: 'Missing room id'});
                return;
            }

            const room = getRoom(roomId);
            const roomName = String(body.name || '').trim() || `Whiteboard / ${roomId.slice(0, 8)}`;
            room.name = roomName.slice(0, 120);
            room.host = room.host || body.host || null;
            room.accessMode = ROOM_ACCESS_MODES.has(body.accessMode) ? body.accessMode : 'open';
            room.lastTouchedAt = Date.now();
            if (room.host?.id) {
                createRoomAccessToken(room, room.host.id);
            }
            persistRoom(roomId, room);
            sendJson(res, 201, {
                ...getRoomMetadata(room, body.host?.id),
                accessToken: room.accessTokens.get(room.host?.id),
            });
        } catch (error) {
            sendJson(res, 400, {error: 'Invalid room payload'});
        }
        return;
    }

    const joinRequestMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join-requests(?:\/([^/]+))?$/);

    if (joinRequestMatch) {
        const roomId = sanitizeRoomId(joinRequestMatch[1]);
        const requestId = joinRequestMatch[2] ? sanitizeRoomId(joinRequestMatch[2]) : null;
        const room = getRoom(roomId);
        room.joinRequests = room.joinRequests || new Map();

        if (req.method === 'POST' && !requestId) {
            try {
                const body = await readJsonBody(req);
                const clientId = sanitizeRoomId(body.clientId);
                const user = body.user || {};

                if (!clientId || !user.name) {
                    sendJson(res, 400, {error: 'Missing join request user'});
                    return;
                }

                if (canClientJoinRoom(room, clientId, body.accessToken)) {
                    sendJson(res, 200, {
                        id: crypto.randomUUID(),
                        status: 'accepted',
                        accessToken: room.accessTokens.get(clientId) || null,
                    });
                    return;
                }

                const request = {
                    id: crypto.randomUUID(),
                    clientId,
                    user: {
                        id: clientId,
                        name: String(user.name).slice(0, 80),
                        color: user.color || '#2563eb',
                        initials: user.initials || 'G',
                    },
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                };
                room.joinRequests.set(request.id, request);
                room.lastTouchedAt = Date.now();
                notifyHostJoinRequest(room, request);
                sendJson(res, 202, request);
            } catch {
                sendJson(res, 400, {error: 'Invalid join request'});
            }
            return;
        }

        if (req.method === 'GET' && requestId) {
            const request = room.joinRequests.get(requestId);

            if (!request) {
                sendJson(res, 404, {error: 'Join request not found'});
                return;
            }

            sendJson(res, 200, request);
            return;
        }

        if (req.method === 'POST' && requestId) {
            try {
                const body = await readJsonBody(req);
                const request = room.joinRequests.get(requestId);

                if (!request) {
                    sendJson(res, 404, {error: 'Join request not found'});
                    return;
                }

                if (room.host?.id && body.hostId !== room.host.id) {
                    sendJson(res, 403, {error: 'Only the host can update join requests'});
                    return;
                }

                request.status = body.action === 'accept' ? 'accepted' : 'rejected';
                request.decidedAt = new Date().toISOString();
                if (request.status === 'accepted') {
                    request.accessToken = createRoomAccessToken(room, request.clientId);
                }
                room.lastTouchedAt = Date.now();
                persistRoom(room.id, room);
                sendJson(res, 200, request);
            } catch {
                sendJson(res, 400, {error: 'Invalid join request update'});
            }
            return;
        }
    }

    if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) {
        sendFile(res, path.join(ROOT, pathname));
        return;
    }

    if (pathname === '/package.json') {
        sendFile(res, path.join(ROOT, 'package.json'));
        return;
    }

    sendFile(res, path.join(ROOT, 'index.html'));
});

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        const storedRoom = loadRoom(roomId);
        rooms.set(roomId, {
            id: roomId,
            name: storedRoom.name || `Whiteboard / ${roomId.slice(0, 8)}`,
            host: storedRoom.host || null,
            accessMode: storedRoom.accessMode || 'open',
            boardState: storedRoom.boardState || [],
            clients: new Set(),
            joinRequests: new Map(),
            accessTokens: new Map(storedRoom.accessTokens || []),
            approvedClients: new Set(storedRoom.approvedClients || []),
            objectLocks: new Map(),
            revision: storedRoom.revision || 0,
            activityLog: storedRoom.activityLog || [],
            operationLog: storedRoom.operationLog || [],
            schemaVersion: CURRENT_ROOM_SCHEMA_VERSION,
        });
    }

    return rooms.get(roomId);
}

function getRoomFile(roomId) {
    return path.join(DATA_DIR, `${roomId.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

function loadRoom(roomId) {
    try {
        const room = JSON.parse(fs.readFileSync(getRoomFile(roomId), 'utf8'));
        return {
            schemaVersion: CURRENT_ROOM_SCHEMA_VERSION,
            name: typeof room.name === 'string' ? room.name : undefined,
            host: room.host || null,
            accessMode: ROOM_ACCESS_MODES.has(room.accessMode) ? room.accessMode : 'open',
            approvedClients: Array.isArray(room.approvedClients) ? room.approvedClients : [],
            accessTokens: Array.isArray(room.accessTokens) ? room.accessTokens : [],
            boardState: Array.isArray(room.boardState) ? room.boardState : [],
            revision: Number.isFinite(room.revision) ? room.revision : 0,
            activityLog: Array.isArray(room.activityLog) ? room.activityLog : [],
            operationLog: Array.isArray(room.operationLog) ? room.operationLog : [],
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logWs('room file ignored', {
                roomId,
                error: error.message,
            });
        }
        return {};
    }
}

function persistRoom(roomId, room) {
    const filePath = getRoomFile(roomId);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    const backupPath = `${filePath}.bak`;
    const payload = JSON.stringify({
        schemaVersion: CURRENT_ROOM_SCHEMA_VERSION,
        name: typeof room.name === 'string' ? room.name : undefined,
        host: room.host || null,
        accessMode: ROOM_ACCESS_MODES.has(room.accessMode) ? room.accessMode : 'open',
        approvedClients: [...room.approvedClients || []],
        accessTokens: [...room.accessTokens || []],
        boardState: room.boardState,
        revision: room.revision,
        activityLog: room.activityLog,
        operationLog: room.operationLog,
    });
    const writePayload = () => {
        fs.writeFile(tempPath, payload, error => {
            if (error) {
                logWs('room write failed', {roomId, error: error.message});
                return;
            }

            fs.rename(tempPath, filePath, renameError => {
                if (renameError) {
                    logWs('room write rename failed', {roomId, error: renameError.message});
                }
            });
        });
    };

    fs.copyFile(filePath, backupPath, error => {
        if (error && error.code !== 'ENOENT') {
            logWs('room backup failed', {roomId, error: error.message});
        }

        writePayload();
    });
}

function encodeFrame(payload) {
    const data = Buffer.from(payload);
    const header = [];

    header.push(0x81);
    if (data.length < 126) {
        header.push(data.length);
    } else if (data.length < 65536) {
        header.push(126, data.length >> 8, data.length & 255);
    } else {
        header.push(127, 0, 0, 0, 0, data.length >> 24, data.length >> 16 & 255, data.length >> 8 & 255, data.length & 255);
    }

    return Buffer.concat([Buffer.from(header), data]);
}

function decodeFrame(buffer) {
    if (buffer.length < 2) {
        return null;
    }

    const fin = Boolean(buffer[0] & 0x80);
    const opcode = buffer[0] & 15;

    if (opcode === 8) {
        return {
            consumed: 2,
            fin,
            opcode,
            payload: null,
        };
    }

    let length = buffer[1] & 127;
    let offset = 2;

    if (length === 126) {
        if (buffer.length < offset + 2) {
            return null;
        }
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buffer.length < offset + 8) {
            return null;
        }
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
    }

    if (buffer.length < offset + 4 + length) {
        return null;
    }

    const mask = buffer.slice(offset, offset + 4);
    offset += 4;

    const payload = buffer.slice(offset, offset + length);
    for (let index = 0; index < payload.length; index++) {
        payload[index] ^= mask[index % 4];
    }

    return {
        consumed: offset + length,
        fin,
        opcode,
        payload,
    };
}

function send(socket, message) {
    if (!socket.destroyed && !socket.writableEnded) {
        socket.write(encodeFrame(JSON.stringify(message)));
    }
}

function broadcast(room, sender, message) {
    for (const client of room.clients) {
        if (client !== sender) {
            send(client, message);
        }
    }
}

function notifyHostJoinRequest(room, request) {
    for (const client of room.clients) {
        if (client.clientId === room.host?.id) {
            send(client, {
                type: 'join-request',
                request,
            });
        }
    }
}

function createActivity(kind, user, details = {}) {
    return {
        id: crypto.randomUUID(),
        kind,
        details,
        timestamp: new Date().toISOString(),
        user,
    };
}

function addRoomActivity(room, event) {
    room.activityLog = [...room.activityLog, event].slice(-MAX_ACTIVITY_ITEMS);
    if (room.id) {
        persistRoom(room.id, room);
    }
}

function broadcastActivity(room, sender, event) {
    addRoomActivity(room, event);
    broadcast(room, sender, {
        type: 'activity',
        event,
    });
}

function addRoomOperation(room, clientId, message, nextBoardState) {
    const operationEntry = {
        id: crypto.randomUUID(),
        type: message.type === 'board-state'
            ? message.mode === 'replace'
                ? 'snapshot-restored'
                : 'object-updated'
            : message.operation?.kind || 'object-updated',
        revision: room.revision,
        clientId,
        timestamp: new Date().toISOString(),
        operation: message.type === 'board-operation' ? message.operation : null,
        objectCount: nextBoardState.length,
    };

    room.operationLog = [...(room.operationLog || []), operationEntry].slice(-MAX_OPERATION_LOG_ITEMS);
}

function mergeBoardState(currentObjects, incomingObjects) {
    const objectsById = new Map(currentObjects.map(object => [object.id, object]));

    for (const object of incomingObjects) {
        objectsById.set(object.id, object);
    }

    return [...objectsById.values()];
}

function applyBoardOperation(currentObjects, operation = {}) {
    const objectsById = new Map(currentObjects.map(object => [object.id, object]));

    (operation.deleteIds || []).forEach(id => objectsById.delete(id));
    (operation.upsert || []).forEach(object => {
        objectsById.set(object.id, object);
    });

    if (operation.orderIds?.length) {
        const orderedObjects = operation.orderIds
            .map(id => objectsById.get(id))
            .filter(Boolean);
        const remainingObjects = [...objectsById.values()].filter(object => !operation.orderIds.includes(object.id));
        return [...orderedObjects, ...remainingObjects];
    }

    return [...objectsById.values()];
}

function pruneObjectLocks(room) {
    const now = Date.now();

    for (const [objectId, lock] of room.objectLocks) {
        if (lock.expiresAt <= now || ![...room.clients].some(client => client.clientId === lock.clientId)) {
            room.objectLocks.delete(objectId);
        }
    }
}

function serializeObjectLocks(room) {
    pruneObjectLocks(room);
    return [...room.objectLocks.entries()].map(([objectId, lock]) => ({
        objectId,
        clientId: lock.clientId,
        user: lock.user,
        expiresAt: lock.expiresAt,
    }));
}

function releaseClientObjectLocks(room, clientId, exceptObjectIds = []) {
    const keepIds = new Set(exceptObjectIds);

    for (const [objectId, lock] of room.objectLocks) {
        if (lock.clientId === clientId && !keepIds.has(objectId)) {
            room.objectLocks.delete(objectId);
        }
    }
}

function updateObjectLocks(room, socket, objectIds = []) {
    pruneObjectLocks(room);
    releaseClientObjectLocks(room, socket.clientId, objectIds);
    const now = Date.now();
    const deniedIds = [];

    for (const objectId of objectIds) {
        const existingLock = room.objectLocks.get(objectId);

        if (existingLock && existingLock.clientId !== socket.clientId) {
            deniedIds.push(objectId);
            continue;
        }

        room.objectLocks.set(objectId, {
            clientId: socket.clientId,
            user: socket.user,
            expiresAt: now + OBJECT_LOCK_TTL_MS,
        });
    }

    return deniedIds;
}

function getOperationObjectIds(operation = {}, previousObjects = [], nextObjects = []) {
    const ids = new Set([
        ...(operation.deleteIds || []),
        ...(operation.upsert || []).map(object => object.id),
    ]);

    if (operation.kind === 'objects-reordered' && operation.orderIds?.length) {
        previousObjects.forEach(object => ids.add(object.id));
        nextObjects.forEach(object => ids.add(object.id));
    }

    return [...ids].filter(Boolean);
}

function getBoardStateObjectIds(previousObjects = [], nextObjects = []) {
    const ids = new Set();
    previousObjects.forEach(object => ids.add(object.id));
    nextObjects.forEach(object => ids.add(object.id));
    return [...ids].filter(Boolean);
}

function getLockConflicts(room, clientId, objectIds = []) {
    pruneObjectLocks(room);
    return objectIds.filter(objectId => {
        const lock = room.objectLocks.get(objectId);
        return lock && lock.clientId !== clientId;
    });
}

function getBitmapPixelCount(object) {
    if (object?.type !== 'bitmap') {
        return 0;
    }

    return (object.width || object.imageData?.width || 0) * (object.height || object.imageData?.height || 0);
}

function getOversizedBitmapIds(objects = []) {
    return objects
        .filter(object => getBitmapPixelCount(object) > MAX_BITMAP_PIXELS)
        .map(object => object.id);
}

function hitOperationRateLimit(socket) {
    const now = Date.now();

    if (!socket.operationWindow || now - socket.operationWindow.startedAt > OPERATION_RATE_WINDOW_MS) {
        socket.operationWindow = {
            startedAt: now,
            count: 0,
        };
    }

    socket.operationWindow.count += 1;
    return socket.operationWindow.count > MAX_OPERATIONS_PER_WINDOW;
}

function sendError(socket, code, message) {
    send(socket, {
        type: 'error',
        code,
        message,
    });
}

function cleanupRooms() {
    const now = Date.now();

    for (const [roomId, room] of rooms) {
        pruneObjectLocks(room);
        for (const [requestId, request] of room.joinRequests || []) {
            const age = now - new Date(request.createdAt).getTime();

            if (request.status !== 'pending' && age > 10 * 60 * 1000) {
                room.joinRequests.delete(requestId);
            }
        }

        if (!room.clients.size && !room.boardState.length && now - (room.lastTouchedAt || now) > MAX_ROOM_IDLE_MS) {
            rooms.delete(roomId);
        }
    }
}

server.on('upgrade', (req, socket) => {
    const parsedUrl = url.parse(req.url, true);
    const roomId = parsedUrl.query.room;
    const clientId = parsedUrl.query.client || crypto.randomUUID();

    if (parsedUrl.pathname !== '/ws' || !roomId) {
        socket.destroy();
        return;
    }

    const room = getRoom(roomId);
    const accessToken = sanitizeRoomId(parsedUrl.query.token);
    if (!canClientJoinRoom(room, clientId, accessToken)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        logWs('websocket rejected', {
            roomId,
            clientId,
            reason: 'closed-room',
        });
        return;
    }

    const key = req.headers['sec-websocket-key'];
    const accept = crypto
        .createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
    ].join('\r\n'));

    socket.clientId = clientId;
    socket.roomId = roomId;
    socket.user = {
        id: clientId,
        name: parsedUrl.query.name || 'Guest',
        color: parsedUrl.query.color || '#2563eb',
        initials: parsedUrl.query.initials || 'G',
    };
    if (!room.host) {
        room.host = socket.user;
        persistRoom(roomId, room);
    }
    socket.frameBuffer = Buffer.alloc(0);
    socket.messageFragments = [];
    room.clients.add(socket);
    room.lastTouchedAt = Date.now();
    logWs('client connected', {
        roomId,
        clientId,
        clients: room.clients.size,
        storedObjects: room.boardState.length,
    });

    send(socket, {
        type: 'init',
        clientId,
        roomName: room.name,
        host: room.host,
        accessMode: room.accessMode || 'open',
        boardState: room.boardState,
        activityLog: room.activityLog,
        operationLog: room.operationLog,
        objectLocks: serializeObjectLocks(room),
        revision: room.revision,
        peers: [...room.clients].filter(client => client !== socket).map(client => client.clientId),
    });

    const joinEvent = createActivity('user-joined', socket.user);
    broadcastActivity(room, null, joinEvent);

    broadcast(room, socket, {
        type: 'peer-joined',
        clientId,
    });

    const handlePayload = payload => {

        if (!payload) {
            logWs('close frame', {
                roomId,
                clientId,
            });
            socket.end();
            return;
        }

        let message;
        try {
            message = JSON.parse(payload);
        } catch (error) {
            logWs('payload parse error', {
                roomId,
                clientId,
                bytes: payload.length,
                error: error.message,
            });
            return;
        }

        if (message.type !== 'cursor' || DEBUG_WS_CURSOR) {
            logWs('message received', {
                roomId,
                clientId,
                type: message.type,
                bytes: payload.length,
                objects: message.objects?.length,
                bitmapObjects: message.objects?.filter(object => object.type === 'bitmap').length,
            });
        }

        if ((message.type === 'board-state' || message.type === 'board-operation') && hitOperationRateLimit(socket)) {
            sendError(socket, 'rate-limited', 'Too many board updates. Please slow down.');
            return;
        }

        if (message.type === 'board-state') {
            const oversizedBitmapIds = getOversizedBitmapIds(message.objects || []);

            if (oversizedBitmapIds.length) {
                sendError(socket, 'bitmap-too-large', 'Bitmap fill is too large to sync.');
                return;
            }

            const nextBoardState = message.mode === 'replace'
                ? message.objects || []
                : mergeBoardState(room.boardState, message.objects || []);
            const touchedObjectIds = message.mode === 'replace'
                ? getBoardStateObjectIds(room.boardState, nextBoardState)
                : (message.objects || []).map(object => object.id);
            const conflicts = getLockConflicts(room, clientId, touchedObjectIds);

            if (conflicts.length) {
                send(socket, {
                    type: 'board-reject',
                    reason: 'locked-object',
                    objectIds: conflicts,
                    boardState: room.boardState,
                    revision: room.revision,
                });
                return;
            }

            room.boardState = nextBoardState;
            room.revision += 1;
            room.lastTouchedAt = Date.now();
            addRoomOperation(room, clientId, message, room.boardState);
            logWs('room state saved', {
                roomId,
                revision: room.revision,
                mode: message.mode || 'merge',
                objects: room.boardState.length,
                bitmapObjects: room.boardState.filter(object => object.type === 'bitmap').length,
                clients: room.clients.size,
            });
            persistRoom(roomId, room);
            send(socket, {
                type: 'board-ack',
                revision: room.revision,
                clientRevision: message.revision,
            });
        }

        if (message.type === 'board-operation') {
            const oversizedBitmapIds = getOversizedBitmapIds(message.operation?.upsert || []);

            if (oversizedBitmapIds.length) {
                sendError(socket, 'bitmap-too-large', 'Bitmap fill is too large to sync.');
                return;
            }

            const nextBoardState = applyBoardOperation(room.boardState, message.operation);
            const conflicts = getLockConflicts(room, clientId, getOperationObjectIds(message.operation, room.boardState, nextBoardState));

            if (conflicts.length) {
                send(socket, {
                    type: 'board-reject',
                    reason: 'locked-object',
                    objectIds: conflicts,
                    boardState: room.boardState,
                    revision: room.revision,
                });
                return;
            }

            room.boardState = nextBoardState;
            room.revision += 1;
            room.lastTouchedAt = Date.now();
            addRoomOperation(room, clientId, message, room.boardState);
            logWs('room operation applied', {
                roomId,
                revision: room.revision,
                upsert: message.operation?.upsert?.length || 0,
                deleteIds: message.operation?.deleteIds?.length || 0,
                objects: room.boardState.length,
                clients: room.clients.size,
            });
            persistRoom(roomId, room);
            send(socket, {
                type: 'board-ack',
                revision: room.revision,
                clientRevision: message.revision,
            });
        }

        if (message.type === 'activity' && message.event) {
            addRoomActivity(room, message.event);
        }

        if (message.type === 'object-lock') {
            const deniedIds = updateObjectLocks(room, socket, message.objectIds || []);
            const lockState = {
                type: 'object-lock-state',
                deniedIds,
                locks: serializeObjectLocks(room),
                revision: room.revision,
            };
            send(socket, lockState);
            broadcast(room, socket, lockState);
            return;
        }

        broadcast(room, socket, {
            ...message,
            clientId,
            objects: message.type === 'board-state' ? room.boardState : message.objects,
            operation: message.type === 'board-operation' ? message.operation : message.operation,
            operationLogLength: message.type === 'init' ? room.operationLog.length : undefined,
            revision: room.revision,
        });
    };

    socket.on('data', buffer => {
        socket.frameBuffer = Buffer.concat([socket.frameBuffer, buffer]);
        if (socket.frameBuffer.length > MAX_MESSAGE_BYTES) {
            logWs('message rejected by size', {
                roomId,
                clientId,
                bufferedBytes: socket.frameBuffer.length,
            });
            sendError(socket, 'message-too-large', 'Message is too large to sync.');
            socket.frameBuffer = Buffer.alloc(0);
            return;
        }

        if (buffer.length > 1024) {
            logWs('data chunk', {
                roomId,
                clientId,
                chunkBytes: buffer.length,
                bufferedBytes: socket.frameBuffer.length,
            });
        }

        while (socket.frameBuffer.length) {
            const frame = decodeFrame(socket.frameBuffer);

            if (!frame) {
                break;
            }

            socket.frameBuffer = socket.frameBuffer.slice(frame.consumed);

            if (frame.opcode === 8) {
                handlePayload(null);
                continue;
            }

            if (frame.opcode === 9) {
                continue;
            }

            if (frame.opcode === 1 && frame.fin) {
                handlePayload(frame.payload.toString('utf8'));
                continue;
            }

            if (frame.opcode === 1) {
                socket.messageFragments = [frame.payload];
                logWs('fragmented message started', {
                    roomId,
                    clientId,
                    bytes: frame.payload.length,
                });
                continue;
            }

            if (frame.opcode === 0 && socket.messageFragments.length) {
                socket.messageFragments.push(frame.payload);

                if (frame.fin) {
                    const payload = Buffer.concat(socket.messageFragments);
                    socket.messageFragments = [];
                    logWs('fragmented message completed', {
                        roomId,
                        clientId,
                        bytes: payload.length,
                    });
                    handlePayload(payload.toString('utf8'));
                }
            }
        }
    });

    socket.on('error', () => {
        logWs('socket error', {
            roomId,
            clientId,
        });
        room.clients.delete(socket);
        releaseClientObjectLocks(room, clientId);
    });

    socket.on('close', () => {
        room.clients.delete(socket);
        releaseClientObjectLocks(room, clientId);
        logWs('client disconnected', {
            roomId,
            clientId,
            clients: room.clients.size,
            storedObjects: room.boardState.length,
        });
        broadcast(room, socket, {
            type: 'peer-left',
            clientId,
        });
        broadcast(room, socket, {
            type: 'object-lock-state',
            locks: serializeObjectLocks(room),
            revision: room.revision,
        });

        const leaveEvent = createActivity('user-left', socket.user);
        broadcastActivity(room, socket, leaveEvent);

        if (!room.clients.size && !room.boardState.length) {
            rooms.delete(roomId);
        }
    });
});

setInterval(cleanupRooms, 60 * 1000).unref();

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`Whiteboard running at http://${HOST}:${PORT}`);
    });
}

module.exports = {
    applyBoardOperation,
    getOversizedBitmapIds,
    getLockConflicts,
    getOperationObjectIds,
    mergeBoardState,
    server,
    updateObjectLocks,
};
