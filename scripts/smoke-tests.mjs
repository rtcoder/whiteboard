import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
    applyBoardOperation,
    getOversizedBitmapIds,
    getLockConflicts,
    getOperationObjectIds,
    mergeBoardState,
    updateObjectLocks,
} = require('../server.js');

const schemaSource = await readFile(new URL('../js/schema.js', import.meta.url), 'utf8');
const schemaModuleSource = `${schemaSource}
export {CURRENT_SCHEMA_VERSION, migrateObject, migrateObjects};
`
    .replace('export const CURRENT_SCHEMA_VERSION', 'const CURRENT_SCHEMA_VERSION')
    .replaceAll('export function ', 'function ');
const schemaModule = await import(`data:text/javascript;base64,${Buffer.from(schemaModuleSource).toString('base64')}`);
const {CURRENT_SCHEMA_VERSION, migrateObject, migrateObjects} = schemaModule;

const legacyRectangle = migrateObject({
    id: 'rectangle-old',
    type: 'rectangle',
    x: 10,
    y: 20,
    x2: 120,
    y2: 80,
    color: '#2563eb',
});

assert.equal(legacyRectangle.schemaVersion, CURRENT_SCHEMA_VERSION);
assert.equal(legacyRectangle.locked, false);
assert.equal(legacyRectangle.groupId, null);
assert.equal(legacyRectangle.rotation, 0);

const legacyConnector = migrateObject({
    id: 'connector-old',
    type: 'connector',
    fromId: 'a',
    toId: 'b',
    color: '#0f172a',
});

assert.equal(legacyConnector.connectorStyle, 'orthogonal');
assert.equal(legacyConnector.endMarker, 'arrow');
assert.equal(legacyConnector.lineWidth, 3);
assert.equal(legacyConnector.label, '');
assert.deepEqual(legacyConnector.route, []);

const migratedObjects = migrateObjects([
    {id: 'path-old', type: 'path', points: []},
    {id: 'image-old', type: 'image', x: 0, y: 0, width: 10, height: 10},
    {id: 'flow-old', type: 'flow-process', x: 0, y: 0, x2: 120, y2: 80},
    {id: 'freeform-old', type: 'freeform', points: [{x: 0, y: 0}, {x: 10, y: 0}, {x: 0, y: 10}]},
]);

assert.equal(migratedObjects.length, 4);
assert.ok(migratedObjects.every(object => object.schemaVersion === CURRENT_SCHEMA_VERSION));
assert.equal(migratedObjects[3].closed, true);
assert.equal(migratedObjects[3].fill, 'transparent');

const mergedState = mergeBoardState(
    [{id: 'a', type: 'rectangle', color: '#111'}],
    [{id: 'a', type: 'rectangle', color: '#222'}, {id: 'b', type: 'ellipse'}],
);
assert.deepEqual(mergedState.map(object => object.id), ['a', 'b']);
assert.equal(mergedState[0].color, '#222');

const operation = {
    kind: 'object-created',
    upsert: [{id: 'c', type: 'text'}],
    deleteIds: ['a'],
    orderIds: ['b', 'c'],
};
const operatedState = applyBoardOperation(mergedState, operation);
assert.deepEqual(operatedState.map(object => object.id), ['b', 'c']);
assert.deepEqual(getOperationObjectIds(operation, mergedState, operatedState).sort(), ['a', 'b', 'c']);

const mockRoom = {
    clients: [{clientId: 'one'}, {clientId: 'two'}],
    objectLocks: new Map(),
};
const mockSocket = {
    clientId: 'one',
    user: {id: 'one', name: 'Ada'},
};
assert.deepEqual(updateObjectLocks(mockRoom, mockSocket, ['b']), []);
assert.deepEqual(getLockConflicts(mockRoom, 'two', ['b']), ['b']);
assert.deepEqual(getLockConflicts(mockRoom, 'one', ['b']), []);

assert.deepEqual(getOversizedBitmapIds([
    {id: 'small-bitmap', type: 'bitmap', width: 100, height: 100},
    {id: 'large-bitmap', type: 'bitmap', width: 2000, height: 1000},
    {id: 'shape', type: 'rectangle', width: 5000, height: 5000},
]), ['large-bitmap']);

console.log('Smoke tests passed');
