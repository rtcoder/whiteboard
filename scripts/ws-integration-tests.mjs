import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {server} = require('../server.js');

function randomRoomId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
}

async function listen() {
    if (server.listening) {
        return server.address();
    }

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address();
}

function requestJson(address, method, pathname, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : '';
        const request = http.request({
            hostname: address.address,
            port: address.port,
            method,
            path: pathname,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        }, response => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                data += chunk;
            });
            response.on('end', () => {
                resolve({
                    status: response.statusCode,
                    body: data ? JSON.parse(data) : null,
                });
            });
        });
        request.on('error', reject);
        if (payload) {
            request.write(payload);
        }
        request.end();
    });
}

function encodeClientFrame(message) {
    const payload = Buffer.from(JSON.stringify(message));
    const mask = crypto.randomBytes(4);
    const header = [0x81];

    if (payload.length < 126) {
        header.push(0x80 | payload.length);
    } else if (payload.length < 65536) {
        header.push(0x80 | 126, payload.length >> 8, payload.length & 255);
    } else {
        throw new Error('Test payload too large');
    }

    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) {
        masked[index] ^= mask[index % 4];
    }

    return Buffer.concat([Buffer.from(header), mask, masked]);
}

function decodeServerFrame(buffer) {
    if (buffer.length < 2) {
        return null;
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

    if (buffer.length < offset + length) {
        return null;
    }

    return {
        consumed: offset + length,
        payload: buffer.slice(offset, offset + length).toString('utf8'),
    };
}

function connectWebSocket(address, {roomId, clientId, name = 'Test User', token = ''}) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(address.port, address.address);
        const key = crypto.randomBytes(16).toString('base64');
        let handshake = Buffer.alloc(0);
        let frameBuffer = Buffer.alloc(0);
        let opened = false;
        const pending = [];
        const waiters = [];

        const fail = error => {
            socket.destroy();
            reject(error);
        };

        const client = {
            clientId,
            close: () => socket.destroy(),
            send: message => socket.write(encodeClientFrame(message)),
            waitFor: async (type, timeoutMs = 1500) => {
                const existingIndex = pending.findIndex(message => message.type === type);
                if (existingIndex >= 0) {
                    const [message] = pending.splice(existingIndex, 1);
                    return message;
                }

                return new Promise((resolveWaiter, rejectWaiter) => {
                    const timer = setTimeout(() => {
                        const waiterIndex = waiters.findIndex(waiter => waiter.resolve === resolveWaiter);
                        if (waiterIndex >= 0) {
                            waiters.splice(waiterIndex, 1);
                        }
                        rejectWaiter(new Error(`Timed out waiting for ${type}`));
                    }, timeoutMs);
                    waiters.push({
                        type,
                        resolve: message => {
                            clearTimeout(timer);
                            resolveWaiter(message);
                        },
                    });
                });
            },
        };

        const handleMessage = message => {
            const waiterIndex = waiters.findIndex(waiter => waiter.type === message.type);
            if (waiterIndex >= 0) {
                const [waiter] = waiters.splice(waiterIndex, 1);
                waiter.resolve(message);
                return;
            }
            pending.push(message);
        };

        socket.on('connect', () => {
            const query = new URLSearchParams({
                room: roomId,
                client: clientId,
                name,
                color: '#2563eb',
                initials: name.slice(0, 2).toUpperCase(),
                token,
            });
            socket.write([
                `GET /ws?${query.toString()} HTTP/1.1`,
                `Host: ${address.address}:${address.port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '',
                '',
            ].join('\r\n'));
        });

        socket.on('data', chunk => {
            if (!opened) {
                handshake = Buffer.concat([handshake, chunk]);
                const delimiter = handshake.indexOf('\r\n\r\n');

                if (delimiter === -1) {
                    return;
                }

                const header = handshake.slice(0, delimiter).toString('utf8');
                const rest = handshake.slice(delimiter + 4);

                if (!header.startsWith('HTTP/1.1 101')) {
                    socket.destroy();
                    fail(new Error(header.split('\r\n')[0]));
                    return;
                }

                opened = true;
                frameBuffer = Buffer.concat([frameBuffer, rest]);
                resolve(client);
            } else {
                frameBuffer = Buffer.concat([frameBuffer, chunk]);
            }

            while (frameBuffer.length) {
                const frame = decodeServerFrame(frameBuffer);
                if (!frame) {
                    break;
                }
                frameBuffer = frameBuffer.slice(frame.consumed);
                handleMessage(JSON.parse(frame.payload));
            }
        });

        socket.on('error', error => {
            if (!opened) {
                reject(error);
            }
        });
    });
}

async function assertWebSocketRejected(address, options) {
    await assert.rejects(
        () => connectWebSocket(address, options),
        /403 Forbidden/,
    );
}

async function createRoom(address, {roomId, accessMode = 'open', hostId = 'host'}) {
    const response = await requestJson(address, 'POST', '/api/rooms', {
        roomId,
        name: `Room ${roomId}`,
        accessMode,
        host: {
            id: hostId,
            name: 'Host',
            color: '#2563eb',
            initials: 'HO',
        },
    });

    assert.equal(response.status, 201);
    return response.body;
}

async function run() {
    const address = await listen();

    const openRoomId = randomRoomId('open');
    await createRoom(address, {roomId: openRoomId});
    const openOne = await connectWebSocket(address, {roomId: openRoomId, clientId: 'open-one', name: 'Open One'});
    const openTwo = await connectWebSocket(address, {roomId: openRoomId, clientId: 'open-two', name: 'Open Two'});
    assert.equal((await openOne.waitFor('init')).type, 'init');
    assert.equal((await openTwo.waitFor('init')).type, 'init');

    openOne.send({
        type: 'board-operation',
        revision: 0,
        operation: {
            kind: 'object-created',
            upsert: [{id: 'shape-a', type: 'rectangle', x: 0, y: 0, x2: 10, y2: 10}],
            deleteIds: [],
            orderIds: ['shape-a'],
        },
    });
    await openOne.waitFor('board-ack');
    assert.equal((await openTwo.waitFor('board-operation')).operation.upsert[0].id, 'shape-a');

    openTwo.send({
        type: 'board-operation',
        revision: 1,
        operation: {
            kind: 'object-created',
            upsert: [{id: 'shape-b', type: 'ellipse', x: 20, y: 20, x2: 40, y2: 40}],
            deleteIds: [],
            orderIds: ['shape-a', 'shape-b'],
        },
    });
    await openTwo.waitFor('board-ack');
    assert.equal((await openOne.waitFor('board-operation')).operation.upsert[0].id, 'shape-b');

    openOne.send({type: 'object-lock', objectIds: ['shape-a']});
    assert.deepEqual((await openOne.waitFor('object-lock-state')).deniedIds, []);
    await openTwo.waitFor('object-lock-state');
    openTwo.send({
        type: 'board-operation',
        revision: 2,
        operation: {
            kind: 'object-updated',
            upsert: [{id: 'shape-a', type: 'rectangle', x: 5, y: 5, x2: 15, y2: 15}],
            deleteIds: [],
        },
    });
    assert.equal((await openTwo.waitFor('board-reject')).reason, 'locked-object');

    openOne.close();
    openTwo.close();

    const closedRoomId = randomRoomId('closed');
    const closedRoom = await createRoom(address, {
        roomId: closedRoomId,
        accessMode: 'closed',
        hostId: 'closed-host',
    });
    assert.ok(closedRoom.accessToken);
    await assertWebSocketRejected(address, {
        roomId: closedRoomId,
        clientId: 'closed-guest',
        name: 'Guest',
    });

    const host = await connectWebSocket(address, {
        roomId: closedRoomId,
        clientId: 'closed-host',
        name: 'Host',
        token: closedRoom.accessToken,
    });
    await host.waitFor('init');

    const requestResponse = await requestJson(address, 'POST', `/api/rooms/${closedRoomId}/join-requests`, {
        clientId: 'closed-guest',
        user: {
            id: 'closed-guest',
            name: 'Guest',
            color: '#16a34a',
            initials: 'GU',
        },
    });
    assert.equal(requestResponse.status, 202);
    const joinRequest = await host.waitFor('join-request');
    assert.equal(joinRequest.request.clientId, 'closed-guest');

    const acceptResponse = await requestJson(address, 'POST', `/api/rooms/${closedRoomId}/join-requests/${joinRequest.request.id}`, {
        action: 'accept',
        hostId: 'closed-host',
    });
    assert.equal(acceptResponse.status, 200);
    assert.equal(acceptResponse.body.status, 'accepted');
    assert.ok(acceptResponse.body.accessToken);

    const guest = await connectWebSocket(address, {
        roomId: closedRoomId,
        clientId: 'closed-guest',
        name: 'Guest',
        token: acceptResponse.body.accessToken,
    });
    assert.equal((await guest.waitFor('init')).type, 'init');
    guest.close();

    const denyResponse = await requestJson(address, 'POST', `/api/rooms/${closedRoomId}/join-requests`, {
        clientId: 'denied-guest',
        user: {
            id: 'denied-guest',
            name: 'Denied',
            color: '#dc2626',
            initials: 'DE',
        },
    });
    assert.equal(denyResponse.status, 202);
    const denyRequest = await host.waitFor('join-request');
    const rejected = await requestJson(address, 'POST', `/api/rooms/${closedRoomId}/join-requests/${denyRequest.request.id}`, {
        action: 'reject',
        hostId: 'closed-host',
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'rejected');
    assert.equal(rejected.body.accessToken, undefined);
    await assertWebSocketRejected(address, {
        roomId: closedRoomId,
        clientId: 'denied-guest',
        name: 'Denied',
    });
    host.close();

    await new Promise(resolve => server.close(resolve));
    console.log('WebSocket integration tests passed');
}

run().catch(async error => {
    if (server.listening) {
        await new Promise(resolve => server.close(resolve));
    }
    throw error;
});
