import {clear} from './drawing.js';
import {initEvents} from './events.js';

export const app = {
    canvas: null,
    ctx: null,
    cursor: null,
    allTools: [],
    currentTool: 'pen',
    fillColor: 'black',
    lineWidth: 5,
    isDrawing: false,
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

export function setMousePosition(e) {
    const ev = e.touches?.[0] || e;
    app.mouse.x = ev.clientX;
    app.mouse.y = ev.clientY;
}


function resizeCanvas() {
    app.canvas.width = window.innerWidth * 5;
    app.canvas.height = window.innerHeight * 5;
}

initEvents();
resizeCanvas();
clear();
