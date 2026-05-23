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

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathname = decodeURIComponent(parsedUrl.pathname);

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
            boardState: storedRoom.boardState || [],
            clients: new Set(),
            revision: storedRoom.revision || 0,
            activityLog: storedRoom.activityLog || [],
        });
    }

    return rooms.get(roomId);
}

function getRoomFile(roomId) {
    return path.join(DATA_DIR, `${roomId.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

function loadRoom(roomId) {
    try {
        return JSON.parse(fs.readFileSync(getRoomFile(roomId), 'utf8'));
    } catch {
        return {};
    }
}

function persistRoom(roomId, room) {
    const payload = JSON.stringify({
        boardState: room.boardState,
        revision: room.revision,
        activityLog: room.activityLog,
    });
    fs.writeFile(getRoomFile(roomId), payload, () => {});
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

function mergeBoardState(currentObjects, incomingObjects) {
    const objectsById = new Map(currentObjects.map(object => [object.id, object]));

    for (const object of incomingObjects) {
        objectsById.set(object.id, object);
    }

    return [...objectsById.values()];
}

server.on('upgrade', (req, socket) => {
    const parsedUrl = url.parse(req.url, true);
    const roomId = parsedUrl.query.room;
    const clientId = parsedUrl.query.client || crypto.randomUUID();

    if (parsedUrl.pathname !== '/ws' || !roomId) {
        socket.destroy();
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

    const room = getRoom(roomId);
    socket.clientId = clientId;
    socket.roomId = roomId;
    socket.user = {
        id: clientId,
        name: parsedUrl.query.name || 'Guest',
        color: parsedUrl.query.color || '#2563eb',
        initials: parsedUrl.query.initials || 'G',
    };
    socket.frameBuffer = Buffer.alloc(0);
    socket.messageFragments = [];
    room.clients.add(socket);
    logWs('client connected', {
        roomId,
        clientId,
        clients: room.clients.size,
        storedObjects: room.boardState.length,
    });

    send(socket, {
        type: 'init',
        clientId,
        boardState: room.boardState,
        activityLog: room.activityLog,
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

        if (message.type === 'board-state') {
            room.boardState = message.mode === 'replace'
                ? message.objects || []
                : mergeBoardState(room.boardState, message.objects || []);
            room.revision += 1;
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
            });
        }

        if (message.type === 'activity' && message.event) {
            addRoomActivity(room, message.event);
        }

        broadcast(room, socket, {
            ...message,
            clientId,
            objects: message.type === 'board-state' ? room.boardState : message.objects,
            revision: room.revision,
        });
    };

    socket.on('data', buffer => {
        socket.frameBuffer = Buffer.concat([socket.frameBuffer, buffer]);
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
    });

    socket.on('close', () => {
        room.clients.delete(socket);
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

        const leaveEvent = createActivity('user-left', socket.user);
        broadcastActivity(room, socket, leaveEvent);

        if (!room.clients.size && !room.boardState.length) {
            rooms.delete(roomId);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Whiteboard running at http://${HOST}:${PORT}`);
});
