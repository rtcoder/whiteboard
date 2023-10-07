import {moveCursor, setCursorSize} from './cursor.js';
import {clear, draw, floodFill} from './drawing.js';
import {app, setMousePosition} from './main.js';
import {activateMovingToolbar, deactivateMovingToolbar, hideToolbar, moveToolbar, showToolbar} from './toolbar.js';
import {getCanvasTransform, hexToRgba} from './utils.js';

const fillColorInput = document.getElementById('fillColor');
const linePreview = document.querySelector('.line-width-preview');

function addListener(element, events, listener) {
    events.forEach(ev => {
        element.addEventListener(ev, listener);
    });
}

export function initEvents() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    fillColorInput.addEventListener('input', () => {
        app.fillColor = fillColorInput.value;
    });

    linePreview.querySelector('.list').addEventListener('click', e => {
        if (e.target.matches('.item')) {
            linePreview.querySelectorAll('.list .item').forEach(el => el.classList.remove('active'));

            e.target.classList.add('active');

            const value = e.target.dataset.value;
            linePreview.style.setProperty('--lineWidth', value + 'px');
            app.lineWidth = parseInt(value);
            setCursorSize(value);
        }
    });

    window.addEventListener('click', e => {
        if (e.target.matches('.toolbar *')) {
            if (e.target.matches('.toolbar .tool')) {
                app.allTools.forEach(el => el.classList.remove('active'));
                app.currentTool = e.target.getAttribute('id');
                e.target.classList.add('active');
                return;
            }
            if (e.target.matches('.toolbar #clear')) {
                clear();
                return;
            }
        }

        if (e.target.matches('.zoom-container *:not(.value)')) {
            const currentZoomIndex = app.zoom._steps.findIndex(v => v === app.zoom.scale);
            document.querySelectorAll('.zoom-container .minus, .zoom-container .plus')
                .forEach(el => el.classList.remove('disabled'));

            let indexModifier = 0;

            if (e.target.matches('.minus')) {
                if (currentZoomIndex <= 1) {
                    e.target.classList.add('disabled');
                }
                if (currentZoomIndex === 0) {
                    return;
                }
                indexModifier = -1;
            }
            if (e.target.matches('.plus')) {
                if (currentZoomIndex >= app.zoom._steps.length - 2) {
                    e.target.classList.add('disabled');
                }
                if (currentZoomIndex === app.zoom._steps.length - 1) {
                    return;
                }

                indexModifier = 1;
            }
            app.zoom.scale = app.zoom._steps[currentZoomIndex + indexModifier];
            document.querySelector('.zoom-container .value').innerHTML = app.zoom.scale * 100 + '%';
            app.canvas.style.transform = getCanvasTransform();
        }
    });

    addListener(window, ['mousedown', 'touchstart'], e => {
        if (e.target.matches('.move-handler')) {
            activateMovingToolbar();
            return;
        }

        if (!e.target.matches('.draw-handler')) {
            return;
        }
        setMousePosition(e);

        app.isDrawing = true;
        hideToolbar();
        moveCursor();

        if (app.currentTool === 'fill') {
            const {x, y} = app.mouse;
            floodFill(x, y, hexToRgba(app.fillColor));
            return;
        }
        draw();
    });

    addListener(window, ['mousemove', 'touchmove'], e => {
        setMousePosition(e);
        moveCursor();
        moveToolbar();
        draw();
    });

    addListener(window, ['mouseup', 'touchend'], () => {
        app.isDrawing = false;
        showToolbar();
        deactivateMovingToolbar();
        app.ctx.beginPath();
    });


    window.addEventListener('wheel', (e) => {
        app.zoom.offsetX += -e.deltaX / app.zoom.scale;
        app.zoom.offsetY += -e.deltaY / app.zoom.scale;

        if (app.zoom.offsetX > 0) {
            app.zoom.offsetX = 0;
        }
        if (app.zoom.offsetY > 0) {
            app.zoom.offsetY = 0;
        }
        if (app.zoom.offsetX < -(app.canvas.width * app.zoom.scale - window.innerWidth)) {
            app.zoom.offsetX = -(app.canvas.width * app.zoom.scale - window.innerWidth);
        }
        if (app.zoom.offsetY < -(app.canvas.height * app.zoom.scale - window.innerHeight)) {
            app.zoom.offsetY = -(app.canvas.height * app.zoom.scale - window.innerHeight);
        }
        app.canvas.style.transform = getCanvasTransform();
    });
}
