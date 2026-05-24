import {app} from './app.js';
import {clear, render} from './drawing.js';
import {initEvents} from './events.js';
import {initNetwork} from './network.js';
import {initActivityPanel} from './activity.js';
import {getUserAvatar} from './utils.js';
import './components/activity-item/activity-item.js';


app.svg = document.querySelector('#whiteboardSvg');
app.allTools = document.querySelectorAll('.tool');
window.whiteboardApp = app;
window.whiteboardRender = render;

export function setMousePosition(e) {
    const ev = e.touches?.[0] || e;
    app.mouse.x = ev.clientX;
    app.mouse.y = ev.clientY;
}


function resizeBoard() {
    app.board.width = window.innerWidth * 5;
    app.board.height = window.innerHeight * 5;
    app.svg.setAttribute('width', app.board.width);
    app.svg.setAttribute('height', app.board.height);
    app.svg.setAttribute('viewBox', `0 0 ${app.board.width} ${app.board.height}`);
    render();
}

resizeBoard();

function getRoomIdFromPath() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    return path || null;
}

function getRoomJoinKey(roomId) {
    return `whiteboard:joined:${roomId}`;
}

function getRoomAccessTokenKey(roomId) {
    return `whiteboard:accessToken:${roomId}`;
}

function getStoredRoomName(roomId) {
    return localStorage.getItem(`whiteboard:boardName:${roomId}`) || '';
}

async function fetchRoomMetadata(roomId) {
    if (!roomId) {
        return null;
    }

    try {
        const params = new URLSearchParams({
            client: app.clientId,
            token: localStorage.getItem(getRoomAccessTokenKey(roomId)) || '',
        });
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}?${params.toString()}`);

        if (!response.ok) {
            return null;
        }

        return response.json();
    } catch {
        return null;
    }
}

async function createRoomMetadata(roomId, boardName, userName, accessMode) {
    const avatar = getUserAvatar(userName, `${userName}:${app.clientId}`);
    const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            roomId,
            name: boardName,
            accessMode,
            host: {
                id: app.clientId,
                name: userName,
                color: avatar.color,
                initials: avatar.initials,
            },
        }),
    });

    if (!response.ok) {
        throw new Error('Unable to create room');
    }

    return response.json();
}

async function requestRoomAccess(roomId, userName) {
    const avatar = getUserAvatar(userName, `${userName}:${app.clientId}`);
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join-requests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            clientId: app.clientId,
            accessToken: localStorage.getItem(getRoomAccessTokenKey(roomId)) || '',
            user: {
                id: app.clientId,
                name: userName,
                color: avatar.color,
                initials: avatar.initials,
            },
        }),
    });

    if (!response.ok) {
        throw new Error('Unable to request room access');
    }

    return response.json();
}

async function fetchJoinRequestStatus(roomId, requestId) {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join-requests/${encodeURIComponent(requestId)}`);

    if (!response.ok) {
        throw new Error('Unable to fetch join request');
    }

    return response.json();
}

function waitForJoinApproval(roomId, requestId, statusElement, actionButton) {
    let attempts = 0;
    const timer = window.setInterval(async () => {
        attempts += 1;

        try {
            const request = await fetchJoinRequestStatus(roomId, requestId);

            if (request.status === 'accepted') {
                window.clearInterval(timer);
                statusElement.textContent = 'Request accepted. Joining...';
                localStorage.setItem(getRoomJoinKey(roomId), 'true');
                if (request.accessToken) {
                    localStorage.setItem(getRoomAccessTokenKey(roomId), request.accessToken);
                }
                window.location.href = `/${roomId}`;
                return;
            }

            if (request.status === 'rejected') {
                window.clearInterval(timer);
                statusElement.textContent = 'Request declined by the host.';
                actionButton.disabled = false;
                actionButton.textContent = 'Request access';
            }
        } catch {
            if (attempts > 30) {
                window.clearInterval(timer);
                statusElement.textContent = 'Still waiting. Try again in a moment.';
                actionButton.disabled = false;
                actionButton.textContent = 'Request access';
            }
        }
    }, 1200);
}

function applyLocalUserName(name) {
    const userName = name.trim();

    if (!userName) {
        return '';
    }

    const avatar = getUserAvatar(userName, `${userName}:${app.clientId}`);
    app.localUser.name = userName;
    app.localUser.color = avatar.color;
    app.localUser.initials = avatar.initials;
    localStorage.setItem('whiteboard:userName', userName);
    return userName;
}

function setupLobby({mode = 'home', roomId = null, roomMeta = null} = {}) {
    document.body.classList.add('lobby-active');
    const lobbyPanel = document.querySelector('.lobby-panel');
    const lobbyTitle = document.getElementById('lobbyTitle');
    const lobbyDescription = document.getElementById('lobbyDescription');
    const joinRoomName = document.getElementById('joinRoomName');
    const userNameInput = document.getElementById('userName');
    const boardNameInput = document.getElementById('boardName');
    const roomAccessChoice = document.getElementById('roomAccessChoice');
    const joinStatus = document.getElementById('joinStatus');
    const newWhiteboardButton = document.getElementById('newWhiteboard');
    const joinWhiteboardForm = document.getElementById('joinWhiteboard');
    const roomCodeInput = document.getElementById('roomCode');

    userNameInput.value = localStorage.getItem('whiteboard:userName') || '';
    boardNameInput.value = localStorage.getItem('whiteboard:lastBoardName') || '';

    const saveUserName = () => {
        const name = applyLocalUserName(userNameInput.value);
        userNameInput.classList.toggle('input-error', !name);
        return name;
    };

    if (mode === 'join') {
        const boardName = roomMeta?.name || getStoredRoomName(roomId) || `Whiteboard / ${roomId.slice(0, 8)}`;
        lobbyPanel.classList.add('is-join-mode');
        lobbyTitle.textContent = boardName;
        lobbyDescription.textContent = 'Enter your name to join this whiteboard.';
        joinRoomName.hidden = true;
        newWhiteboardButton.textContent = roomMeta?.accessMode === 'closed' && !roomMeta?.canJoin ? 'Request access' : 'Join room';
    } else {
        lobbyPanel.classList.remove('is-join-mode');
        lobbyTitle.textContent = 'Start a shared board';
        lobbyDescription.textContent = 'Create a new room or paste a meeting code to join an existing board.';
        joinRoomName.hidden = true;
        joinStatus.textContent = '';
        newWhiteboardButton.textContent = 'New whiteboard';
    }

    const submitPrimaryAction = async () => {
        const userName = saveUserName();

        if (!userName) {
            userNameInput.focus();
            return false;
        }

        if (mode === 'join' && roomId) {
            if (roomMeta?.accessMode === 'closed' && !roomMeta?.canJoin) {
                newWhiteboardButton.disabled = true;
                newWhiteboardButton.textContent = 'Waiting for host';
                joinStatus.textContent = 'Waiting for the host to approve your request.';

                try {
                    const request = await requestRoomAccess(roomId, userName);

                    if (request.status === 'accepted') {
                        if (request.accessToken) {
                            localStorage.setItem(getRoomAccessTokenKey(roomId), request.accessToken);
                        }
                        localStorage.setItem(getRoomJoinKey(roomId), 'true');
                        window.location.href = `/${roomId}`;
                        return true;
                    }

                    waitForJoinApproval(roomId, request.id, joinStatus, newWhiteboardButton);
                } catch {
                    joinStatus.textContent = 'Unable to send request. Try again.';
                    newWhiteboardButton.disabled = false;
                    newWhiteboardButton.textContent = 'Request access';
                    return false;
                }
                return true;
            }

            localStorage.setItem(getRoomJoinKey(roomId), 'true');
            window.location.href = `/${roomId}`;
            return true;
        }

        const newRoomId = crypto.randomUUID();
        const boardName = boardNameInput.value.trim() || 'Untitled whiteboard';
        const accessMode = roomAccessChoice.querySelector('input[name="roomAccess"]:checked')?.value || 'open';

        try {
            const room = await createRoomMetadata(newRoomId, boardName, userName, accessMode);
            localStorage.setItem(`whiteboard:boardName:${newRoomId}`, boardName);
            localStorage.setItem('whiteboard:lastBoardName', boardName);
            localStorage.setItem(getRoomJoinKey(newRoomId), 'true');
            if (room.accessToken) {
                localStorage.setItem(getRoomAccessTokenKey(newRoomId), room.accessToken);
            }
            localStorage.setItem(`whiteboard:host:${newRoomId}`, app.clientId);
            window.location.href = `/${newRoomId}`;
            return true;
        } catch {
            newWhiteboardButton.textContent = 'Try again';
            return false;
        }
    };

    newWhiteboardButton.addEventListener('click', () => {
        submitPrimaryAction();
    });

    userNameInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        submitPrimaryAction();
    });

    joinWhiteboardForm.addEventListener('submit', event => {
        event.preventDefault();
        const name = saveUserName();
        const code = roomCodeInput.value.trim();

        if (name && code) {
            window.location.href = `/${code}`;
        }
    });
}

app.roomId = getRoomIdFromPath();

async function boot() {
    if (!app.roomId) {
        setupLobby();
        return;
    }

    const roomMeta = await fetchRoomMetadata(app.roomId);
    const hasJoinedRoom = localStorage.getItem(getRoomJoinKey(app.roomId)) === 'true';
    const canOpenBoard = roomMeta && (roomMeta.accessMode !== 'closed'
        || roomMeta?.host?.id === app.clientId
        || (hasJoinedRoom && roomMeta?.canJoin));

    if (!canOpenBoard) {
        localStorage.removeItem(getRoomJoinKey(app.roomId));
        localStorage.removeItem(getRoomAccessTokenKey(app.roomId));
        setupLobby({
            mode: 'join',
            roomId: app.roomId,
            roomMeta,
        });
        return;
    }

    document.body.classList.remove('lobby-active');
    if (roomMeta?.name) {
        localStorage.setItem(`whiteboard:boardName:${app.roomId}`, roomMeta.name);
    }

    app.roomName = roomMeta?.name || getStoredRoomName(app.roomId) || `Whiteboard / ${app.roomId.slice(0, 8)}`;
    app.roomHost = roomMeta?.host || null;
    app.roomAccessMode = roomMeta?.accessMode || 'open';
    app.isHost = app.roomHost?.id === app.clientId;
    clear(false);
    initActivityPanel();
    initEvents();
    initNetwork({
        render,
        onPeersChange: window.updateRemoteCursors || (() => {}),
    });
}

boot();
