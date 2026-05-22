import {clear, render} from './drawing.js';
import {initEvents} from './events.js';
import {initNetwork} from './network.js';
import {initActivityPanel} from './activity.js';
import {getUserAvatar} from './utils.js';

const storedUserName = localStorage.getItem('whiteboard:userName') || `Guest ${Math.floor(Math.random() * 90 + 10)}`;
const storedUserAvatar = getUserAvatar(storedUserName);

export const app = {
    canvas: null,
    ctx: null,
    cursor: null,
    allTools: [],
    currentTool: 'pen',
    fillColor: 'black',
    lineWidth: 5,
    isDrawing: false,
    objects: [],
    draftObject: null,
    selectedObjectId: null,
    history: {
        undo: [],
        redo: [],
    },
    drag: {
        start: null,
        last: null,
        moved: false,
    },
    roomId: null,
    localUser: {
        name: storedUserName,
        color: storedUserAvatar.color,
        initials: storedUserAvatar.initials,
    },
    collaborators: new Map(),
    activityLog: [],
    mouse: {
        x: 0,
        y: 0,
    },
    mouseDownOnToolbarMoveHandler: false,
    points: [],
    zoom: {
        _steps: [0.2, 0.4, 0.5, 0.75, 0.9, 1],
        scale: 0.2,
        offsetX: 0,
        offsetY: 0,
    },
};
app.canvas = document.querySelector('#whiteboard');
app.ctx = app.canvas.getContext('2d');
app.allTools = document.querySelectorAll('.tool');
window.whiteboardApp = app;

export function setMousePosition(e) {
    const ev = e.touches?.[0] || e;
    app.mouse.x = ev.clientX;
    app.mouse.y = ev.clientY;
}


function resizeCanvas() {
    app.canvas.width = window.innerWidth * 5;
    app.canvas.height = window.innerHeight * 5;
    render();
}

resizeCanvas();

function getRoomIdFromPath() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    return path || null;
}

function setupLobby() {
    document.body.classList.add('lobby-active');
    const userNameInput = document.getElementById('userName');
    const boardNameInput = document.getElementById('boardName');
    userNameInput.value = localStorage.getItem('whiteboard:userName') || '';
    boardNameInput.value = localStorage.getItem('whiteboard:lastBoardName') || '';

    const saveUserName = () => {
        const name = userNameInput.value.trim();

        if (name) {
            localStorage.setItem('whiteboard:userName', name);
        } else {
            localStorage.removeItem('whiteboard:userName');
        }

        return name;
    };

    document.getElementById('newWhiteboard').addEventListener('click', () => {
        saveUserName();
        const roomId = crypto.randomUUID();
        const boardName = boardNameInput.value.trim();

        if (boardName) {
            localStorage.setItem(`whiteboard:boardName:${roomId}`, boardName);
            localStorage.setItem('whiteboard:lastBoardName', boardName);
        } else {
            localStorage.removeItem('whiteboard:lastBoardName');
        }

        window.location.href = `/${roomId}`;
    });

    document.getElementById('joinWhiteboard').addEventListener('submit', event => {
        event.preventDefault();
        saveUserName();
        const code = document.getElementById('roomCode').value.trim();

        if (code) {
            window.location.href = `/${code}`;
        }
    });
}

app.roomId = getRoomIdFromPath();

if (!app.roomId) {
    setupLobby();
} else {
    clear(false);
    initActivityPanel();
    initEvents();
    initNetwork({
        render,
        onPeersChange: window.updateRemoteCursors || (() => {}),
    });
}
