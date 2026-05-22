const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const rooms = new Map();
const mimeTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
};

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
        rooms.set(roomId, {
            boardState: [],
            clients: new Set(),
        });
    }

    return rooms.get(roomId);
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
    const opcode = buffer[0] & 15;

    if (opcode === 8) {
        return null;
    }

    let length = buffer[1] & 127;
    let offset = 2;

    if (length === 126) {
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
    }

    const mask = buffer.slice(offset, offset + 4);
    offset += 4;

    const payload = buffer.slice(offset, offset + length);
    for (let index = 0; index < payload.length; index++) {
        payload[index] ^= mask[index % 4];
    }

    return payload.toString('utf8');
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
    room.clients.add(socket);

    send(socket, {
        type: 'init',
        clientId,
        boardState: room.boardState,
        peers: [...room.clients].filter(client => client !== socket).map(client => client.clientId),
    });

    broadcast(room, socket, {
        type: 'peer-joined',
        clientId,
    });

    socket.on('data', buffer => {
        const payload = decodeFrame(buffer);

        if (!payload) {
            socket.end();
            return;
        }

        let message;
        try {
            message = JSON.parse(payload);
        } catch {
            return;
        }

        if (message.type === 'board-state') {
            room.boardState = message.objects || [];
        }

        broadcast(room, socket, {
            ...message,
            clientId,
        });
    });

    socket.on('error', () => {
        room.clients.delete(socket);
    });

    socket.on('close', () => {
        room.clients.delete(socket);
        broadcast(room, socket, {
            type: 'peer-left',
            clientId,
        });

        if (!room.clients.size && !room.boardState.length) {
            rooms.delete(roomId);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Whiteboard running at http://${HOST}:${PORT}`);
});
