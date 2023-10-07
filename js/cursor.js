import {app} from './main.js';

const cursor = document.getElementById('cursor');

export function moveCursor() {
    cursor.style.left = app.mouse.x + 'px';
    cursor.style.top = app.mouse.y + 'px';
}

export function setCursorSize(value) {
    value = value * app.zoom.scale;
    cursor.style.width = value + 'px';
    cursor.style.height = value + 'px';
}
