import {app} from './main.js';
import {broadcastBoardState} from './network.js';
import {createId, getCanvasPoint} from './utils.js';

function cloneImageData(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function cloneObject(object) {
    if (object.type === 'bitmap') {
        return {
            ...object,
            imageData: cloneImageData(object.imageData),
        };
    }

    if (object.points) {
        return {
            ...object,
            points: object.points.map(point => ({...point})),
        };
    }

    return {...object};
}

export function cloneObjects(objects) {
    return objects.map(cloneObject);
}

export function saveHistory() {
    app.history.undo.push(cloneObjects(app.objects));
    app.history.redo = [];
}

export function undo() {
    if (!app.history.undo.length) {
        return;
    }

    app.history.redo.push(cloneObjects(app.objects));
    app.objects = app.history.undo.pop();
    app.selectedObjectId = null;
    render();
    broadcastBoardState();
}

export function redo() {
    if (!app.history.redo.length) {
        return;
    }

    app.history.undo.push(cloneObjects(app.objects));
    app.objects = app.history.redo.pop();
    app.selectedObjectId = null;
    render();
    broadcastBoardState();
}

export function clear(commit = true) {
    if (commit) {
        saveHistory();
    }

    app.objects = [];
    app.selectedObjectId = null;
    render();
    broadcastBoardState();
}

function clearCanvas() {
    app.ctx.fillStyle = 'white';
    app.ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
}

function drawPath(object) {
    if (object.points.length < 2) {
        return;
    }

    app.ctx.beginPath();
    app.ctx.lineWidth = object.lineWidth;
    app.ctx.lineCap = 'round';
    app.ctx.lineJoin = 'round';
    app.ctx.strokeStyle = object.color;
    app.ctx.globalAlpha = object.opacity || 1;
    app.ctx.moveTo(object.points[0].x, object.points[0].y);

    for (const point of object.points.slice(1)) {
        app.ctx.lineTo(point.x, point.y);
    }

    app.ctx.stroke();
    app.ctx.globalAlpha = 1;
}

function drawArrowHead(from, to, color, lineWidth) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = Math.max(14, lineWidth * 2.6);

    app.ctx.beginPath();
    app.ctx.moveTo(to.x, to.y);
    app.ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
    app.ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
    app.ctx.closePath();
    app.ctx.fillStyle = color;
    app.ctx.fill();
}

function drawShape(object) {
    const x = Math.min(object.x, object.x2);
    const y = Math.min(object.y, object.y2);
    const width = Math.abs(object.x2 - object.x);
    const height = Math.abs(object.y2 - object.y);

    app.ctx.beginPath();
    app.ctx.lineWidth = object.lineWidth;
    app.ctx.strokeStyle = object.color;
    app.ctx.fillStyle = object.fill || 'transparent';

    if (object.type === 'rectangle') {
        app.ctx.rect(x, y, width, height);
    } else if (object.type === 'ellipse') {
        app.ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (object.type === 'line' || object.type === 'arrow') {
        app.ctx.moveTo(object.x, object.y);
        app.ctx.lineTo(object.x2, object.y2);
    }

    if (object.fill && object.type !== 'line' && object.type !== 'arrow') {
        app.ctx.fill();
    }

    app.ctx.stroke();

    if (object.type === 'arrow') {
        drawArrowHead({x: object.x, y: object.y}, {x: object.x2, y: object.y2}, object.color, object.lineWidth);
    }
}

function wrapText(text, maxChars) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';

    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }

    if (line) {
        lines.push(line);
    }

    return lines;
}

function drawTextObject(object) {
    const isSticky = object.type === 'sticky';

    if (isSticky) {
        app.ctx.fillStyle = object.fill;
        app.ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
        app.ctx.lineWidth = 2;
        app.ctx.beginPath();
        app.ctx.roundRect(object.x, object.y, object.width, object.height, 14);
        app.ctx.fill();
        app.ctx.stroke();
    }

    app.ctx.fillStyle = object.color;
    app.ctx.font = `${object.fontWeight || 600} ${object.fontSize}px Inter, system-ui, sans-serif`;
    app.ctx.textBaseline = 'top';

    const padding = isSticky ? 18 : 0;
    const lines = wrapText(object.text, isSticky ? 18 : 32);
    lines.forEach((line, index) => {
        app.ctx.fillText(line, object.x + padding, object.y + padding + index * object.fontSize * 1.25);
    });
}

function getBounds(object) {
    if (object.type === 'path') {
        const xs = object.points.map(point => point.x);
        const ys = object.points.map(point => point.y);
        return {
            x: Math.min(...xs) - object.lineWidth,
            y: Math.min(...ys) - object.lineWidth,
            width: Math.max(...xs) - Math.min(...xs) + object.lineWidth * 2,
            height: Math.max(...ys) - Math.min(...ys) + object.lineWidth * 2,
        };
    }

    if (['line', 'arrow', 'rectangle', 'ellipse'].includes(object.type)) {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        return {
            x,
            y,
            width: Math.abs(object.x2 - object.x),
            height: Math.abs(object.y2 - object.y),
        };
    }

    if (object.type === 'text' || object.type === 'sticky') {
        return {
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
        };
    }

    return null;
}

function drawSelection(object) {
    const bounds = getBounds(object);

    if (!bounds) {
        return;
    }

    app.ctx.save();
    app.ctx.setLineDash([8, 6]);
    app.ctx.lineWidth = 2;
    app.ctx.strokeStyle = '#2563eb';
    app.ctx.strokeRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16);
    app.ctx.restore();
}

export function render(showSelection = true) {
    clearCanvas();

    for (const object of app.objects) {
        if (object.type === 'bitmap') {
            app.ctx.putImageData(object.imageData, 0, 0);
        } else if (object.type === 'path') {
            drawPath(object);
        } else if (['line', 'arrow', 'rectangle', 'ellipse'].includes(object.type)) {
            drawShape(object);
        } else if (object.type === 'text' || object.type === 'sticky') {
            drawTextObject(object);
        }
    }

    if (app.draftObject) {
        if (app.draftObject.type === 'path') {
            drawPath(app.draftObject);
        } else if (['line', 'arrow', 'rectangle', 'ellipse'].includes(app.draftObject.type)) {
            drawShape(app.draftObject);
        }
    }

    const selectedObject = showSelection ? app.objects.find(object => object.id === app.selectedObjectId) : null;
    if (selectedObject) {
        drawSelection(selectedObject);
    }
}

export function createPath(point, color, lineWidth, opacity = 1) {
    return {
        id: createId('path'),
        type: 'path',
        color,
        lineWidth,
        opacity,
        points: [point],
    };
}

export function createShape(type, point, color, lineWidth) {
    return {
        id: createId(type),
        type,
        x: point.x,
        y: point.y,
        x2: point.x,
        y2: point.y,
        color,
        lineWidth,
    };
}

export function createText(point, text) {
    return {
        id: createId('text'),
        type: 'text',
        x: point.x,
        y: point.y,
        width: 260,
        height: 48,
        color: app.fillColor,
        fontSize: 28,
        fontWeight: 700,
        text,
    };
}

export function createSticky(point, text) {
    return {
        id: createId('sticky'),
        type: 'sticky',
        x: point.x,
        y: point.y,
        width: 220,
        height: 160,
        fill: '#fef3c7',
        color: '#422006',
        fontSize: 20,
        fontWeight: 650,
        text,
    };
}

export function moveObject(object, dx, dy) {
    if (object.points) {
        object.points.forEach(point => {
            point.x += dx;
            point.y += dy;
        });
        return;
    }

    object.x += dx;
    object.y += dy;

    if ('x2' in object) {
        object.x2 += dx;
        object.y2 += dy;
    }
}

export function findObjectAt(point) {
    for (const object of [...app.objects].reverse()) {
        const bounds = getBounds(object);

        if (!bounds) {
            continue;
        }

        if (
            point.x >= bounds.x - 12 &&
            point.x <= bounds.x + bounds.width + 12 &&
            point.y >= bounds.y - 12 &&
            point.y <= bounds.y + bounds.height + 12
        ) {
            return object;
        }
    }

    return null;
}

export function draw() {
    if (!app.isDrawing || !app.draftObject || app.draftObject.type !== 'path') {
        return;
    }

    app.draftObject.points.push(getCanvasPoint(app.mouse.x, app.mouse.y));
    render();
}

export function floodFill(x, y, fillColor) {
    render(false);

    const point = getCanvasPoint(x, y);
    x = Math.floor(point.x);
    y = Math.floor(point.y);

    if (x < 0 || x >= app.canvas.width || y < 0 || y >= app.canvas.height) {
        return;
    }

    const imageData = app.ctx.getImageData(0, 0, app.canvas.width, app.canvas.height);
    const {data, width, height} = imageData;
    const startOffset = (y * width + x) * 4;
    const targetColor = [
        data[startOffset],
        data[startOffset + 1],
        data[startOffset + 2],
        data[startOffset + 3],
    ];

    if (
        targetColor[0] === fillColor[0] &&
        targetColor[1] === fillColor[1] &&
        targetColor[2] === fillColor[2] &&
        targetColor[3] === fillColor[3]
    ) {
        return;
    }

    const stack = [{x, y}];

    const matchesTargetColor = (px, py) => {
        const offset = (py * width + px) * 4;
        return data[offset] === targetColor[0] &&
            data[offset + 1] === targetColor[1] &&
            data[offset + 2] === targetColor[2] &&
            data[offset + 3] === targetColor[3];
    };

    const setFillColor = (px, py) => {
        const offset = (py * width + px) * 4;
        data[offset] = fillColor[0];
        data[offset + 1] = fillColor[1];
        data[offset + 2] = fillColor[2];
        data[offset + 3] = fillColor[3];
    };

    while (stack.length > 0) {
        const {x: startX, y} = stack.pop();

        if (!matchesTargetColor(startX, y)) {
            continue;
        }

        let left = startX;
        let right = startX;

        while (left > 0 && matchesTargetColor(left - 1, y)) {
            left--;
        }

        while (right < width - 1 && matchesTargetColor(right + 1, y)) {
            right++;
        }

        let spanAbove = false;
        let spanBelow = false;

        for (let px = left; px <= right; px++) {
            setFillColor(px, y);

            if (y > 0 && matchesTargetColor(px, y - 1)) {
                if (!spanAbove) {
                    stack.push({x: px, y: y - 1});
                    spanAbove = true;
                }
            } else {
                spanAbove = false;
            }

            if (y < height - 1 && matchesTargetColor(px, y + 1)) {
                if (!spanBelow) {
                    stack.push({x: px, y: y + 1});
                    spanBelow = true;
                }
            } else {
                spanBelow = false;
            }
        }
    }

    saveHistory();
    app.objects.push({
        id: createId('bitmap'),
        type: 'bitmap',
        imageData: cloneImageData(imageData),
    });
    render();
    broadcastBoardState();
}
