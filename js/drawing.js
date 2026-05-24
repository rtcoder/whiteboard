import {app} from './main.js';
import {broadcastBoardState} from './network.js';
import {createId, getCanvasPoint} from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const bitmapUrlCache = new WeakMap();
const FILL_EDGE_CLEANUP_MIN_NEIGHBORS = 2;
const BASE_SHAPE_TYPES = ['line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'polygon'];
const FLOW_SHAPE_TYPES = ['flow-process', 'flow-decision', 'flow-terminator', 'flow-database'];
const DIAGRAM_OBJECT_TYPES = ['mind-node', 'swimlane', 'kanban', 'template-frame'];
const SHAPE_TYPES = [...BASE_SHAPE_TYPES, ...FLOW_SHAPE_TYPES, ...DIAGRAM_OBJECT_TYPES];
const ANCHORS = ['top', 'right', 'bottom', 'left'];

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
    app.selectedObjectIds = [];
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
    app.selectedObjectIds = [];
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
    app.selectedObjectIds = [];
    render();
    broadcastBoardState({mode: 'replace'});
    return hadObjects;
}

export function clearUnlockedObjects(commit = true) {
    const unlockedObjects = app.objects.filter(object => !object.locked);

    if (!unlockedObjects.length) {
        return false;
    }

    if (commit) {
        saveHistory();
    }

    app.objects = app.objects.filter(object => object.locked);
    app.selectedObjectId = null;
    app.selectedObjectIds = [];
    render();
    broadcastBoardState();
    return true;
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

function distanceBetweenPoints(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function simplifyPoints(points, tolerance = 1.4) {
    if (points.length <= 2) {
        return points;
    }

    const simplified = [points[0]];
    let lastKeptPoint = points[0];

    for (const point of points.slice(1, -1)) {
        if (distanceBetweenPoints(lastKeptPoint, point) >= tolerance) {
            simplified.push(point);
            lastKeptPoint = point;
        }
    }

    simplified.push(points[points.length - 1]);
    return simplified;
}

function smoothPoints(points) {
    if (points.length <= 3) {
        return points;
    }

    return points.map((point, index) => {
        if (index === 0 || index === points.length - 1) {
            return point;
        }

        const previous = points[index - 1];
        const next = points[index + 1];
        return {
            x: Math.round((previous.x + point.x * 2 + next.x) / 4 * 10) / 10,
            y: Math.round((previous.y + point.y * 2 + next.y) / 4 * 10) / 10,
        };
    });
}

export function optimizePathObject(object) {
    if (object.type !== 'path' || object.points.length <= 2) {
        return object;
    }

    const tolerance = Math.max(1.2, Math.min(5, object.lineWidth * 0.18));
    object.points = smoothPoints(simplifyPoints(object.points, tolerance));
    return object;
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

function getRawBounds(object) {
    if (object.type === 'connector') {
        const endpoints = getConnectorEndpoints(object);
        const x = Math.min(endpoints.from.x, endpoints.to.x);
        const y = Math.min(endpoints.from.y, endpoints.to.y);
        return {
            x,
            y,
            width: Math.abs(endpoints.to.x - endpoints.from.x),
            height: Math.abs(endpoints.to.y - endpoints.from.y),
        };
    }

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

    if (SHAPE_TYPES.includes(object.type)) {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        return {
            x,
            y,
            width: Math.abs(object.x2 - object.x),
            height: Math.abs(object.y2 - object.y),
        };
    }

    if (object.type === 'frame' && 'x2' in object) {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        return {
            x,
            y,
            width: Math.abs(object.x2 - object.x),
            height: Math.abs(object.y2 - object.y),
        };
    }

    if (['text', 'sticky', 'callout', 'list', 'label', 'frame', 'comment'].includes(object.type)) {
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

    if (object.type === 'image') {
        return {
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
        };
    }

    return null;
}

function rotatePoint(point, center, angle) {
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = point.x - center.x;
    const dy = point.y - center.y;

    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    };
}

function getBounds(object) {
    const bounds = getRawBounds(object);

    if (!bounds || !object.rotation || object.type === 'connector') {
        return bounds;
    }

    const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
    };
    const points = [
        rotatePoint({x: bounds.x, y: bounds.y}, center, object.rotation),
        rotatePoint({x: bounds.x + bounds.width, y: bounds.y}, center, object.rotation),
        rotatePoint({x: bounds.x + bounds.width, y: bounds.y + bounds.height}, center, object.rotation),
        rotatePoint({x: bounds.x, y: bounds.y + bounds.height}, center, object.rotation),
    ];
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

export function getObjectBounds(object) {
    return getBounds(object);
}

export function getObjectsBounds(objects = app.objects) {
    const bounds = objects
        .map(getBounds)
        .filter(Boolean);

    if (!bounds.length) {
        return null;
    }

    const minX = Math.min(...bounds.map(bound => bound.x));
    const minY = Math.min(...bounds.map(bound => bound.y));
    const maxX = Math.max(...bounds.map(bound => bound.x + bound.width));
    const maxY = Math.max(...bounds.map(bound => bound.y + bound.height));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

export function getSelectedObjects() {
    const ids = app.selectedObjectIds?.length ? app.selectedObjectIds : app.selectedObjectId ? [app.selectedObjectId] : [];
    return app.objects.filter(object => ids.includes(object.id));
}

export function getSelectedObjectsBounds() {
    return getObjectsBounds(getSelectedObjects());
}

export function getObjectsInBounds(selectionBounds) {
    return app.objects.filter(object => {
        const bounds = getBounds(object);
        return bounds && boundsOverlap(bounds, selectionBounds);
    });
}

function boundsOverlap(a, b, padding = 0) {
    return a.x - padding <= b.x + b.width &&
        a.x + a.width + padding >= b.x &&
        a.y - padding <= b.y + b.height &&
        a.y + a.height + padding >= b.y;
}

function getObjectCenter(object) {
    const bounds = getRawBounds(object);
    return bounds
        ? {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2}
        : {x: 0, y: 0};
}

function getRotationTransform(object) {
    const rotation = object.rotation || 0;

    if (!rotation) {
        return null;
    }

    const center = getObjectCenter(object);
    return `rotate(${rotation} ${center.x} ${center.y})`;
}

function getLocalPoint(point, object) {
    const rotation = object.rotation || 0;

    if (!rotation) {
        return point;
    }

    return rotatePoint(point, getObjectCenter(object), -rotation);
}

function isPointInBounds(point, bounds, padding = 12) {
    return point.x >= bounds.x - padding &&
        point.x <= bounds.x + bounds.width + padding &&
        point.y >= bounds.y - padding &&
        point.y <= bounds.y + bounds.height + padding;
}

function isPointNearSegment(point, from, to, padding = 12) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;

    if (!lengthSquared) {
        return Math.hypot(point.x - from.x, point.y - from.y) <= padding;
    }

    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    const projected = {
        x: from.x + t * dx,
        y: from.y + t * dy,
    };

    return Math.hypot(point.x - projected.x, point.y - projected.y) <= padding;
}

function isPointInsideObject(point, object) {
    if (object.type === 'connector') {
        const endpoints = getConnectorEndpoints(object);
        return isPointNearSegment(point, endpoints.from, endpoints.to, Math.max(12, object.lineWidth * 2));
    }

    const bounds = getRawBounds(object);

    if (!bounds) {
        return false;
    }

    const localPoint = getLocalPoint(point, object);

    if (['rectangle', 'ellipse', 'diamond', 'polygon', ...FLOW_SHAPE_TYPES, 'mind-node'].includes(object.type)) {
        return isPointInsideFillableObject(localPoint, object);
    }

    return isPointInBounds(localPoint, bounds);
}

export function getConnectorEndpoints(object) {
    const fromObject = app.objects.find(item => item.id === object.fromId);
    const toObject = app.objects.find(item => item.id === object.toId);
    const fallbackFrom = {x: object.x, y: object.y};
    const fallbackTo = {x: object.x2, y: object.y2};

    return {
        from: fromObject
            ? toObject
                ? getConnectionPoint(fromObject, toObject, object.fromAnchor)
                : getAnchorPoint(fromObject, object.fromAnchor || 'right')
            : fallbackFrom,
        to: toObject
            ? fromObject
                ? getConnectionPoint(toObject, fromObject, object.toAnchor)
                : getAnchorPoint(toObject, object.toAnchor || 'left')
            : fallbackTo,
    };
}

function getAnchorPoint(sourceObject, anchor) {
    const bounds = getRawBounds(sourceObject);

    if (!bounds) {
        return getObjectCenter(sourceObject);
    }

    const points = {
        top: {x: bounds.x + bounds.width / 2, y: bounds.y},
        right: {x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2},
        bottom: {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height},
        left: {x: bounds.x, y: bounds.y + bounds.height / 2},
    };

    return points[anchor] || getObjectCenter(sourceObject);
}

export function getNearestAnchor(sourceObject, targetPoint) {
    const anchors = ANCHORS.map(anchor => ({
        anchor,
        point: getAnchorPoint(sourceObject, anchor),
    }));

    anchors.sort((a, b) => (
        Math.hypot(a.point.x - targetPoint.x, a.point.y - targetPoint.y) -
        Math.hypot(b.point.x - targetPoint.x, b.point.y - targetPoint.y)
    ));

    return anchors[0]?.anchor || 'right';
}

function getConnectionPoint(sourceObject, targetObject, fixedAnchor = null) {
    if (fixedAnchor) {
        return getAnchorPoint(sourceObject, fixedAnchor);
    }

    const bounds = getRawBounds(sourceObject);
    const source = getObjectCenter(sourceObject);
    const target = getObjectCenter(targetObject);

    if (!bounds) {
        return source;
    }

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const halfWidth = Math.max(1, bounds.width / 2);
    const halfHeight = Math.max(1, bounds.height / 2);
    const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 1);

    return {
        x: source.x + dx * scale,
        y: source.y + dy * scale,
    };
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

    if (object.type === 'flow-decision') {
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
    if (object.type === 'rectangle' || object.type === 'flow-process') {
        const x = Math.min(object.x, object.x2);
        const y = Math.min(object.y, object.y2);
        const width = Math.abs(object.x2 - object.x);
        const height = Math.abs(object.y2 - object.y);

        return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    }

    if (object.type === 'ellipse' || object.type === 'flow-terminator' || object.type === 'mind-node') {
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

    if (object.type === 'diamond' || object.type === 'polygon' || object.type === 'flow-decision') {
        return isPointInsidePolygon(point, getShapePoints(object));
    }

    if (object.type === 'flow-database') {
        return isPointInBounds(point, getRawBounds(object), 0);
    }

    return false;
}

function fillObjectAt(point, fillColor) {
    const object = [...app.objects].reverse().find(item => !item.locked && isPointInsideFillableObject(point, item));

    if (!object) {
        return false;
    }

    saveHistory();
    object.fill = rgbaToCss(fillColor);
    app.selectedObjectId = object.id;
    app.selectedObjectIds = [object.id];
    render();
    broadcastBoardState();

    return {
        color: rgbaToCss(fillColor),
        objectId: object.id,
        objectType: object.type,
    };
}

function createLockedBadge(bounds) {
    const group = createSvgElement('g');
    const x = bounds.x + bounds.width + 12;
    const y = bounds.y + 12;

    group.appendChild(createSvgElement('circle', {
        cx: x,
        cy: y,
        r: 11,
        fill: '#0f172a',
        opacity: 0.88,
        'vector-effect': 'non-scaling-stroke',
    }));
    group.appendChild(createSvgElement('path', {
        d: `M ${x - 4} ${y - 1} V ${y - 4} C ${x - 4} ${y - 7} ${x + 4} ${y - 7} ${x + 4} ${y - 4} V ${y - 1} M ${x - 5} ${y - 1} H ${x + 5} V ${y + 6} H ${x - 5} Z`,
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': 1.7,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
    }));
    return group;
}

function createRemoteLockBadge(bounds, lock) {
    const group = createSvgElement('g');
    const user = lock.user || {};
    const color = user.color || '#64748b';
    const initials = user.initials || (user.name || 'User').slice(0, 2).toUpperCase();
    const x = bounds.x + bounds.width + 12;
    const y = bounds.y + bounds.height + 16;
    const text = `Locked by ${user.name || 'user'}`;

    group.appendChild(createSvgElement('rect', {
        x,
        y: y - 13,
        width: Math.max(96, text.length * 6.5 + 36),
        height: 26,
        rx: 13,
        ry: 13,
        fill: '#ffffff',
        stroke: color,
        'stroke-width': 1.5,
        'vector-effect': 'non-scaling-stroke',
    }));
    group.appendChild(createSvgElement('circle', {
        cx: x + 14,
        cy: y,
        r: 9,
        fill: color,
        stroke: '#ffffff',
        'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke',
    }));
    const initialsText = createSvgElement('text', {
        x: x + 14,
        y: y + 1,
        fill: '#ffffff',
        'font-size': 8,
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 850,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
    });
    initialsText.textContent = initials;
    group.appendChild(initialsText);
    const label = createSvgElement('text', {
        x: x + 30,
        y: y + 1,
        fill: '#334155',
        'font-size': 11,
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 800,
        'dominant-baseline': 'middle',
    });
    label.textContent = text;
    group.appendChild(label);

    return group;
}

function createResizeHandle(x, y, handle) {
    const size = Math.max(12, 12 / app.zoom.scale);

    return createSvgElement('rect', {
        x: x - size / 2,
        y: y - size / 2,
        width: size,
        height: size,
        rx: 3,
        ry: 3,
        fill: '#ffffff',
        stroke: '#2563eb',
        'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke',
        'data-resize-handle': handle,
    });
}

function createRotateHandle(bounds) {
    const size = Math.max(12, 12 / app.zoom.scale);
    const y = bounds.y - Math.max(34, 34 / app.zoom.scale);
    const x = bounds.x + bounds.width / 2;

    return createSvgElement('circle', {
        cx: x,
        cy: y,
        r: size / 2,
        fill: '#ffffff',
        stroke: '#2563eb',
        'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke',
        'data-rotate-handle': 'true',
    });
}

function getResizeHandlePoints(bounds) {
    return [
        {handle: 'nw', x: bounds.x, y: bounds.y},
        {handle: 'ne', x: bounds.x + bounds.width, y: bounds.y},
        {handle: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height},
        {handle: 'sw', x: bounds.x, y: bounds.y + bounds.height},
    ];
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

    const addCenteredLabel = (group, label, maxChars = 22) => {
        if (!label) {
            return;
        }

        const text = createSvgElement('text', {
            x: x + width / 2,
            y: y + height / 2,
            fill: object.textColor || '#0f172a',
            'font-size': object.fontSize || 16,
            'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': object.fontWeight || 750,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
        });
        wrapText(label, maxChars).slice(0, 3).forEach((line, index, lines) => {
            const tspan = createSvgElement('tspan', {
                x: x + width / 2,
                dy: index === 0 ? `${-(lines.length - 1) * 0.6}em` : '1.2em',
            });
            tspan.textContent = line;
            text.appendChild(tspan);
        });
        group.appendChild(text);
    };

    if (object.type === 'rectangle' || object.type === 'flow-process') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('rect', {
            ...common,
            x,
            y,
            width,
            height,
            rx: object.type === 'flow-process' ? 8 : undefined,
            ry: object.type === 'flow-process' ? 8 : undefined,
        }));
        addCenteredLabel(group, object.text);
        return group;
    }

    if (object.type === 'ellipse' || object.type === 'flow-terminator' || object.type === 'mind-node') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('ellipse', {
            ...common,
            cx: x + width / 2,
            cy: y + height / 2,
            rx: width / 2,
            ry: height / 2,
        }));
        addCenteredLabel(group, object.text);
        return group;
    }

    if (object.type === 'diamond' || object.type === 'flow-decision') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('polygon', {
            ...common,
            points: getShapePoints(object).map(point => `${point.x},${point.y}`).join(' '),
        }));
        addCenteredLabel(group, object.text, 16);
        return group;
    }

    if (object.type === 'polygon') {
        return createSvgElement('polygon', {
            ...common,
            points: getShapePoints(object).map(point => `${point.x},${point.y}`).join(' '),
        });
    }

    if (object.type === 'flow-database') {
        const curve = Math.min(26, height * 0.22);
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('path', {
            ...common,
            d: `M ${x} ${y + curve} C ${x} ${y - curve * 0.15} ${x + width} ${y - curve * 0.15} ${x + width} ${y + curve} V ${y + height - curve} C ${x + width} ${y + height + curve * 0.15} ${x} ${y + height + curve * 0.15} ${x} ${y + height - curve} Z`,
        }));
        group.appendChild(createSvgElement('path', {
            d: `M ${x} ${y + curve} C ${x} ${y + curve * 2.1} ${x + width} ${y + curve * 2.1} ${x + width} ${y + curve}`,
            fill: 'none',
            stroke: object.color,
            'stroke-width': object.lineWidth,
        }));
        addCenteredLabel(group, object.text);
        return group;
    }

    if (object.type === 'swimlane') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('rect', {
            ...common,
            x,
            y,
            width,
            height,
            rx: 8,
            ry: 8,
        }));
        group.appendChild(createSvgElement('rect', {
            x,
            y,
            width,
            height: Math.min(48, height * 0.22),
            rx: 8,
            ry: 8,
            fill: object.headerFill || 'rgba(15, 23, 42, 0.06)',
            stroke: 'none',
        }));
        const lanes = Math.max(2, object.lanes || 3);
        for (let index = 1; index < lanes; index += 1) {
            const lineX = x + width / lanes * index;
            group.appendChild(createSvgElement('line', {
                x1: lineX,
                y1: y + Math.min(48, height * 0.22),
                x2: lineX,
                y2: y + height,
                stroke: object.color,
                'stroke-width': 1.2,
                opacity: 0.45,
            }));
        }
        addCenteredLabel(group, object.title || 'Swimlane', 24);
        return group;
    }

    if (object.type === 'kanban') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('rect', {
            ...common,
            x,
            y,
            width,
            height,
            rx: 8,
            ry: 8,
        }));
        const columns = object.columns || ['To do', 'Doing', 'Done'];
        columns.forEach((column, index) => {
            const colX = x + width / columns.length * index;
            const colWidth = width / columns.length;
            if (index > 0) {
                group.appendChild(createSvgElement('line', {
                    x1: colX,
                    y1: y,
                    x2: colX,
                    y2: y + height,
                    stroke: object.color,
                    'stroke-width': 1,
                    opacity: 0.35,
                }));
            }
            const text = createSvgElement('text', {
                x: colX + colWidth / 2,
                y: y + 24,
                fill: object.textColor || '#0f172a',
                'font-size': 13,
                'font-family': 'Inter, system-ui, sans-serif',
                'font-weight': 800,
                'text-anchor': 'middle',
            });
            text.textContent = column;
            group.appendChild(text);
            group.appendChild(createSvgElement('rect', {
                x: colX + 12,
                y: y + 42,
                width: Math.max(24, colWidth - 24),
                height: 34,
                rx: 6,
                ry: 6,
                fill: '#ffffff',
                stroke: 'rgba(15, 23, 42, 0.12)',
                'stroke-width': 1,
            }));
        });
        return group;
    }

    if (object.type === 'template-frame') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('rect', {
            ...common,
            x,
            y,
            width,
            height,
            rx: 10,
            ry: 10,
            'stroke-dasharray': '10 7',
        }));
        const title = createSvgElement('text', {
            x: x + 16,
            y: y + 28,
            fill: object.textColor || '#334155',
            'font-size': 18,
            'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': 850,
        });
        title.textContent = object.title || 'Template';
        group.appendChild(title);
        (object.sections || []).forEach((section, index) => {
            const sectionWidth = width / Math.max(1, object.sections.length);
            const sectionX = x + sectionWidth * index + 12;
            const sectionLabel = createSvgElement('text', {
                x: sectionX,
                y: y + 62,
                fill: object.textColor || '#475569',
                'font-size': 13,
                'font-family': 'Inter, system-ui, sans-serif',
                'font-weight': 750,
            });
            sectionLabel.textContent = section;
            group.appendChild(sectionLabel);
            group.appendChild(createSvgElement('rect', {
                x: sectionX,
                y: y + 76,
                width: Math.max(20, sectionWidth - 24),
                height: Math.max(20, height - 94),
                rx: 8,
                ry: 8,
                fill: 'rgba(255, 255, 255, 0.62)',
                stroke: 'rgba(71, 85, 105, 0.16)',
                'stroke-width': 1,
            }));
        });
        return group;
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

    if (object.type === 'callout') {
        const group = createSvgElement('g');
        group.appendChild(createSvgElement('path', {
            d: `M ${object.x + 14} ${object.y} H ${object.x + object.width - 14} Q ${object.x + object.width} ${object.y} ${object.x + object.width} ${object.y + 14} V ${object.y + object.height - 14} Q ${object.x + object.width} ${object.y + object.height} ${object.x + object.width - 14} ${object.y + object.height} H ${object.x + 86} L ${object.x + 28} ${object.y + object.height + 24} L ${object.x + 46} ${object.y + object.height} H ${object.x + 14} Q ${object.x} ${object.y + object.height} ${object.x} ${object.y + object.height - 14} V ${object.y + 14} Q ${object.x} ${object.y} ${object.x + 14} ${object.y} Z`,
            fill: object.fill,
            stroke: object.stroke || 'rgba(15, 23, 42, 0.14)',
            'stroke-width': 2,
        }));
        createSvgTextLines(object, group, object.x, object.y, 20, 18);
        return group;
    }

    const group = createSvgElement('g');
    group.appendChild(createSvgElement('rect', {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rx: object.type === 'label' ? 18 : 14,
        ry: object.type === 'label' ? 18 : 14,
        fill: object.fill,
        stroke: object.stroke || 'rgba(15, 23, 42, 0.14)',
        'stroke-width': 2,
    }));

    if (object.type === 'list') {
        object.items.forEach((item, index) => {
            const lineY = object.y + 18 + index * object.fontSize * 1.35;
            group.appendChild(createSvgElement('circle', {
                cx: object.x + 18,
                cy: lineY + object.fontSize * 0.45,
                r: 3.5,
                fill: object.color,
            }));
            const text = createSvgElement('text', {
                x: object.x + 32,
                y: lineY,
                fill: object.color,
                'font-size': object.fontSize,
                'font-family': 'Inter, system-ui, sans-serif',
                'font-weight': object.fontWeight || 600,
                'dominant-baseline': 'text-before-edge',
            });
            text.textContent = item;
            group.appendChild(text);
        });
        return group;
    }

    createSvgTextLines(object, group, object.x, object.y, object.type === 'label' ? 18 : 18, object.type === 'label' ? 12 : 18);
    return group;
}

function createSvgFrameObject(object) {
    const bounds = getBounds(object);
    const group = createSvgElement('g');
    group.appendChild(createSvgElement('rect', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fill: object.fill || 'rgba(255, 255, 255, 0.18)',
        stroke: object.color || '#475569',
        'stroke-width': 2,
        'stroke-dasharray': '14 8',
        'vector-effect': 'non-scaling-stroke',
    }));
    const text = createSvgElement('text', {
        x: bounds.x + 12,
        y: bounds.y - 10,
        fill: object.color || '#475569',
        'font-size': 18,
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': 700,
    });
    text.textContent = object.title || 'Frame';
    group.appendChild(text);
    return group;
}

function createSvgCommentObject(object) {
    const group = createSvgElement('g');
    group.appendChild(createSvgElement('rect', {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rx: 12,
        ry: 12,
        fill: object.fill || '#fff7ed',
        stroke: object.stroke || '#fb923c',
        'stroke-width': 2,
    }));
    createSvgTextLines(object, group, object.x, object.y, 26, 14);
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

function createSvgImageObject(object) {
    return createSvgElement('image', {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        href: object.src,
        preserveAspectRatio: 'xMidYMid meet',
    });
}

function createSvgConnector(object) {
    const endpoints = getConnectorEndpoints(object);
    const horizontalDistance = Math.abs(endpoints.to.x - endpoints.from.x);
    const verticalDistance = Math.abs(endpoints.to.y - endpoints.from.y);
    const routePoints = object.connectorStyle === 'straight' || horizontalDistance < 12 || verticalDistance < 12
        ? [endpoints.from, endpoints.to]
        : [
            endpoints.from,
            {x: endpoints.from.x + (endpoints.to.x - endpoints.from.x) / 2, y: endpoints.from.y},
            {x: endpoints.from.x + (endpoints.to.x - endpoints.from.x) / 2, y: endpoints.to.y},
            endpoints.to,
        ];
    const pathData = routePoints
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');
    const group = createSvgElement('g');
    object.route = routePoints.map(point => ({x: Math.round(point.x), y: Math.round(point.y)}));

    group.appendChild(createSvgElement('path', {
        d: pathData,
        fill: 'none',
        stroke: object.color,
        'stroke-width': object.lineWidth || 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    }));

    if (object.endMarker !== 'none') {
        const previousPoint = routePoints[routePoints.length - 2] || endpoints.from;
        const angle = Math.atan2(endpoints.to.y - previousPoint.y, endpoints.to.x - previousPoint.x);
        const size = Math.max(12, (object.lineWidth || 3) * 3.2);
        const arrowPoints = [
            endpoints.to,
            {
                x: endpoints.to.x - size * Math.cos(angle - Math.PI / 6),
                y: endpoints.to.y - size * Math.sin(angle - Math.PI / 6),
            },
            {
                x: endpoints.to.x - size * Math.cos(angle + Math.PI / 6),
                y: endpoints.to.y - size * Math.sin(angle + Math.PI / 6),
            },
        ];
        group.appendChild(createSvgElement('polygon', {
            points: arrowPoints.map(point => `${point.x},${point.y}`).join(' '),
            fill: object.color,
        }));
    }

    if (object.label) {
        const labelPoint = routePoints[Math.floor(routePoints.length / 2)] || {
            x: (endpoints.from.x + endpoints.to.x) / 2,
            y: (endpoints.from.y + endpoints.to.y) / 2,
        };
        const text = createSvgElement('text', {
            x: labelPoint.x,
            y: labelPoint.y - 8,
            fill: object.textColor || object.color,
            'font-size': object.fontSize || 14,
            'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': 750,
            'text-anchor': 'middle',
            'paint-order': 'stroke',
            stroke: '#ffffff',
            'stroke-width': 4,
        });
        text.textContent = object.label;
        group.appendChild(text);
    }

    return group;
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

function createSvgSelectionBounds(bounds) {
    if (!bounds) {
        return null;
    }

    const group = createSvgElement('g');
    group.appendChild(createSvgElement('rect', {
        x: bounds.x - 8,
        y: bounds.y - 8,
        width: bounds.width + 16,
        height: bounds.height + 16,
        fill: 'none',
        stroke: '#2563eb',
        'stroke-width': 2,
        'stroke-dasharray': '8 6',
        'vector-effect': 'non-scaling-stroke',
    }));
    getResizeHandlePoints(bounds).forEach(point => {
        group.appendChild(createResizeHandle(point.x, point.y, point.handle));
    });
    group.appendChild(createRotateHandle(bounds));
    return group;
}

function createSvgPresenceBadges() {
    const group = createSvgElement('g');

    app.collaborators.forEach(user => {
        const selectedObjects = app.objects.filter(object => user.selectedObjectIds?.includes(object.id));
        const bounds = getObjectsBounds(selectedObjects);

        if (!bounds) {
            return;
        }

        const x = bounds.x + bounds.width + 12;
        const y = bounds.y - 10;
        group.appendChild(createSvgElement('circle', {
            cx: x,
            cy: y,
            r: 13,
            fill: user.color,
            stroke: '#ffffff',
            'stroke-width': 3,
            'vector-effect': 'non-scaling-stroke',
        }));
        const label = createSvgElement('text', {
            x,
            y: y + 1,
            fill: '#ffffff',
            'font-size': 10,
            'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': 850,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
        });
        label.textContent = user.initials;
        group.appendChild(label);
    });

    return group;
}

function appendSvgObject(object, parent = app.svg) {
    let element = null;

    if (object.type === 'bitmap') {
        element = createSvgBitmap(object);
    } else if (object.type === 'image') {
        element = createSvgImageObject(object);
    } else if (object.type === 'connector') {
        element = createSvgConnector(object);
    } else if (object.type === 'path') {
        element = createSvgPath(object);
    } else if (SHAPE_TYPES.includes(object.type)) {
        element = createSvgShape(object);
    } else if (['text', 'sticky', 'callout', 'list', 'label'].includes(object.type)) {
        element = createSvgTextObject(object);
    } else if (object.type === 'frame') {
        element = createSvgFrameObject(object);
    } else if (object.type === 'comment') {
        element = createSvgCommentObject(object);
    }

    if (!element) {
        return;
    }

    setSvgAttrs(element, {
        'data-object-id': object.id,
        'data-object-type': object.type,
        opacity: object.type !== 'path' ? object.opacity : undefined,
        transform: getRotationTransform(object),
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

    const selectedObjects = showSelection ? getSelectedObjects() : [];
    const selection = selectedObjects.length > 1
        ? createSvgSelectionBounds(getObjectsBounds(selectedObjects))
        : selectedObjects.length === 1
            ? createSvgSelectionBounds(getBounds(selectedObjects[0]))
            : null;

    if (selection) {
        app.svg.appendChild(selection);
    }
    app.objects.forEach(object => {
        const bounds = object.locked ? getBounds(object) : null;

        if (bounds) {
            app.svg.appendChild(createLockedBadge(bounds));
        }
    });
    app.objects.forEach(object => {
        const lock = app.objectLocks.get(object.id);
        const bounds = lock && lock.clientId !== app.clientId && (!lock.expiresAt || lock.expiresAt > Date.now())
            ? getBounds(object)
            : null;

        if (bounds) {
            app.svg.appendChild(createRemoteLockBadge(bounds, lock));
        }
    });
    app.svg.appendChild(createSvgPresenceBadges());

    if (app.lassoBounds) {
        const lasso = createSvgElement('rect', {
            x: app.lassoBounds.x,
            y: app.lassoBounds.y,
            width: app.lassoBounds.width,
            height: app.lassoBounds.height,
            fill: 'rgba(37, 99, 235, 0.08)',
            stroke: '#2563eb',
            'stroke-width': 1.5,
            'stroke-dasharray': '6 6',
            'vector-effect': 'non-scaling-stroke',
        });
        app.svg.appendChild(lasso);
    }
}

export function render(showSelection = true) {
    renderSvg(showSelection);
    window.whiteboardUpdateMinimap?.();
    window.whiteboardUpdateRemoteLasers?.();
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
    const isFlow = FLOW_SHAPE_TYPES.includes(type);
    const isDiagram = DIAGRAM_OBJECT_TYPES.includes(type);
    const templatePresets = {
        retro: {title: 'Retro', sections: ['Went well', 'Needs work', 'Actions']},
        journey: {title: 'User journey', sections: ['Discover', 'Evaluate', 'Use', 'Improve']},
        architecture: {title: 'Architecture sketch', sections: ['Client', 'Services', 'Data']},
        brainstorming: {title: 'Brainstorming', sections: ['Ideas', 'Themes', 'Next steps']},
    };

    if (type.startsWith('template-')) {
        const template = type.replace('template-', '');
        const preset = templatePresets[template] || {title: 'Template', sections: ['Notes', 'Decisions']};
        return {
            id: createId('template-frame'),
            type: 'template-frame',
            template,
            x: point.x,
            y: point.y,
            x2: point.x,
            y2: point.y,
            color: '#64748b',
            fill: 'rgba(248, 250, 252, 0.72)',
            lineWidth: 2,
            ...preset,
        };
    }

    return {
        id: createId(type),
        type,
        x: point.x,
        y: point.y,
        x2: point.x,
        y2: point.y,
        color: isFlow || isDiagram ? '#475569' : color,
        fill: isFlow || isDiagram ? 'rgba(248, 250, 252, 0.86)' : undefined,
        lineWidth: isFlow || isDiagram ? Math.max(2, Math.round(lineWidth * 0.25)) : lineWidth,
        text: {
            'flow-process': 'Process',
            'flow-decision': 'Decision',
            'flow-terminator': 'Start / end',
            'flow-database': 'Database',
            'mind-node': 'Mind node',
        }[type],
        title: type === 'swimlane' ? 'Swimlane' : undefined,
        lanes: type === 'swimlane' ? 3 : undefined,
        columns: type === 'kanban' ? ['To do', 'Doing', 'Done'] : undefined,
    };
}

export function createFrame(point, title = 'Frame') {
    return {
        id: createId('frame'),
        type: 'frame',
        x: point.x,
        y: point.y,
        x2: point.x,
        y2: point.y,
        width: 0,
        height: 0,
        color: '#475569',
        fill: 'rgba(255, 255, 255, 0.18)',
        title,
    };
}

export function createComment(point, text) {
    return {
        id: createId('comment'),
        type: 'comment',
        x: point.x,
        y: point.y,
        width: 240,
        height: 118,
        fill: '#fff7ed',
        stroke: '#fb923c',
        color: '#7c2d12',
        fontSize: 15,
        fontWeight: 650,
        text,
    };
}

export function createImageObject(point, src, width, height) {
    const maxWidth = 520;
    const scale = width > maxWidth ? maxWidth / width : 1;

    return {
        id: createId('image'),
        type: 'image',
        x: point.x,
        y: point.y,
        width: Math.max(80, Math.round(width * scale)),
        height: Math.max(60, Math.round(height * scale)),
        src,
    };
}

export function createConnector(fromObject, toObject, color = app.fillColor) {
    const from = getObjectCenter(fromObject);
    const to = getObjectCenter(toObject);
    const fromAnchor = getNearestAnchor(fromObject, to);
    const toAnchor = getNearestAnchor(toObject, from);

    return {
        id: createId('connector'),
        type: 'connector',
        fromId: fromObject.id,
        toId: toObject.id,
        fromAnchor,
        toAnchor,
        x: from.x,
        y: from.y,
        x2: to.x,
        y2: to.y,
        color,
        lineWidth: Math.max(3, Math.round(app.lineWidth * 0.45)),
        connectorStyle: 'orthogonal',
        endMarker: 'arrow',
        label: '',
        route: [],
    };
}

export function deleteObjectById(id) {
    const object = app.objects.find(item => item.id === id);

    if (!object) {
        return null;
    }

    if (object.locked) {
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
    app.selectedObjectIds = [];
    render();
    broadcastBoardState();

    return object;
}

export function deleteObjectsByIds(ids) {
    const idSet = new Set(ids);
    const deletedObjects = app.objects.filter(object => idSet.has(object.id) && !object.locked);

    if (!deletedObjects.length) {
        return [];
    }

    saveHistory();
    app.objects = app.objects.filter(item => {
        if (idSet.has(item.id) && !item.locked) {
            return false;
        }

        return !item.linkedObjectIds?.some(id => idSet.has(id));
    });
    app.selectedObjectId = null;
    app.selectedObjectIds = [];
    render();
    broadcastBoardState();
    return deletedObjects;
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

export function createCallout(point, text) {
    return {
        id: createId('callout'),
        type: 'callout',
        x: point.x,
        y: point.y,
        width: 280,
        height: 112,
        fill: '#e0f2fe',
        stroke: '#38bdf8',
        color: '#0c4a6e',
        fontSize: 19,
        fontWeight: 650,
        text,
    };
}

export function createList(point, text) {
    const items = text
        .split(/\n|,/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);

    return {
        id: createId('list'),
        type: 'list',
        x: point.x,
        y: point.y,
        width: 280,
        height: Math.max(92, 36 + items.length * 26),
        fill: '#f8fafc',
        stroke: '#cbd5e1',
        color: '#0f172a',
        fontSize: 18,
        fontWeight: 600,
        text: items.join(', '),
        items,
    };
}

export function createLabel(point, text) {
    return {
        id: createId('label'),
        type: 'label',
        x: point.x,
        y: point.y,
        width: Math.max(96, Math.min(260, text.length * 10 + 28)),
        height: 38,
        fill: '#ffffff',
        stroke: '#94a3b8',
        color: '#334155',
        fontSize: 16,
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

export function duplicateObject(id) {
    const object = app.objects.find(item => item.id === id);

    if (!object || object.locked) {
        return null;
    }

    saveHistory();
    const duplicate = cloneObject(object);
    duplicate.id = createId(object.type);
    moveSingleObject(duplicate, 32, 32);
    app.objects.push(duplicate);
    app.selectedObjectId = duplicate.id;
    app.selectedObjectIds = [duplicate.id];
    render();
    broadcastBoardState();

    return duplicate;
}

export function duplicateObjects(objects) {
    const duplicableObjects = objects.filter(object => !object.locked);

    if (!duplicableObjects.length) {
        return [];
    }

    saveHistory();
    const duplicatedObjects = duplicableObjects.map(object => {
        const duplicate = cloneObject(object);
        duplicate.id = createId(object.type);
        moveSingleObject(duplicate, 32, 32);
        return duplicate;
    });
    app.objects.push(...duplicatedObjects);
    app.selectedObjectIds = duplicatedObjects.map(object => object.id);
    app.selectedObjectId = app.selectedObjectIds[0] || null;
    render();
    broadcastBoardState();
    return duplicatedObjects;
}

export function moveObjectLayer(id, direction) {
    const index = app.objects.findIndex(object => object.id === id);

    if (index === -1) {
        return null;
    }

    const targetIndex = direction === 'forward' ? Math.min(app.objects.length - 1, index + 1) : Math.max(0, index - 1);

    if (targetIndex === index) {
        return null;
    }

    saveHistory();
    const [object] = app.objects.splice(index, 1);
    app.objects.splice(targetIndex, 0, object);
    render();
    broadcastBoardState();

    return object;
}

export function setObjectsLocked(objects, locked) {
    if (!objects.length) {
        return false;
    }

    saveHistory();
    objects.forEach(object => {
        object.locked = locked;
    });
    render();
    broadcastBoardState();
    return true;
}

export function groupObjects(objects) {
    if (objects.length < 2) {
        return null;
    }

    const groupId = createId('group');
    saveHistory();
    objects.forEach(object => {
        object.groupId = groupId;
    });
    render();
    broadcastBoardState();
    return groupId;
}

export function ungroupObjects(objects) {
    const groupIds = new Set(objects.map(object => object.groupId).filter(Boolean));

    if (!groupIds.size) {
        return false;
    }

    saveHistory();
    app.objects.forEach(object => {
        if (groupIds.has(object.groupId)) {
            object.groupId = null;
        }
    });
    render();
    broadcastBoardState();
    return true;
}

export function rotateObjects(objects, startRotations, angleDelta) {
    objects.forEach(object => {
        object.rotation = Math.round(((startRotations.get(object.id) || 0) + angleDelta) * 10) / 10;
    });
}

export function normalizeFrame(object) {
    if (object.type !== 'frame' || !('x2' in object)) {
        return;
    }

    const x = Math.min(object.x, object.x2);
    const y = Math.min(object.y, object.y2);
    object.width = Math.abs(object.x2 - object.x);
    object.height = Math.abs(object.y2 - object.y);
    object.x = x;
    object.y = y;
    delete object.x2;
    delete object.y2;
}

function getExportBounds() {
    const selectedFrame = app.objects.find(object => object.id === app.selectedObjectId && object.type === 'frame');
    const selectedObjects = getSelectedObjects();
    const selectedBounds = selectedObjects.length ? getObjectsBounds(selectedObjects) : null;
    const bounds = selectedFrame ? getBounds(selectedFrame) : selectedBounds || getObjectsBounds();
    const padding = 48;
    const isExactExport = Boolean(selectedFrame || selectedBounds);

    if (!bounds) {
        return {
            x: 0,
            y: 0,
            width: Math.min(app.board.width, 1600),
            height: Math.min(app.board.height, 1000),
        };
    }

    return {
        x: Math.max(0, Math.floor(bounds.x - (isExactExport ? 0 : padding))),
        y: Math.max(0, Math.floor(bounds.y - (isExactExport ? 0 : padding))),
        width: Math.ceil(bounds.width + (isExactExport ? 0 : padding * 2)),
        height: Math.ceil(bounds.height + (isExactExport ? 0 : padding * 2)),
    };
}

function imageFromSvg(svgText) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([svgText], {type: 'image/svg+xml'}));
        image.addEventListener('load', () => {
            URL.revokeObjectURL(url);
            resolve(image);
        });
        image.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            reject(new Error('Unable to render SVG export'));
        });
        image.src = url;
    });
}

async function createExportCanvas() {
    render(false);
    const bounds = getExportBounds();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(bounds.width, app.board.width - bounds.x);
    canvas.height = Math.min(bounds.height, app.board.height - bounds.y);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const svgText = new XMLSerializer().serializeToString(app.svg);
    const image = await imageFromSvg(svgText);
    context.drawImage(
        image,
        bounds.x,
        bounds.y,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
    );

    render();
    return canvas;
}

function canvasToBlob(canvas) {
    return new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png');
    });
}

export async function exportBoardPng() {
    const canvas = await createExportCanvas();
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `whiteboard-${app.roomId || 'board'}.png`;
    link.click();
}

export async function copyBoardImage() {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        return false;
    }

    const canvas = await createExportCanvas();
    const blob = await canvasToBlob(canvas);

    if (!blob) {
        return false;
    }

    await navigator.clipboard.write([
        new ClipboardItem({
            [blob.type]: blob,
        }),
    ]);
    return true;
}

function getExportSvgText() {
    render(false);
    const bounds = getExportBounds();
    const clone = app.svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', Math.min(bounds.width, app.board.width - bounds.x));
    clone.setAttribute('height', Math.min(bounds.height, app.board.height - bounds.y));
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${Math.min(bounds.width, app.board.width - bounds.x)} ${Math.min(bounds.height, app.board.height - bounds.y)}`);
    clone.style.background = '#fff';
    const svgText = new XMLSerializer().serializeToString(clone);
    render();
    return svgText;
}

export function exportBoardSvg() {
    const svgText = getExportSvgText();
    const url = URL.createObjectURL(new Blob([svgText], {type: 'image/svg+xml'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `whiteboard-${app.roomId || 'board'}.svg`;
    link.click();
    URL.revokeObjectURL(url);
}

export function exportBoardPdf() {
    const svgText = getExportSvgText();
    const url = URL.createObjectURL(new Blob([svgText], {type: 'image/svg+xml'}));
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');

    if (!printWindow) {
        URL.revokeObjectURL(url);
        return false;
    }

    printWindow.document.write(`
        <!doctype html>
        <html lang="en">
        <head>
            <title>Whiteboard PDF</title>
            <style>
                html, body { margin: 0; min-height: 100%; background: #fff; }
                img { display: block; width: 100%; height: auto; }
                @page { margin: 12mm; }
            </style>
        </head>
        <body>
            <img src="${url}" alt="Whiteboard export">
            <script>
                window.onload = () => {
                    window.print();
                    setTimeout(() => window.close(), 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
}

function moveSingleObject(object, dx, dy) {
    if (object.locked) {
        return;
    }

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

export function moveObjects(objects, dx, dy) {
    const objectsToMove = new Set(objects);

    objects.forEach(object => {
        if (object.linkedObjectIds?.length) {
            app.objects
                .filter(item => object.linkedObjectIds.includes(item.id))
                .forEach(item => objectsToMove.add(item));
        }

        app.objects
            .filter(item => item.linkedObjectIds?.includes(object.id))
            .forEach(item => objectsToMove.add(item));
    });

    objectsToMove.forEach(object => moveSingleObject(object, dx, dy));
}

export function resizeObjects(objects, startBounds, nextBounds) {
    const minSize = 12;
    const width = Math.max(minSize, nextBounds.width);
    const height = Math.max(minSize, nextBounds.height);
    const scaleX = startBounds.width ? width / startBounds.width : 1;
    const scaleY = startBounds.height ? height / startBounds.height : 1;

    objects.forEach(({object, bounds, original, points}) => {
        if (object.locked) {
            return;
        }

        const mapX = value => nextBounds.x + (value - startBounds.x) * scaleX;
        const mapY = value => nextBounds.y + (value - startBounds.y) * scaleY;

        if (object.points) {
            object.points.forEach((point, index) => {
                const originalPoint = points[index];
                point.x = mapX(originalPoint.x);
                point.y = mapY(originalPoint.y);
            });
            return;
        }

        if ('x2' in object) {
            object.x = mapX(original.x);
            object.y = mapY(original.y);
            object.x2 = mapX(original.x2);
            object.y2 = mapY(original.y2);
            return;
        }

        object.x = mapX(bounds.x);
        object.y = mapY(bounds.y);
        object.width = Math.max(minSize, bounds.width * scaleX);
        object.height = Math.max(minSize, bounds.height * scaleY);
    });
}

export function findObjectAt(point) {
    for (const object of [...app.objects].reverse()) {
        if (isPointInsideObject(point, object)) {
            return object;
        }
    }

    return null;
}

export function draw() {
    if (!app.isDrawing || !app.draftObject || app.draftObject.type !== 'path') {
        return;
    }

    const point = getCanvasPoint(app.mouse.x, app.mouse.y);
    const previousPoint = app.draftObject.points[app.draftObject.points.length - 1];

    if (previousPoint && distanceBetweenPoints(previousPoint, point) < Math.max(1.6, app.draftObject.lineWidth * 0.18)) {
        return;
    }

    app.draftObject.points.push(point);
    render();
}

export function erasePathAt(point, radius = app.lineWidth) {
    const eraseRadius = Math.max(6, radius);
    const nextObjects = [];
    let changed = false;

    app.objects.forEach(object => {
        if (object.type !== 'path' || object.locked) {
            nextObjects.push(object);
            return;
        }

        const segments = [];
        let currentSegment = [];
        let pathChanged = false;

        object.points.forEach(pathPoint => {
            if (distanceBetweenPoints(pathPoint, point) <= eraseRadius + object.lineWidth / 2) {
                if (currentSegment.length >= 2) {
                    segments.push(currentSegment);
                }
                currentSegment = [];
                pathChanged = true;
                changed = true;
                return;
            }

            currentSegment.push({...pathPoint});
        });

        if (currentSegment.length >= 2) {
            segments.push(currentSegment);
        }

        if (!pathChanged || segments.length === 1 && segments[0].length === object.points.length) {
            nextObjects.push(object);
            return;
        }

        segments.forEach((points, index) => {
            nextObjects.push({
                ...object,
                id: index === 0 ? object.id : createId('path'),
                points,
            });
        });
    });

    if (!changed) {
        return false;
    }

    app.objects = nextObjects;
    render();
    broadcastBoardState();
    return true;
}

function cleanupFillMask(mask, width, height, minX, minY, maxX, maxY) {
    const pixelsToClear = [];

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            const index = py * width + px;

            if (!mask[index]) {
                continue;
            }

            let neighbors = 0;

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) {
                        continue;
                    }

                    const nx = px + dx;
                    const ny = py + dy;

                    if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) {
                        neighbors++;
                    }
                }
            }

            if (neighbors < FILL_EDGE_CLEANUP_MIN_NEIGHBORS) {
                pixelsToClear.push(index);
            }
        }
    }

    pixelsToClear.forEach(index => {
        mask[index] = 0;
    });
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

    cleanupFillMask(filledPixels, width, height, minX, minY, maxX, maxY);
    minX = width;
    minY = height;
    maxX = 0;
    maxY = 0;
    filledCount = 0;

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            if (!filledPixels[py * width + px]) {
                continue;
            }

            filledCount++;
            minX = Math.min(minX, px);
            minY = Math.min(minY, py);
            maxX = Math.max(maxX, px);
            maxY = Math.max(maxY, py);
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
    app.selectedObjectId = bitmapObject.id;
    app.selectedObjectIds = [bitmapObject.id];
    render();
    broadcastBoardState();

    return {
        color: rgbaToCss(fillColor),
        objectId: bitmapObject.id,
        objectType: linkedObjectIds.length ? 'path' : 'bitmap',
    };
}
