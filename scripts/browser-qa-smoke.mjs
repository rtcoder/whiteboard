import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styleCss = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const mainJs = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const networkJs = await readFile(new URL('../js/network.js', import.meta.url), 'utf8');

const requiredMarkup = [
    'id="lobbyTitle"',
    'id="userName"',
    'id="boardName"',
    'id="roomAccessChoice"',
    'value="open"',
    'value="closed"',
    'class="join-request-stack"',
    'class="connection-status"',
    'class="activity-toggle"',
    'class="share-button"',
    'id="whiteboardSvg"',
];

for (const snippet of requiredMarkup) {
    assert.ok(indexHtml.includes(snippet), `Missing expected markup: ${snippet}`);
}

const requiredStyles = [
    '.join-request-stack',
    '.join-request-card',
    '.join-request-actions .accept',
    '.lobby-panel.is-join-mode',
    '.connection-status[data-state="offline"]',
    '.toolbar',
    '.activity-panel',
    '.properties-panel',
];

for (const snippet of requiredStyles) {
    assert.ok(styleCss.includes(snippet), `Missing expected style: ${snippet}`);
}

const requiredClientFlow = [
    'requestRoomAccess',
    'waitForJoinApproval',
    'getRoomAccessTokenKey',
    'setupLobby({',
    'roomMeta?.accessMode',
];

for (const snippet of requiredClientFlow) {
    assert.ok(mainJs.includes(snippet), `Missing expected lobby flow code: ${snippet}`);
}

const requiredNetworkFlow = [
    'showJoinRequest',
    'updateJoinRequest',
    'NetworkMessageType.JoinRequest',
    'whiteboard:accessToken',
];

for (const snippet of requiredNetworkFlow) {
    assert.ok(networkJs.includes(snippet), `Missing expected network flow code: ${snippet}`);
}

console.log('Browser QA smoke checks passed');
console.log('');
console.log('Manual browser QA checklist:');
console.log('- Create an open room and join it by link and by meeting code.');
console.log('- Create a closed room, request access from a second window, accept, and verify the guest joins.');
console.log('- Repeat closed room flow with Deny and verify the guest stays on the join screen.');
console.log('- Draw, fill, move, delete, undo, and redo with two windows connected.');
console.log('- Use the laser pointer and verify the remote cursor is hidden while laser is active.');
console.log('- Export PNG, SVG, and PDF from full board, selection, and frame.');
console.log('- Check mobile width for toolbar, activity, pending join request card, and properties panel.');
