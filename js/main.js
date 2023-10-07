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
    mouseDownOnToolbarMoveHandler:false
};
app.canvas = document.querySelector('#whiteboard');
app.ctx = app.canvas.getContext('2d');
app.allTools = document.querySelectorAll('.tool');






function resizeCanvas() {
    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;
}
initEvents();
resizeCanvas();
clear();
