import {moveCursor} from './cursor.js';
import {clear, draw, floodFill} from './drawing.js';
import {app} from './main.js';
import {activateMovingToolbar, deactivateMovingToolbar, moveToolbar} from './toolbar.js';

const fillColorInput = document.getElementById('fillColor');
const toolbar = document.querySelector('.toolbar');
const linePreview = document.querySelector('.line-width-preview');

export function initEvents() {
    fillColorInput.addEventListener('input', () => {
        app.fillColor = fillColorInput.value;
    });

    linePreview.querySelector('.list').addEventListener('click',e=>{
        if(e.target.matches('.item')){
            linePreview.querySelectorAll('.list .item').forEach(el=>el.classList.remove('active'));

            e.target.classList.add('active');

            const value = e.target.dataset.value;
            linePreview.style.setProperty('--lineWidth', value+'px');
            app.lineWidth = parseInt(value);
        }
    })

    toolbar.addEventListener('click', e => {
        if (e.target.matches('.tool')) {
            app.allTools.forEach(el => el.classList.remove('active'));
            app.currentTool = e.target.getAttribute('id');
            e.target.classList.add('active');
            return;
        }
        if (e.target.matches('#clear')) {
            clear();
        }
    });

    toolbar.addEventListener('mousedown', e => {
        if (e.target.matches('.move-handler')) {
           activateMovingToolbar()
        }
    });
    app.canvas.addEventListener('touchstart', (e) => {
        app.isDrawing = true;
        moveCursor(e.touches[0]);
        draw();
    });

    window.addEventListener('touchmove', (e) => {
        moveCursor(e.touches[0]);
        const {left, top} = app.canvas.getBoundingClientRect();
        app.mouse.x = e.touches[0].clientX - left;
        app.mouse.y = e.touches[0].clientY - top;
        if (app.isDrawing) {
            draw();
        }
    });

    window.addEventListener('touchend', () => {
        app.isDrawing = false;
        deactivateMovingToolbar()
        app.ctx.beginPath();
    });

    app.canvas.addEventListener('mousedown', e => {
        app.isDrawing = true;
        if (app.currentTool === 'fill') {
            const {x, y} = app.mouse;
            floodFill(x, y, [255, 0, 0, 255]);
        }

    });

    window.addEventListener('mouseup', () => {
        app.isDrawing = false;
        deactivateMovingToolbar()
        app.ctx.beginPath();
    });

    window.addEventListener('mousemove', e => {
        const {left, top} = app.canvas.getBoundingClientRect();
        app.mouse.x = e.clientX - left;
        app.mouse.y = e.clientY - top;
        moveToolbar(e)
        moveCursor(e);
        draw();
    });
}
