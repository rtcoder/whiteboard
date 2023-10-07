import {app} from './main.js';

export function draw() {
    if (!app.isDrawing || app.currentTool === 'fill') {
        return;
    }

    app.ctx.lineWidth = app.lineWidth;
    app.ctx.lineCap = 'round';

    if (app.currentTool === 'pen') {
        app.ctx.strokeStyle = app.fillColor;
    } else if (app.currentTool === 'eraser') {
        app.ctx.strokeStyle = 'white';
    }
    const {x, y} = app.mouse;

    app.ctx.lineTo(x * (1 / app.zoom.scale), y * (1 / app.zoom.scale));
    app.ctx.stroke();
    app.ctx.beginPath();
    app.ctx.moveTo(x * (1 / app.zoom.scale), y * (1 / app.zoom.scale));
}

export function clear() {
    app.ctx.fillStyle = 'white';
    app.ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
    app.ctx.fillStyle = app.fillColor;
}

function getPixel(imageData, x, y) {
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
        return [-1, -1, -1, -1];  // impossible color
    } else {
        const offset = (y * imageData.width + x) * 4;
        return imageData.data.slice(offset, offset + 4);
    }
}

function setPixel(imageData, x, y, color) {
    const offset = (y * imageData.width + x) * 4;
    imageData.data[offset] = color[0];
    imageData.data[offset + 1] = color[1];
    imageData.data[offset + 2] = color[2];
    imageData.data[offset + 3] = color[3];
}

function colorsMatch(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function floodFill(x, y, fillColor) {
    x = x * (1 / app.zoom.scale);
    y = y * (1 / app.zoom.scale);
    const imageData = app.ctx.getImageData(0, 0, app.canvas.width, app.canvas.height);
    const targetColor = getPixel(imageData, x, y);
    const stack = [{x, y}];

    while (stack.length > 0) {
        const pixel = stack.pop();
        const {x, y} = pixel;

        if (x < 0 || x >= app.canvas.width || y < 0 || y >= app.canvas.height) {
            continue;
        }

        if (!colorsMatch(getPixel(imageData, x, y), targetColor)) {
            continue;
        }

        setPixel(imageData, x, y, fillColor);
        stack.push({x: x + 1, y});
        stack.push({x: x - 1, y});
        stack.push({x, y: y + 1});
        stack.push({x, y: y - 1});
    }

    app.ctx.putImageData(imageData, 0, 0);
}
