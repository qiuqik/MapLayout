# Multiagent Label Placement Design

## Goal

Build a future VLM feedback loop that improves map label/global placement from the rendered map state and screenshot.

The first implementation should be a two-agent loop:

- Placement Agent proposes updated label/global positions and optional size changes.
- Validation Agent checks the screenshot for overlap, readability, leader-line clarity, and map-content conflicts.

This document is design-only. It does not introduce runtime calls yet.

## Inputs

Each iteration receives:

- `geojson`: current FeatureCollection and `global_properties`.
- `style_code`: current Point, Route, Label, Global styles.
- `layout_state`: label ids, anchor lng/lat, current center lng/lat, screen rects, leader lines, viewport size.
- `screenshot`: exported PNG of the current map frame.
- `constraints`: minimum padding, max movement per round, allowed resize range, hidden/locked labels, and max iterations.
- `validation_feedback`: previous Validation Agent feedback, empty on the first round.

## Placement Agent Output

The Placement Agent returns JSON:

```json
{
  "updates": [
    {
      "id": "label-...",
      "centerLngLat": { "lng": 120.1, "lat": 30.2 },
      "width": 180,
      "height": 72,
      "reason": "avoid route overlap"
    }
  ],
  "global_updates": [
    {
      "visual_id": "global_title",
      "style": { "container": { "width": 420 } },
      "reason": "keep title inside frame"
    }
  ],
  "notes": ["short explanation"]
}
```

Rules:

- Preserve each label id.
- Move labels in map coordinates so positions survive pan/zoom.
- Do not edit text content, GeoJSON geometry, route style, or icon assets.
- Prefer small movements before resizing or hiding.

## Validation Agent Output

The Validation Agent returns JSON:

```json
{
  "passed": false,
  "score": 0.78,
  "issues": [
    {
      "id": "label-...",
      "type": "overlap",
      "severity": "high",
      "message": "label overlaps route and POI marker"
    }
  ],
  "feedback": "Move core labels away from the route and increase leader line contrast."
}
```

Validation checks:

- Label-label, label-POI, label-route, label-global, and label-frame conflicts.
- Text readability against label panel and map background.
- Leader-line visibility and correct anchor direction.
- Global content inside safe top/bottom bands.

## Loop

1. Frontend exports the current map screenshot and sends screenshot plus structured layout state.
2. Placement Agent returns candidate updates.
3. Frontend applies candidate updates to a temporary layout state and exports a new screenshot.
4. Validation Agent returns pass/fail and feedback.
5. Repeat until `passed === true` or `maxIterations` is reached.
6. On pass, persist the optimized positions as groundtruth/layout metadata; on failure, keep the best scored iteration.

Defaults:

- `maxIterations`: 4.
- `maxMoveRatio`: 0.18 of viewport width/height per iteration.
- `minFramePadding`: 12 px.
- `minLeaderContrast`: 3:1 against nearby map colors.

## Integration Points

- Frontend: add a later "Optimize Labels" action near layout controls.
- Backend: add a later `/api/multimodal/session/{session_id}/optimize-labels` endpoint.
- Storage: save candidate iterations under `node_layout_agent/` with screenshots and JSON artifacts.
- UI: show iteration score, issue list, and accept/revert controls.
