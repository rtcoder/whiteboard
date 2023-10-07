const cursor = document.getElementById('cursor');

export function moveCursor(e) {
    cursor.style.left = e.clientX - cursor.offsetWidth / 2 + 'px';
    cursor.style.top = e.clientY - cursor.offsetHeight / 2 + 'px';
}
