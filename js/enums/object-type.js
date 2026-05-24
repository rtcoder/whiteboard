export const ObjectType = Object.freeze({
    Arrow: 'arrow',
    Bitmap: 'bitmap',
    Callout: 'callout',
    Comment: 'comment',
    Connector: 'connector',
    Diamond: 'diamond',
    Ellipse: 'ellipse',
    FlowDatabase: 'flow-database',
    FlowDecision: 'flow-decision',
    FlowProcess: 'flow-process',
    FlowTerminator: 'flow-terminator',
    Frame: 'frame',
    Freeform: 'freeform',
    Image: 'image',
    Kanban: 'kanban',
    Label: 'label',
    Line: 'line',
    List: 'list',
    MindNode: 'mind-node',
    Path: 'path',
    Polygon: 'polygon',
    Rectangle: 'rectangle',
    Sticky: 'sticky',
    Swimlane: 'swimlane',
    TemplateFrame: 'template-frame',
    Text: 'text',
});

export const BaseShapeTypes = Object.freeze([
    ObjectType.Line,
    ObjectType.Arrow,
    ObjectType.Rectangle,
    ObjectType.Ellipse,
    ObjectType.Diamond,
    ObjectType.Polygon,
]);

export const FlowShapeTypes = Object.freeze([
    ObjectType.FlowProcess,
    ObjectType.FlowDecision,
    ObjectType.FlowTerminator,
    ObjectType.FlowDatabase,
]);

export const DiagramObjectTypes = Object.freeze([
    ObjectType.MindNode,
    ObjectType.Swimlane,
    ObjectType.Kanban,
    ObjectType.TemplateFrame,
]);

export const FillableBoxTypes = Object.freeze([
    ObjectType.Sticky,
    ObjectType.Callout,
    ObjectType.List,
    ObjectType.Label,
    ObjectType.Comment,
    ObjectType.Frame,
    ObjectType.Swimlane,
    ObjectType.Kanban,
    ObjectType.TemplateFrame,
]);

export const ShapeTypes = Object.freeze([
    ...BaseShapeTypes,
    ...FlowShapeTypes,
    ...DiagramObjectTypes,
]);

export const TextEditableObjectTypes = Object.freeze([
    ObjectType.Text,
    ObjectType.Sticky,
    ObjectType.Callout,
    ObjectType.List,
    ObjectType.Label,
    ObjectType.Comment,
    ObjectType.Frame,
    ObjectType.MindNode,
    ObjectType.TemplateFrame,
    ObjectType.FlowProcess,
    ObjectType.FlowDecision,
    ObjectType.FlowTerminator,
    ObjectType.FlowDatabase,
    ObjectType.Swimlane,
    ObjectType.Connector,
]);
