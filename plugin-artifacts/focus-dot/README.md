# Focus Dot

Focus Dot is the small external plugin package used to simulate Chalkboard's plugin lifecycle.

It is intentionally not bundled into Chalkboard. The package contains:

- `manifest.json` — plugin identity, permissions, and contributions.
- `index.js` — a sandbox-friendly browser entry that communicates through the Chalkboard `postMessage` bridge.
- `logo.svg` — the plugin logo to upload separately in the developer form.
- `package.json` — package metadata for local inspection.

## Manual upload simulation

1. Sign in to Chalkboard and open the Developer tab.
2. Select **New plugin**.
3. Choose `manifest.json` as the manifest file.
4. Choose `index.js` as the plugin bundle.
5. Choose `logo.svg` as the plugin logo.
6. Create the draft, then submit it for review.
7. Open `/admin`, complete 2FA setup, run the plugin smoke test, approve it, and publish it.
8. Return to the Developer tab and refresh. Focus Dot should appear in the published catalogue.

The current simulation stores the bundle, validates the manifest, compiles the JavaScript without executing it, and publishes the plugin metadata. It does not yet install arbitrary third-party code into the live board. Production execution should happen in an iframe sandbox with a permission-checked message bridge.

## Bridge shape

The entry listens for `chalkboard:init`, responds with `chalkboard:ready`, registers its contributions, and requests the `focusDot.add` command through `chalkboard:command`. The host must validate the plugin ID, permissions, message origin, and command payload before changing the board.
