import {app} from './app.js';
import {clear, render} from './drawing.js';
import {initEvents} from './events.js';
import {initNetwork} from './network.js';
import {initActivityPanel} from './activity.js';
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
