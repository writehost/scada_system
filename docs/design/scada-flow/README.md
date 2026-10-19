# SCADA Flow — interface concept

A design concept for **SCADA Flow**: a cloud workflow builder (in the spirit of Node-RED) for the SCADA SYSTEM ecosystem.
Tagline: *Visual orchestration for industrial operations.*

Live canvas: https://claude.ai/artifact/CErFpXmWh3j5RgKDqz7zdo (private until it is shared from the canvas's Share menu)

This is a design concept only. It is not wired into the Next.js app and is not served by it.

## Screens

| File | Screen | Interactive |
|---|---|---|
| `project/Main.dc.html` | 01 · Overview: hero, live workflow graph, ecosystem strip | animated |
| `project/Builder.dc.html` | 02 · Workflow builder: block library, node canvas, properties panel, debug console | drag nodes, select, enable/disable, run/pause, environment, library categories |
| `project/Integrations.dc.html` | 03 · SCADA SYSTEM integrations: WMS, YMS, QPass, APS, Code Analyzer, AI, edge devices, ERP/messaging | animated |
| `project/Templates.dc.html` | 04 · Industrial templates (8) with a preview panel | filter, select |
| `project/Monitoring.dc.html` | 05 · Runtime: KPIs, runs per hour, health, errors, deployments | hover the bars |
| `project/Tenancy.dc.html` | 06 · Multi-tenant cloud: org → site → project → environment, roles, audit trail | — |
| `project/Mobile*.dc.html` | 07 · Mobile: runtime, alerts, control center (390×844) | acknowledge alerts, pause/resume flows |

`project/canvas.json` holds the canvas layout. The `.dc.html` files are Design Component pages: they rely on
the canvas runtime (`support.js`) for the `{{…}}` bindings, `<sc-for>` and `<sc-if>`. Opened as plain HTML they will
not render those parts.

## Visual system

- Surfaces: `#060708` ground, graphite panels, 8 % white hairlines, frosted glass on floating panels.
- Accent: lime `#C6F432`. It marks running state, triggers and the primary action, and nothing else.
- Status: amber `#F5B841` for warnings and the reject branch, coral `#FF7A66` for errors. Status is never shown by color alone. There is always a label or an icon too.
- Type: Geist for the UI, Geist Mono for IDs, payloads and labels, Instrument Serif italic for one accent word per headline.
- Motion: dashed wires flow and glowing "packets" travel along the edges. All of it switches off under `prefers-reduced-motion`.
