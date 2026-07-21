# Inscribed Circles

Inscribed Circles is a tiny external Chalkboard plugin that adds two centered circles to the canvas: a larger outer circle and a smaller inner circle.

The package follows the same upload format as the Focus Dot example:

- `manifest.json` declares the plugin and its `board:write` contribution.
- `index.js` registers the tool and sends two circular strokes through the Chalkboard bridge.
- `logo.svg` is the optional plugin logo.
- `package.json` contains local package metadata.

Upload `inscribed-circles-0.1.0.zip` from the Developer tab. After the plugin is installed or approved, use **Add Inscribed Circles** to place the pair at the current viewport center.
