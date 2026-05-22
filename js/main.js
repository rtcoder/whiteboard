import {clear, render} from './drawing.js';
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
    collaborators: [
        {id: 'mk', name: 'MK', color: '#10b981', x: 720, y: 360},
        {id: 'a', name: 'A', color: '#f97316', x: 980, y: 620},
    ],
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
clear(false);
initEvents();
