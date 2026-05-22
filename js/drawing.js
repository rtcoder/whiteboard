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

export function floodFill(x, y, fillColor) {
    x = Math.floor(x * (1 / app.zoom.scale));
    y = Math.floor(y * (1 / app.zoom.scale));

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

    app.ctx.putImageData(imageData, 0, 0);
}
