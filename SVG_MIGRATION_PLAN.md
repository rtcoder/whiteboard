# SVG Migration Plan

This plan describes how to migrate the whiteboard from direct canvas pixel rendering to an SVG-first object model.

## Why SVG

SVG would make several planned features easier:

- Object selection can use real DOM nodes instead of hit-testing canvas pixels.
- Resize, rotate, duplicate, delete, lock, group, and layer ordering become object operations.
- Text stays editable and selectable as text.
- Shapes and connectors can be manipulated without redrawing the whole board.
- Export to SVG is almost free, and PNG/PDF export can be built on top of it.
- Collaboration can sync smaller object patches instead of large full-canvas snapshots.
- Activity history can refer to stable object ids and object types.

## Main Tradeoffs

SVG is not automatically better for every drawing action:

- Very long freehand paths can become heavy if every point is kept.
- Soft brush effects, marker blending, and pixel-based fills are harder than on canvas.
- Large boards with thousands of DOM nodes need careful performance handling.
- Flood fill on arbitrary hand-drawn closed regions is easier in pixels than pure SVG geometry.

The recommended approach is SVG-first, with optional raster layers for cases where pixels are genuinely useful.

## Target Architecture

Use a single SVG element as the board surface.

Board objects should be stored as serializable records, not as raw DOM:

```js
{
  id: "rectangle-...",
  type: "rectangle",
  x: 120,
  y: 80,
  width: 240,
  height: 140,
  stroke: "#111827",
  strokeWidth: 4,
  fill: "transparent",
  rotation: 0,
  zIndex: 12
}
```

Rendering becomes:

- `objects -> SVG DOM`
- object updates patch only the changed SVG node
- network messages sync object operations, not full board snapshots

## Object Mapping

- Pen: SVG `<path>` with simplified points.
- Marker: SVG `<path>` with opacity and wider stroke.
- Pencil/sketch: SVG `<path>` with thinner stroke and optional filter.
- Eraser: delete/split objects or use masks in a later phase.
- Line: SVG `<line>` or `<path>`.
- Arrow: SVG `<line>` plus marker-end definition.
- Rectangle: SVG `<rect>`.
- Ellipse: SVG `<ellipse>`.
- Diamond: SVG `<polygon>`.
- Text box: SVG `<text>` or `foreignObject` for richer editing.
- Sticky note: SVG group containing `<rect>` and `<text>`.
- Image import: SVG `<image>`.
- Fill for regular shapes: set `fill` on the SVG object.
- Fill for hand-drawn regions: keep as raster image or generated SVG path, depending on complexity.

## Recommended Hybrid Fill Strategy

For rectangles, ellipses, diamonds, polygons, and connectors:

- Use native SVG fill.

For freehand closed regions:

- Keep the current pixel-based flood fill algorithm at first.
- Store the result as a cropped PNG data URL inside an SVG `<image>`.
- Link that image object to the path ids it belongs to.

Later, investigate vectorizing filled regions into SVG paths, but do not make that a first migration requirement.

## Migration Phases

### Phase 1: Introduce SVG Surface

- Add an SVG board layer above or instead of the canvas.
- Keep existing object data model where possible.
- Render shapes, text, sticky notes, and simple paths as SVG.
- Keep the canvas renderer temporarily as a fallback.

### Phase 2: SVG Hit Testing And Selection

- Replace canvas hit testing with SVG element hit testing.
- Add DOM data attributes: `data-object-id`, `data-object-type`.
- Implement selected-object handles as SVG overlays.
- Keep selection state in the existing app state.

### Phase 3: Object Operations

- Implement resize and rotate for SVG shapes.
- Add duplicate.
- Add bring forward/send backward via `zIndex`.
- Add group/ungroup with SVG `<g>`.
- Add lock/unlock.

### Phase 4: Network Operations

Move from full board snapshots toward operation messages:

- `object-created`
- `object-updated`
- `object-deleted`
- `objects-reordered`
- `board-cleared`

Keep a periodic full snapshot for recovery and late joiners.

### Phase 5: Freehand Optimization

- Simplify freehand point arrays before storing paths.
- Use `d` strings for SVG paths.
- Add point smoothing for pen/pencil.
- Keep marker opacity as SVG stroke opacity.

### Phase 6: Export And Import

- Export SVG directly.
- Export PNG by serializing SVG and drawing it to a temporary canvas.
- Export PDF through SVG-to-PDF or browser print/export flow.
- Import image as SVG `<image>`.
- Copy as image via the same PNG export path.

## Data Model Changes

Recommended object shape:

```js
{
  id: string,
  type: string,
  attrs: object,
  transform: {
    x: number,
    y: number,
    rotation: number,
    scaleX: number,
    scaleY: number
  },
  style: {
    stroke: string,
    fill: string,
    strokeWidth: number,
    opacity: number
  },
  zIndex: number,
  locked: boolean,
  groupId: string | null
}
```

This keeps rendering, selection, network sync, and history easier to reason about.

## Risks

- Freehand drawing performance can degrade if every stroke is a heavy DOM path.
- Text editing inside SVG can be awkward without a temporary HTML editor overlay.
- Browser differences around `foreignObject` may affect rich text.
- Pure SVG flood fill is not trivial for arbitrary hand-drawn shapes.
- A full rewrite would be risky; migrate incrementally.

## Recommendation

Do not rewrite everything at once.

Start with an SVG renderer for existing objects while keeping the current state model and networking mostly intact. Once SVG rendering is stable, move selection and editing to SVG. Only then migrate network sync from snapshots to object operations.

The best first implementation target is:

- SVG shapes
- SVG freehand paths
- SVG text/sticky notes
- SVG selection handles
- raster-in-SVG fill for hand-drawn regions

This gives most of the benefits without losing the fill behavior that already works.

## Current Implementation Status

- [x] Added an SVG board layer as the visible rendering surface.
- [x] Kept canvas as an invisible raster buffer for flood fill and compatibility.
- [x] Rendered paths, shapes, text, sticky notes, and bitmap fill objects into SVG.
- [x] Rendered selected-object outlines in SVG.
- [x] Preserved the existing object model and WebSocket state sync.
- [x] Added SVG resize/rotate handles.
- [x] Added direct SVG export.
- [x] Added incremental board-operation sync for normal merge updates.
- [ ] Move hit testing fully to real SVG DOM node picking.
- [ ] Replace remaining full-state sync paths with explicit operation events.
- [ ] Add SVG-native inline text editing.
- [ ] Add vector-friendly freehand smoothing and simplification.
- [ ] Add advanced connector anchors and routing.

## Hardening Implementation Groups

The remaining work should be completed in grouped commits:

1. Collaboration stability: lock badges, reconnect status, peer cleanup, and conflict UI.
2. Editing UX: inline text editor, mixed property values, complete shortcut handling.
3. Fill and drawing: edge cleanup, smaller bitmap payloads, freehand simplification.
4. Diagram tools: flowchart shapes, mind nodes, swimlanes, kanban, templates.
5. UI polish: activity search, minimap drag, mobile toolbar, synced/offline status.
6. Export/import: selection/frame export, text paste, basic editable SVG import, named snapshots.
7. Sync protocol: standardized operations, bounded operation log, persisted schema migration.
8. Reliability and tests: atomic persistence, limits, integration tests, browser E2E.
