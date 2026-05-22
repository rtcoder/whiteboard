import {app} from './main.js';
import {broadcastBoardState} from './network.js';
import {createId, getCanvasPoint} from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const bitmapUrlCache = new WeakMap();

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
        return false;
    }

    app.history.redo.push(cloneObjects(app.objects));
    app.objects = app.history.undo.pop();
    app.selectedObjectId = null;
    render();
    broadcastBoardState({mode: 'replace'});
    return true;
}

export function redo() {
    if (!app.history.redo.length) {
        return false;
    }

    app.history.undo.push(cloneObjects(app.objects));
    app.objects = app.history.redo.pop();
    app.selectedObjectId = null;
    render();
    broadcastBoardState({mode: 'replace'});
    return true;
}

export function clear(commit = true) {
    const hadObjects = app.objects.length > 0;

    if (commit) {
        saveHistory();
    }

    app.objects = [];
    app.selectedObjectId = null;
    render();
    broadcastBoardState({mode: 'replace'});
    return hadObjects;
}

function clearCanvas() {
    app.ctx.fillStyle = 'white';
    app.ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
}

function createSvgElement(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);

    Object.entries(attrs).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            element.setAttribute(key, value);
        }
    });

    return element;
}

function setSvgAttrs(element, attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            element.setAttribute(key, value);
        }
    });
}

function getPathData(points) {
    if (!points.length) {
        return '';
    }

    return points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');
}

function imageDataToDataUrl(imageData) {
    if (bitmapUrlCache.has(imageData)) {
        return bitmapUrlCache.get(imageData);
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);

    const url = canvas.toDataURL('image/png');
    bitmapUrlCache.set(imageData, url);
    return url;
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
    } else if (object.type === 'diamond') {
        getShapePoints(object).forEach((point, index) => {
            if (index === 0) {
                app.ctx.moveTo(point.x, point.y);
            } else {
                app.ctx.lineTo(point.x, point.y);
            }
        });
        app.ctx.closePath();
    } else if (object.type === 'polygon') {
        getShapePoints(object).forEach((point, index) => {
            if (index === 0) {
                app.ctx.moveTo(point.x, point.y);
            } else {
                app.ctx.lineTo(point.x, point.y);
            }
        });
        app.ctx.closePath();
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

    if (['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon'].includes(object.type)) {
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

    if (object.type === 'bitmap') {
        return {
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
        };
    }

    return null;
}

function boundsOverlap(a, b, padding = 0) {
    return a.x - padding <= b.x + b.width &&
        a.x + a.width + padding >= b.x &&
        a.y - padding <= b.y + b.height &&
        a.y + a.height + padding >= b.y;
}

function rgbaToCss(color) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
}

function getShapePoints(object) {
    const x = Math.min(object.x, object.x2);
    const y = Math.min(object.y, object.y2);
    const width = Math.abs(object.x2 - object.x);
    const height = Math.abs(object.y2 - object.y);

    if (object.type === 'diamond') {
        return [
            {x: x + width / 2, y},
            {x: x + width, y: y + height / 2},
            {x: x + width / 2, y: y + height},
            {x, y: y + height / 2},
        ];
    }

    if (object.type === 'polygon') {
        return [
            {x: x + width * 0.25, y},
            {x: x + width * 0.75, y},
            {x: x + width, y: y + height / 2},
            {x: x + width * 0.75, y: y + height},
            {x: x + width * 0.25, y: y + height},
            {x, y: y + height / 2},
        ];
    }

    return [];
}

function isPointInsidePolygon(point, points) {
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const pi = points[i];
        const pj = points[j];
        const intersects = (pi.y > point.y) !== (pj.y > point.y) &&
            point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x;

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

function isPointInsideFillableObject(point, object) {
    if (object.type === 'rectangle') {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        const width = Math.abs(object.x2 - object.x);
        const height = Math.abs(object.y2 - object.y);

        return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    }

    if (object.type === 'ellipse') {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        const radiusX = Math.abs(object.x2 - object.x) / 2;
        const radiusY = Math.abs(object.y2 - object.y) / 2;

        if (!radiusX || !radiusY) {
            return false;
        }

        const centerX = x + radiusX;
        const centerY = y + radiusY;
        const normalizedX = (point.x - centerX) / radiusX;
        const normalizedY = (point.y - centerY) / radiusY;

        return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
    }

    if (object.type === 'diamond' || object.type === 'polygon') {
        return isPointInsidePolygon(point, getShapePoints(object));
    }

    return false;
}

function fillObjectAt(point, fillColor) {
    const object = [...app.objects].reverse().find(item => isPointInsideFillableObject(point, item));

    if (!object) {
        return false;
    }

    saveHistory();
    object.fill = rgbaToCss(fillColor);
    app.selectedObjectId = object.id;
    render();
    broadcastBoardState();

    return {
        color: rgbaToCss(fillColor),
        objectId: object.id,
        objectType: object.type,
    };
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

function createSvgPath(object) {
    if (object.points.length < 2) {
        return null;
    }

    return createSvgElement('path', {
        d: getPathData(object.points),
        fill: 'none',
        stroke: object.color,
        'stroke-width': object.lineWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: object.opacity || 1,
    });
}

function createSvgArrowHead(object) {
    const angle = Math.atan2(object.y2 - object.y, object.x2 - object.x);
    const size = Math.max(14, object.lineWidth * 2.6);
    const left = {
        x: object.x2 - size * Math.cos(angle - Math.PI / 6),
        y: object.y2 - size * Math.sin(angle - Math.PI / 6),
    };
    const right = {
        x: object.x2 - size * Math.cos(angle + Math.PI / 6),
        y: object.y2 - size * Math.sin(angle + Math.PI / 6),
    };

    return createSvgElement('polygon', {
        points: `${object.x2},${object.y2} ${left.x},${left.y} ${right.x},${right.y}`,
        fill: object.color,
    });
}

function createSvgShape(object) {
    const x = Math.min(object.x, object.x2);
    const y = Math.min(object.y, object.y2);
    const width = Math.abs(object.x2 - object.x);
    const height = Math.abs(object.y2 - object.y);
    const common = {
        fill: object.fill || 'transparent',
        stroke: object.color,
        'stroke-width': object.lineWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    };

    if (object.type === 'rectangle') {
        return createSvgElement('rect', {
            ...common,
            x,
            y,
            width,
            height,
        });
    }

    if (object.type === 'ellipse') {
        return createSvgElement('ellipse', {
            ...common,
            cx: x + width / 2,
            cy: y + height / 2,
            rx: width / 2,
            ry: height / 2,
        });
    }

    if (object.type === 'diamond') {
        return createSvgElement('polygon', {
            ...common,
            points: getShapePoints(object).map(point => `${point.x},${point.y}`).join(' '),
        });
    }

    if (object.type === 'polygon') {
        return createSvgElement('polygon', {
            ...common,
            points: getShapePoints(object).map(point => `${point.x},${point.y}`).join(' '),
        });
    }

    if (object.type === 'line' || object.type === 'arrow') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('line', {
            x1: object.x,
            y1: object.y,
            x2: object.x2,
            y2: object.y2,
            stroke: object.color,
            'stroke-width': object.lineWidth,
            'stroke-linecap': 'round',
        }));

        if (object.type === 'arrow') {
            group.appendChild(createSvgArrowHead(object));
        }

        return group;
    }

    return null;
}

function createSvgTextLines(object, parent, x, y, maxChars, padding = 0) {
    const text = createSvgElement('text', {
        x: x + padding,
        y: y + padding,
        fill: object.color,
        'font-size': object.fontSize,
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': object.fontWeight || 600,
        'dominant-baseline': 'text-before-edge',
    });

    wrapText(object.text, maxChars).forEach((line, index) => {
        const tspan = createSvgElement('tspan', {
            x: x + padding,
            dy: index === 0 ? 0 : object.fontSize * 1.25,
        });
        tspan.textContent = line;
        text.appendChild(tspan);
    });

    parent.appendChild(text);
}

function createSvgTextObject(object) {
    if (object.type === 'text') {
        const group = createSvgElement('g');
        createSvgTextLines(object, group, object.x, object.y, 32);
        return group;
    }

    const group = createSvgElement('g');
    group.appendChild(createSvgElement('rect', {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rx: 14,
        ry: 14,
        fill: object.fill,
        stroke: 'rgba(15, 23, 42, 0.14)',
        'stroke-width': 2,
    }));
    createSvgTextLines(object, group, object.x, object.y, 18, 18);
    return group;
}

function createSvgBitmap(object) {
    return createSvgElement('image', {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        href: imageDataToDataUrl(object.imageData),
        preserveAspectRatio: 'none',
    });
}

function createSvgSelection(object) {
    const bounds = getBounds(object);

    if (!bounds) {
        return null;
    }

    return createSvgElement('rect', {
        x: bounds.x - 8,
        y: bounds.y - 8,
        width: bounds.width + 16,
        height: bounds.height + 16,
        fill: 'none',
        stroke: '#2563eb',
        'stroke-width': 2,
        'stroke-dasharray': '8 6',
        'vector-effect': 'non-scaling-stroke',
    });
}

function appendSvgObject(object, parent = app.svg) {
    let element = null;

    if (object.type === 'bitmap') {
        element = createSvgBitmap(object);
    } else if (object.type === 'path') {
        element = createSvgPath(object);
    } else if (['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon'].includes(object.type)) {
        element = createSvgShape(object);
    } else if (object.type === 'text' || object.type === 'sticky') {
        element = createSvgTextObject(object);
    }

    if (!element) {
        return;
    }

    setSvgAttrs(element, {
        'data-object-id': object.id,
        'data-object-type': object.type,
    });
    parent.appendChild(element);
}

function renderSvg(showSelection = true) {
    app.svg.replaceChildren();
    const deferredObjects = new Set();

    for (const object of app.objects) {
        if (object.type === 'bitmap' && object.linkedObjectIds?.length) {
            appendSvgObject(object);
            object.linkedObjectIds.forEach(id => deferredObjects.add(id));
        }
    }

    for (const object of app.objects) {
        if (deferredObjects.has(object.id)) {
            continue;
        }

        appendSvgObject(object);
    }

    for (const object of app.objects) {
        if (deferredObjects.has(object.id)) {
            appendSvgObject(object);
        }
    }

    if (app.draftObject) {
        appendSvgObject(app.draftObject);
    }

    const selectedObject = showSelection ? app.objects.find(object => object.id === app.selectedObjectId) : null;
    const selection = selectedObject ? createSvgSelection(selectedObject) : null;

    if (selection) {
        app.svg.appendChild(selection);
    }
}

export function render(showSelection = true) {
    clearCanvas();
    const deferredObjects = new Set();

    for (const object of app.objects) {
        if (object.type === 'bitmap' && object.linkedObjectIds?.length) {
            app.ctx.putImageData(object.imageData, object.x, object.y);
            object.linkedObjectIds.forEach(id => deferredObjects.add(id));
        }
    }

    for (const object of app.objects) {
        if (deferredObjects.has(object.id)) {
            continue;
        }

        if (object.type === 'bitmap') {
            app.ctx.putImageData(object.imageData, object.x, object.y);
        } else if (object.type === 'path') {
            drawPath(object);
        } else if (['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon'].includes(object.type)) {
            drawShape(object);
        } else if (object.type === 'text' || object.type === 'sticky') {
            drawTextObject(object);
        }
    }

    for (const object of app.objects) {
        if (deferredObjects.has(object.id)) {
            drawPath(object);
        }
    }

    if (app.draftObject) {
        if (app.draftObject.type === 'path') {
            drawPath(app.draftObject);
        } else if (['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon'].includes(app.draftObject.type)) {
            drawShape(app.draftObject);
        }
    }

    const selectedObject = showSelection ? app.objects.find(object => object.id === app.selectedObjectId) : null;
    if (selectedObject) {
        drawSelection(selectedObject);
    }

    renderSvg(showSelection);
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

export function deleteObjectById(id) {
    const object = app.objects.find(item => item.id === id);

    if (!object) {
        return null;
    }

    saveHistory();
    app.objects = app.objects.filter(item => {
        if (item.id === id) {
            return false;
        }

        return !item.linkedObjectIds?.includes(id);
    });
    app.selectedObjectId = null;
    render();
    broadcastBoardState({mode: 'replace'});

    return object;
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

function moveSingleObject(object, dx, dy) {
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

export function moveObject(object, dx, dy) {
    const objectsToMove = new Set([object]);

    if (object.linkedObjectIds?.length) {
        app.objects
            .filter(item => object.linkedObjectIds.includes(item.id))
            .forEach(item => objectsToMove.add(item));
    }

    app.objects
        .filter(item => item.linkedObjectIds?.includes(object.id))
        .forEach(item => objectsToMove.add(item));

    objectsToMove.forEach(item => moveSingleObject(item, dx, dy));
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
    const point = getCanvasPoint(x, y);

    const objectFill = fillObjectAt(point, fillColor);

    if (objectFill) {
        return objectFill;
    }

    render(false);

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
    const filledPixels = new Uint8Array(width * height);
    let minX = x;
    let minY = y;
    let maxX = x;
    let maxY = y;
    let filledCount = 0;

    const matchesTargetColor = (px, py) => {
        const offset = (py * width + px) * 4;
        return Math.abs(data[offset] - targetColor[0]) <= app.fillTolerance &&
            Math.abs(data[offset + 1] - targetColor[1]) <= app.fillTolerance &&
            Math.abs(data[offset + 2] - targetColor[2]) <= app.fillTolerance &&
            Math.abs(data[offset + 3] - targetColor[3]) <= app.fillTolerance;
    };

    const setFillColor = (px, py) => {
        filledPixels[py * width + px] = 1;
        filledCount++;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

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

    if (!filledCount) {
        return;
    }

    const regionWidth = maxX - minX + 1;
    const regionHeight = maxY - minY + 1;
    const regionImageData = app.ctx.createImageData(regionWidth, regionHeight);
    const regionBounds = {
        x: minX,
        y: minY,
        width: regionWidth,
        height: regionHeight,
    };
    const linkedObjectIds = app.objects
        .filter(object => object.type === 'path')
        .filter(object => boundsOverlap(regionBounds, getBounds(object), app.lineWidth * 2))
        .map(object => object.id);

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            if (!filledPixels[py * width + px]) {
                continue;
            }

            const targetOffset = ((py - minY) * regionWidth + (px - minX)) * 4;
            regionImageData.data[targetOffset] = fillColor[0];
            regionImageData.data[targetOffset + 1] = fillColor[1];
            regionImageData.data[targetOffset + 2] = fillColor[2];
            regionImageData.data[targetOffset + 3] = fillColor[3];
        }
    }

    saveHistory();
    const bitmapObject = {
        id: createId('bitmap'),
        type: 'bitmap',
        x: minX,
        y: minY,
        width: regionWidth,
        height: regionHeight,
        linkedObjectIds,
        imageData: regionImageData,
    };

    app.objects.push(bitmapObject);
    render();
    broadcastBoardState();

    return {
        color: rgbaToCss(fillColor),
        objectId: bitmapObject.id,
        objectType: linkedObjectIds.length ? 'path' : 'bitmap',
    };
}
