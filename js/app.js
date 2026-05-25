import {ConnectionStatus} from './enums/connection-status.js';
import {ToolType} from './enums/tool-type.js';
import {getUserAvatar} from './utils.js';

const storedUserName = localStorage.getItem('whiteboard:userName') || `Guest ${Math.floor(Math.random() * 90 + 10)}`;
const storedClientId = localStorage.getItem('whiteboard:clientId') || crypto.randomUUID();
localStorage.setItem('whiteboard:clientId', storedClientId);
const storedUserAvatar = getUserAvatar(storedUserName, `${storedUserName}:${storedClientId}`);

export const app = {
    svg: null,
    board: {
        width: window.innerWidth * 5,
        height: window.innerHeight * 5,
    },
    cursor: null,
    allTools: [],
    currentTool: ToolType.Pen,
    fillColor: 'black',
    fillTolerance: 64,
    lineWidth: 5,
    isDrawing: false,
    objects: [],
    draftObject: null,
    selectedObjectId: null,
    selectedObjectIds: [],
    lassoBounds: null,
    followUserId: null,
    snapshots: [],
    history: {
        undo: [],
        redo: [],
    },
    drag: {
        start: null,
        last: null,
        moved: false,
        resizeHandle: null,
        resizeBounds: null,
        resizeObjects: null,
        rotateStart: null,
        rotateObjects: null,
    },
    roomId: null,
    roomName: null,
    roomHost: null,
    activeHost: null,
    hostOnline: false,
    roomAccessMode: 'open',
    isHost: false,
    clientId: storedClientId,
    localUser: {
        name: storedUserName,
        color: storedUserAvatar.color,
        initials: storedUserAvatar.initials,
    },
    collaborators: new Map(),
    objectLocks: new Map(),
    connectionState: ConnectionStatus.Connecting,
    activityLog: [],
    mouse: {
        x: 0,
        y: 0,
    },
    mouseDownOnToolbarMoveHandler: false,
    points: [],
    zoom: {
        _steps: [0.2, 0.4, 0.5, 0.75, 0.9, 1],
        scale: 0.2,
        offsetX: 0,
        offsetY: 0,
    },
};
