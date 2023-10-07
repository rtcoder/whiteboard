import {app} from './main.js';

const toolbar = document.querySelector('.toolbar');

export function moveToolbar(e) {
    if (!app.mouseDownOnToolbarMoveHandler) {
        return;
    }
    toolbar.style.top = app.mouse.y - 7 + 'px';
    toolbar.style.left = app.mouse.x + 'px';
}

export function activateMovingToolbar() {
    app.mouseDownOnToolbarMoveHandler = true;
    toolbar.style.overflow = 'hidden';
    toolbar.classList.add('moving');
}

export function deactivateMovingToolbar() {
    if (!app.mouseDownOnToolbarMoveHandler) {
        return;
    }
    app.mouseDownOnToolbarMoveHandler = false;
    toolbar.classList.remove('top', 'left', 'right', 'bottom');

    // ......
    const verticalPosition = app.mouse.y < window.innerHeight / 2 ? 'top' : 'bottom';
    const horizontalPosition = app.mouse.x < window.innerWidth / 2 ? 'left' : 'right';

    const verticalDistanceToSide = verticalPosition === 'top' ? app.mouse.y : (window.innerHeight - app.mouse.y);
    const horizontalDistanceToSide = horizontalPosition === 'left' ? app.mouse.x : (window.innerWidth - app.mouse.x);

    const positionClass = verticalDistanceToSide < horizontalDistanceToSide ? verticalPosition : horizontalPosition;
    toolbar.classList.add(positionClass);
    toolbar.classList.remove('moving');
    toolbar.style.removeProperty('top');
    toolbar.style.removeProperty('left');
    setTimeout(() => toolbar.style.removeProperty('overflow'), 300);
}
