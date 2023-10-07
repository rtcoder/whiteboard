import {app} from './main.js';

const cursor = document.getElementById('cursor');

export function moveCursor() {
    cursor.style.left = app.mouse.x + 'px';
    cursor.style.top = app.mouse.y + 'px';
}
