import {app} from './main.js';

export function hexToRgba(hex) {
    // Usuń ewentualny znak '#' na początku
    hex = hex.replace(/^#/, '');

    // Sprawdź, czy podany kolor ma format #RRGGBB lub #RRGGBBAA
    if (hex.length === 6) {
        return [
            parseInt(hex.slice(0, 2), 16), // Składowa R
            parseInt(hex.slice(2, 4), 16), // Składowa G
            parseInt(hex.slice(4, 6), 16), // Składowa B
            255, // Domyślna wartość dla składowej A (255 = pełna nieprzezroczystość)
        ];
    } else if (hex.length === 8) {
        return [
            parseInt(hex.slice(0, 2), 16), // Składowa R
            parseInt(hex.slice(2, 4), 16), // Składowa G
            parseInt(hex.slice(4, 6), 16), // Składowa B
            parseInt(hex.slice(6, 8), 16),  // Składowa A
        ];
    } else {
        // Jeśli format koloru jest niepoprawny, zwróć domyślny kolor czarny
        return [0, 0, 0, 255];
    }
}

export function getCanvasTransform() {
    return `scale(${app.zoom.scale}) translate(${app.zoom.offsetX}px, ${app.zoom.offsetY}px)`;
}
