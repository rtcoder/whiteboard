# SVG Migration Plan

This plan tracks the migration from a hybrid canvas/SVG board to a pure SVG whiteboard runtime.

## Decision

The target architecture is pure SVG for normal application runtime:

- no persistent visible or hidden canvas for drawing, rendering, hit testing, or fill;
- one SVG board surface is the source of all visible board content;
- object records remain serializable data and render into SVG DOM;
- temporary offscreen canvas is allowed only for export rasterization, such as PNG or clipboard image generation.

## Fill Policy

Pure SVG fill is object based. It does not try to preserve arbitrary pixel flood fill behavior.

- Rectangles, ellipses, diamonds, polygons, diagram shapes, notes, and frames use native SVG `fill`.
- Freehand fill is supported only for explicitly closed paths or the new freeform shape.
- Open pen, marker, and pencil paths are not fillable.
- Legacy bitmap fills remain viewable by migrating them to SVG `<image>` objects.
- New fill operations must not create `bitmap` objects or `ImageData` payloads.

## Target Architecture

Board state stays as serializable objects, not raw DOM nodes:

```js
{
  id: "freeform-...",
  type: "freeform",
  points: [{x: 120, y: 80}, {x: 180, y: 140}],
  closed: true,
  fill: "#bfdbfe",
  color: "#1d4ed8",
  lineWidth: 4,
  rotation: 0,
  locked: false,
  groupId: null
}
```

Rendering and editing flow:

- `objects -> SVG DOM`
- SVG nodes carry `data-object-id` and `data-object-type`
- pointer selection uses SVG DOM picking first
- geometry helpers still provide bounds, resize, rotate, lasso, and export bounds
- network sync sends object operations and uses full snapshots only for init/recovery/snapshot restore

## Object Mapping

- Pen, marker, pencil: SVG `<path>` with simplified points.
- Freeform shape: closed SVG `<path>` with stroke and fill.
- Line and arrow: SVG line/path with expanded hit target.
- Rectangle, ellipse, diamond, polygon: native SVG geometry.
- Diagram shapes, swimlane, kanban, templates: SVG groups.
- Text, sticky, callout, list, label, comments: SVG groups plus the existing HTML editor overlay.
- Image import and legacy bitmap fill: SVG `<image>`.
- Connectors: SVG paths with anchors, labels, and route data.

## Current Implementation Status

- [x] Added an SVG board layer as the visible rendering surface.
- [x] Rendered paths, shapes, text, sticky notes, diagram objects, connectors, images, and bitmap fill objects into SVG.
- [x] Rendered selected-object outlines and handles in SVG.
- [x] Added direct SVG export.
- [x] Added incremental board-operation sync for normal merge updates.
- [x] Added inline text editing overlay.
- [x] Added vector-friendly freehand smoothing and simplification.
- [x] Added advanced connector anchors and routing.
- [ ] Remove persistent canvas board runtime.
- [ ] Make SVG renderer authoritative.
- [ ] Move hit testing fully to SVG DOM node picking.
- [ ] Replace bitmap fill creation with SVG object/path fill.
- [ ] Migrate legacy bitmap fills to SVG image objects.
- [ ] Remove remaining full-state sync paths outside init/recovery/snapshot restore.

## Implementation Groups

1. Docs and target architecture.
2. SVG board runtime without persistent canvas.
3. Authoritative SVG renderer.
4. SVG DOM hit testing and selection.
5. Pure SVG fill and freeform shape.
6. Legacy bitmap migration.
7. SVG-native export and clipboard rasterization.
8. Operation sync and history cleanup.
9. SVG-only UI/tooling polish.
10. Tests and browser QA.

## Risks

- Pure SVG fill does not replicate arbitrary pixel flood fill.
- Very complex freehand paths can become heavy DOM paths if simplification regresses.
- Legacy bitmap fills are view-only after migration.
- Rich text editing remains easier through an HTML overlay than direct SVG text editing.
