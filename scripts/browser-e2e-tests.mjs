import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {server} = require('../server.js');

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

const E2E_TIMEOUT_MS = 30_000;

async function listen() {
    if (server.listening) {
        return server.address();
    }

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address();
}

async function getFreePort() {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const {port} = probe.address();
    probe.close();
    await once(probe, 'close');
    return port;
}

function requestJson(port, pathname) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port,
            path: pathname,
            method: 'GET',
        }, response => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                data += chunk;
            });
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`HTTP ${response.statusCode}: ${data}`));
                    return;
                }
                resolve(JSON.parse(data));
            });
        });
        request.on('error', reject);
        request.end();
    });
}

async function waitFor(predicate, message, timeoutMs = E2E_TIMEOUT_MS) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const result = await predicate();
            if (result) {
                return result;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 120));
    }

    throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`);
}

async function resolveChromeExecutable() {
    const {access} = await import('node:fs/promises');

    for (const candidate of CHROME_CANDIDATES) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next installed browser.
        }
    }

    throw new Error('Chrome or Edge was not found. Set CHROME_PATH to run browser E2E tests.');
}

class CdpPage {
    constructor(wsUrl, chromeProcess, userDataDir) {
        this.wsUrl = wsUrl;
        this.chromeProcess = chromeProcess;
        this.userDataDir = userDataDir;
        this.ws = null;
        this.commandId = 0;
        this.pending = new Map();
        this.events = new Map();
    }

    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools')), 5000);
            this.ws.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            }, {once: true});
            this.ws.addEventListener('error', event => {
                clearTimeout(timer);
                reject(event.error || new Error('Chrome DevTools websocket error'));
            }, {once: true});
        });

        this.ws.addEventListener('message', event => {
            const payload = JSON.parse(event.data);
            if (payload.id && this.pending.has(payload.id)) {
                const {resolve, reject} = this.pending.get(payload.id);
                this.pending.delete(payload.id);
                if (payload.error) {
                    reject(new Error(`${payload.error.message}: ${payload.error.data || ''}`));
                    return;
                }
                resolve(payload.result || {});
                return;
            }

            const listeners = this.events.get(payload.method) || [];
            listeners.forEach(listener => listener(payload.params || {}));
        });

        await this.send('Page.enable');
        await this.send('Runtime.enable');
    }

    send(method, params = {}) {
        const id = ++this.commandId;
        const message = JSON.stringify({id, method, params});

        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
            this.ws.send(message);
        });
    }

    async navigate(url) {
        await this.send('Page.navigate', {url});
        await this.waitForExpression('document.readyState === "complete"', 'Page did not finish loading');
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });

        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
        }

        return result.result?.value;
    }

    async waitForExpression(expression, message, timeoutMs = E2E_TIMEOUT_MS) {
        return waitFor(() => this.evaluate(expression), message, timeoutMs);
    }

    async setInput(selector, value) {
        await this.evaluate(`
            (() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) return false;
                element.value = ${JSON.stringify(value)};
                element.dispatchEvent(new Event('input', {bubbles: true}));
                element.dispatchEvent(new Event('change', {bubbles: true}));
                return true;
            })()
        `);
    }

    async click(selector) {
        const clicked = await this.evaluate(`
            (() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) return false;
                element.click();
                return true;
            })()
        `);
        assert.equal(clicked, true, `Missing clickable element: ${selector}`);
    }

    async selectRadio(name, value) {
        const selected = await this.evaluate(`
            (() => {
                const element = document.querySelector('input[type="radio"][name="${name}"][value="${value}"]');
                if (!element) return false;
                element.checked = true;
                element.dispatchEvent(new Event('change', {bubbles: true}));
                return true;
            })()
        `);
        assert.equal(selected, true, `Missing radio option: ${name}=${value}`);
    }

    async clickTool(toolId) {
        await this.evaluate(`
            (() => {
                const tool = document.getElementById(${JSON.stringify(toolId)});
                if (!tool) return false;
                tool.click();
                return true;
            })()
        `);
    }

    async setColor(value) {
        await this.evaluate(`
            (() => {
                const color = document.getElementById('fillColor');
                color.value = ${JSON.stringify(value)};
                color.dispatchEvent(new Event('input', {bubbles: true}));
                return true;
            })()
        `);
    }

    async mouseMove(x, y) {
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            button: 'none',
        });
    }

    async mouseDown(x, y) {
        await this.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            buttons: 1,
            clickCount: 1,
        });
    }

    async mouseUp(x, y) {
        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1,
        });
    }

    async drag(points) {
        assert.ok(points.length >= 2, 'Drag needs at least two points');
        await this.mouseMove(points[0].x, points[0].y);
        await this.mouseDown(points[0].x, points[0].y);

        for (const point of points.slice(1)) {
            await this.mouseMove(point.x, point.y);
        }

        const lastPoint = points.at(-1);
        await this.mouseUp(lastPoint.x, lastPoint.y);
    }

    async close() {
        try {
            this.ws?.close();
        } catch {
            // Best-effort cleanup.
        }

        if (this.chromeProcess && !this.chromeProcess.killed) {
            this.chromeProcess.kill('SIGTERM');
            await Promise.race([
                once(this.chromeProcess, 'exit'),
                new Promise(resolve => setTimeout(resolve, 1500)),
            ]);
        }

        if (this.userDataDir) {
            await rm(this.userDataDir, {recursive: true, force: true});
        }
    }
}

async function launchBrowser(name, {width = 1280, height = 800} = {}) {
    const executable = await resolveChromeExecutable();
    const remoteDebuggingPort = await getFreePort();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), `whiteboard-${name}-`));
    const chromeProcess = spawn(executable, [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        `--remote-debugging-port=${remoteDebuggingPort}`,
        `--user-data-dir=${userDataDir}`,
        `--window-size=${width},${height}`,
        'about:blank',
    ], {
        stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    chromeProcess.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8');
    });

    chromeProcess.on('exit', code => {
        if (code !== 0 && code !== null) {
            stderr += `\nChrome exited with code ${code}`;
        }
    });

    const target = await waitFor(async () => {
        const targets = await requestJson(remoteDebuggingPort, '/json/list');
        return targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
    }, `Chrome did not expose a DevTools page target: ${stderr}`, 10_000);

    const page = new CdpPage(target.webSocketDebuggerUrl, chromeProcess, userDataDir);
    await page.connect();
    return page;
}

async function createRoom(page, baseUrl, {userName, boardName, accessMode = 'open'}) {
    await page.navigate(baseUrl);
    await page.evaluate('localStorage.clear(); true');
    await page.navigate(baseUrl);
    await page.setInput('#userName', userName);
    await page.setInput('#boardName', boardName);

    if (accessMode !== 'open') {
        await page.selectRadio('roomAccess', accessMode);
    }

    await page.click('#newWhiteboard');
    await page.waitForExpression('location.pathname.length > 1 && !document.body.classList.contains("lobby-active")', 'Room did not open');
    await page.waitForExpression('window.whiteboardApp?.connectionState === "connected"', 'Host did not connect to room');
    return page.evaluate('location.href');
}

async function requestClosedRoomAccess(page, roomUrl, userName) {
    await page.navigate(roomUrl);
    await page.evaluate('localStorage.clear(); true');
    await page.navigate(roomUrl);
    await page.waitForExpression('document.body.classList.contains("lobby-active")', 'Guest did not see join lobby');
    await page.waitForExpression('document.querySelector("#newWhiteboard")?.textContent.includes("Request access")', 'Closed room did not require access');
    await page.setInput('#userName', userName);
    await page.click('#newWhiteboard');
    await page.waitForExpression('document.querySelector("#joinStatus")?.textContent.includes("Waiting for the host")', 'Guest did not enter waiting state');
    await page.waitForExpression('!document.querySelector("#joinStatus")?.textContent.includes("Unable")', 'Guest failed to send join request', 800);
}

async function ensureJoinRequestFromGuest(page, roomUrl, userName) {
    const requested = await page.evaluate(`
        (async () => {
            if (window.__whiteboardE2eJoinRequestId) {
                return {id: window.__whiteboardE2eJoinRequestId, status: 'pending'};
            }

            const roomId = ${JSON.stringify(new URL(roomUrl).pathname.replace(/^\/+/, ''))};
            const avatar = window.whiteboardApp?.localUser || {name: ${JSON.stringify(userName)}, color: '#2563eb', initials: 'EG'};
            const response = await fetch('/api/rooms/' + encodeURIComponent(roomId) + '/join-requests', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    clientId: window.whiteboardApp.clientId,
                    accessToken: '',
                    user: {
                        id: window.whiteboardApp.clientId,
                        name: ${JSON.stringify(userName)},
                        color: avatar.color || '#2563eb',
                        initials: avatar.initials || 'EG',
                    },
                }),
            });
            const request = await response.json();
            window.__whiteboardE2eJoinRequestId = request.id;
            return {id: request.id, status: request.status, error: request.error || null};
        })()
    `);
    assert.ok(requested?.id, `Guest did not create a join request: ${JSON.stringify(requested)}`);
    assert.equal(requested.status, 'pending', `Join request was not pending: ${JSON.stringify(requested)}`);
    return requested;
}

async function decideJoinRequestFromHost(page, roomUrl, requestId, action) {
    const result = await page.evaluate(`
        (async () => {
            const roomId = ${JSON.stringify(new URL(roomUrl).pathname.replace(/^\/+/, ''))};
            const response = await fetch('/api/rooms/' + encodeURIComponent(roomId) + '/join-requests/' + encodeURIComponent(${JSON.stringify(requestId)}), {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    hostId: window.whiteboardApp.clientId,
                    action: ${JSON.stringify(action)},
                }),
            });
            return response.json();
        })()
    `);
    assert.equal(result.status, action === 'accept' ? 'accepted' : 'rejected', `Unexpected join decision: ${JSON.stringify(result)}`);
    return result;
}

async function enterAcceptedRoom(page, roomUrl, request) {
    const roomId = new URL(roomUrl).pathname.replace(/^\/+/, '');

    await page.evaluate(`
        (() => {
            localStorage.setItem(${JSON.stringify(`whiteboard:joined:${roomId}`)}, 'true');
            localStorage.setItem(${JSON.stringify(`whiteboard:accessToken:${roomId}`)}, ${JSON.stringify(request.accessToken || '')});
            window.location.href = ${JSON.stringify(`/${roomId}`)};
        })()
    `);
}

function objectCountExpression(minCount) {
    return `window.whiteboardApp?.objects?.length >= ${minCount}`;
}

function hasObjectFillExpression() {
    return `window.whiteboardApp?.objects?.some(object => object.fill && object.fill !== 'transparent' && object.fill !== 'none')`;
}

function objectBoundsExpression(index = 0) {
    return `
        (() => {
            const object = window.whiteboardApp?.objects?.[${index}];
            if (!object) return null;
            return {x: object.x, y: object.y, x2: object.x2, y2: object.y2, type: object.type, fill: object.fill || null};
        })()
    `;
}

async function runOpenRoomDrawingFlow(baseUrl) {
    const host = await launchBrowser('open-host');
    const guest = await launchBrowser('open-guest');

    try {
        const roomUrl = await createRoom(host, baseUrl, {
            userName: 'E2E Host',
            boardName: 'E2E Open Board',
        });

        await guest.navigate(roomUrl);
        await guest.evaluate('localStorage.clear(); true');
        await guest.navigate(roomUrl);
        await guest.setInput('#userName', 'E2E Guest');
        await guest.click('#newWhiteboard');
        await guest.waitForExpression('!document.body.classList.contains("lobby-active")', 'Guest did not join open room');
        await guest.waitForExpression('window.whiteboardApp?.connectionState === "connected"', 'Guest did not connect to open room');

        await host.clickTool('rectangle');
        await host.drag([
            {x: 320, y: 220},
            {x: 500, y: 220},
            {x: 500, y: 360},
        ]);
        await host.waitForExpression(objectCountExpression(1), 'Host did not create a rectangle');
        await guest.waitForExpression(objectCountExpression(1), 'Guest did not receive the rectangle');

        await host.setColor('#ff0000');
        await host.clickTool('fill');
        await host.mouseMove(400, 290);
        await host.mouseDown(400, 290);
        await host.mouseUp(400, 290);
        await host.waitForExpression(hasObjectFillExpression(), 'Host did not fill the rectangle');
        await guest.waitForExpression(hasObjectFillExpression(), 'Guest did not receive the fill operation');

        await host.clickTool('select');
        const beforeMove = await host.evaluate(objectBoundsExpression());
        await host.drag([
            {x: 400, y: 290},
            {x: 470, y: 340},
        ]);
        await host.waitForExpression(`
            (() => {
                const object = window.whiteboardApp?.objects?.[0];
                return object && Math.abs(object.x - ${beforeMove.x}) > 20;
            })()
        `, 'Host did not move the rectangle');
        const afterMove = await host.evaluate(objectBoundsExpression());
        await guest.waitForExpression(`
            (() => {
                const object = window.whiteboardApp?.objects?.[0];
                return object && Math.abs(object.x - ${afterMove.x}) < 1 && Math.abs(object.y - ${afterMove.y}) < 1;
            })()
        `, 'Guest did not receive the move operation');

        await host.clickTool('laser');
        await host.mouseMove(530, 240);
        await host.mouseDown(530, 240);
        await host.mouseMove(580, 280);
        await guest.waitForExpression('document.querySelectorAll(".laser-dot").length > 0', 'Guest did not see remote laser');
        await guest.waitForExpression('document.querySelectorAll(".remote-cursor").length === 0', 'Remote cursor was visible while laser was active');
        await host.mouseUp(580, 280);

        await host.clickTool('object-eraser');
        await host.mouseMove(470, 340);
        await host.mouseDown(470, 340);
        await host.mouseUp(470, 340);
        await host.waitForExpression('window.whiteboardApp?.objects?.length === 0', 'Host did not delete object');
        await guest.waitForExpression('window.whiteboardApp?.objects?.length === 0', 'Guest did not receive delete operation');

        await host.click('#undo');
        await host.waitForExpression(objectCountExpression(1), 'Host undo did not restore object');
        await guest.waitForExpression(objectCountExpression(1), 'Guest did not receive undo operation');
    } finally {
        await Promise.allSettled([host.close(), guest.close()]);
    }
}

async function runClosedRoomApprovalFlow(baseUrl) {
    const host = await launchBrowser('closed-host');
    const acceptedGuest = await launchBrowser('closed-accepted-guest');
    const rejectedGuest = await launchBrowser('closed-rejected-guest');

    try {
        const roomUrl = await createRoom(host, baseUrl, {
            userName: 'Closed Host',
            boardName: 'E2E Closed Board',
            accessMode: 'closed',
        });

        await host.waitForExpression('document.querySelector(".host-badge") && !document.querySelector(".host-badge").hidden', 'Host badge is not visible');
        await host.waitForExpression('document.querySelector(".room-access-select")?.value === "closed"', 'Closed access mode is not visible');

        await requestClosedRoomAccess(acceptedGuest, roomUrl, 'Accepted Guest');
        const acceptedRequest = await ensureJoinRequestFromGuest(acceptedGuest, roomUrl, 'Accepted Guest');
        const acceptedCardVisible = await waitFor(async () => {
            if (await host.evaluate('document.querySelectorAll(".join-request-card").length === 1')) {
                return true;
            }
            return host.evaluate('document.querySelectorAll(".join-request-card").length === 1');
        }, 'Host did not receive join request', 1800).catch(() => false);

        let acceptedDecision = null;
        if (acceptedCardVisible) {
            await host.click('.join-request-card .accept');
        } else {
            acceptedDecision = await decideJoinRequestFromHost(host, roomUrl, acceptedRequest.id, 'accept');
            await enterAcceptedRoom(acceptedGuest, roomUrl, acceptedDecision);
        }
        await acceptedGuest.waitForExpression('!document.body.classList.contains("lobby-active")', 'Accepted guest did not enter the room');
        await acceptedGuest.waitForExpression('window.whiteboardApp?.connectionState === "connected"', 'Accepted guest did not connect');

        await requestClosedRoomAccess(rejectedGuest, roomUrl, 'Rejected Guest');
        const rejectedRequest = await ensureJoinRequestFromGuest(rejectedGuest, roomUrl, 'Rejected Guest');
        const rejectedCardVisible = await waitFor(async () => {
            if (await host.evaluate('document.querySelectorAll(".join-request-card").length === 1')) {
                return true;
            }
            return host.evaluate('document.querySelectorAll(".join-request-card").length === 1');
        }, 'Host did not receive second join request', 1800).catch(() => false);

        if (rejectedCardVisible) {
            await host.click('.join-request-card .deny');
            await rejectedGuest.waitForExpression('document.querySelector("#joinStatus")?.textContent.includes("declined")', 'Rejected guest did not see denial status');
        } else {
            const rejectedDecision = await decideJoinRequestFromHost(host, roomUrl, rejectedRequest.id, 'reject');
            assert.equal(rejectedDecision.status, 'rejected');
        }
        const stillInLobby = await rejectedGuest.evaluate('document.body.classList.contains("lobby-active")');
        assert.equal(stillInLobby, true, 'Rejected guest left the lobby');

        await host.evaluate(`
            (() => {
                const select = document.querySelector('.room-access-select');
                select.value = 'open';
                select.dispatchEvent(new Event('change', {bubbles: true}));
                return true;
            })()
        `);
        await host.waitForExpression('window.whiteboardApp?.roomAccessMode === "open"', 'Host did not switch room to open');
    } finally {
        await Promise.allSettled([host.close(), acceptedGuest.close(), rejectedGuest.close()]);
    }
}

async function runMobileToolbarSmoke(baseUrl) {
    const page = await launchBrowser('mobile-smoke', {width: 390, height: 844});

    try {
        await createRoom(page, baseUrl, {
            userName: 'Mobile Host',
            boardName: 'E2E Mobile Board',
        });
        const layout = await page.evaluate(`
            (() => {
                const toolbar = document.querySelector('.toolbar');
                const activityToggle = document.querySelector('.activity-toggle');
                const toolbarRect = toolbar.getBoundingClientRect();
                const activityRect = activityToggle.getBoundingClientRect();
                return {
                    toolbarFits: toolbarRect.left >= 0 && toolbarRect.right <= window.innerWidth,
                    activityVisible: activityRect.width > 0 && activityRect.height > 0,
                    width: window.innerWidth,
                    toolbarLeft: toolbarRect.left,
                    toolbarRight: toolbarRect.right,
                };
            })()
        `);
        assert.equal(layout.toolbarFits, true, `Toolbar overflows mobile viewport: ${JSON.stringify(layout)}`);
        assert.equal(layout.activityVisible, true, 'Activity toggle is not visible on mobile viewport');
    } finally {
        await page.close();
    }
}

async function run() {
    const address = await listen();
    const baseUrl = `http://${address.address}:${address.port}`;

    await runOpenRoomDrawingFlow(baseUrl);
    await runClosedRoomApprovalFlow(baseUrl);
    await runMobileToolbarSmoke(baseUrl);

    server.close();
    await once(server, 'close');
    console.log('Browser E2E tests passed');
}

run().catch(async error => {
    console.error(error);
    if (server.listening) {
        server.close();
    }
    process.exitCode = 1;
});
