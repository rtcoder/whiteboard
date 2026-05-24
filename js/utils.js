import {app} from './main.js';

export function hexToRgba(hex) {
    hex = hex.replace(/^#/, '');

    if (hex.length === 6) {
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            255,
        ];
    } else if (hex.length === 8) {
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            parseInt(hex.slice(6, 8), 16),
        ];
    } else {
        return [0, 0, 0, 255];
    }
}

export function getCanvasTransform() {
    return `scale(${app.zoom.scale}) translate(${app.zoom.offsetX}px, ${app.zoom.offsetY}px)`;
}

export function getCanvasPoint(x, y) {
    return {
        x: x / app.zoom.scale - app.zoom.offsetX,
        y: y / app.zoom.scale - app.zoom.offsetY,
    };
}

export function clampZoomOffset() {
    const maxOffsetX = Math.max(0, app.board.width - window.innerWidth / app.zoom.scale);
    const maxOffsetY = Math.max(0, app.board.height - window.innerHeight / app.zoom.scale);

    app.zoom.offsetX = Math.min(0, Math.max(-maxOffsetX, app.zoom.offsetX));
    app.zoom.offsetY = Math.min(0, Math.max(-maxOffsetY, app.zoom.offsetY));
}

export function createId(prefix = 'object') {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getUserAvatar(name, seed = '') {
    const normalizedName = name.trim() || 'Guest';
    const normalizedSeed = seed || normalizedName;
    const initials = normalizedName
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase();

    let hash = 0;
    for (let index = 0; index < normalizedSeed.length; index++) {
        hash = normalizedSeed.charCodeAt(index) + ((hash << 5) - hash);
        hash |= 0;
    }

    const hue = Math.abs(hash) % 360;

    return {
        initials,
        color: `hsl(${hue}, 78%, 46%)`,
    };
}
