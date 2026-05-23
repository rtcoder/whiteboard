import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Buffer} from 'node:buffer';

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

const migratedObjects = migrateObjects([
    {id: 'path-old', type: 'path', points: []},
    {id: 'image-old', type: 'image', x: 0, y: 0, width: 10, height: 10},
]);

assert.equal(migratedObjects.length, 2);
assert.ok(migratedObjects.every(object => object.schemaVersion === CURRENT_SCHEMA_VERSION));

console.log('Smoke tests passed');
