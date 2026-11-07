# Component visual checks

`npm run gallery` generates one circuit per Draw-menu group and places every part in eight drag
directions. It also checks the geometry of those placements. Use `tests/web.command` to inspect
`http://localhost:5174/?c=_components/<file>`; check both ANSI and IEC symbol styles where they
apply. `_views/` contains smaller inspection views.

Check each part at its default size, at its minimum size, after rotation, and against its toolbar
icon:

1. Waves and zigzags rise first when read left to right. Curves are smooth, coils use arcs, and
   transformer loops face inward.
2. Related parts share body geometry. The inductor body aligns with the resistor body without
   changing its electrical endpoints. A blown fuse keeps its outline and has a visible fault mark.
3. Foreground details cover wires behind them. Minimum size preserves the symbol, including on
   vertical and diagonal drags.
4. Handles stay on lead endpoints. Labels and values clear the symbol. Every part rotates, and the
   placed symbol matches its toolbar icon.
5. Open, save, edit and simulate each representative group circuit after inspecting its symbols.

A two-grid-interval resistor has no leads, so its terminal dots meet the ends of its body. This is
its current minimum-size behavior.
