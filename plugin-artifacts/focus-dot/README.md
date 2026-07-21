# Focus Dot

Focus Dot is the small external plugin package used to simulate Chalkboard's plugin lifecycle.

It is intentionally not bundled into Chalkboard. The package contains:

- `manifest.json` — plugin identity, permissions, and contributions.
- `index.js` — a sandbox-friendly browser entry that communicates through the Chalkboard `postMessage` bridge.
- `logo.svg` — the plugin logo to upload separately in the developer form.
- `package.json` — package metadata for local inspection.

## Manual upload simulation

Before the first run, apply the latest backend migrations with `npm run db:migrate` from `backend`, and set `SUPER_ADMIN_EMAIL` in `backend/.env` to the Google account that should own the first admin session.

1. Sign in to Chalkboard and open the Developer tab.
2. Select **New plugin**.
3. Choose `manifest.json` as the manifest file.
4. Choose `index.js` as the plugin bundle.
5. Choose `logo.svg` as the plugin logo.
6. Create the draft, then submit it for review.
7. Open `/admin`, complete 2FA setup, run the plugin smoke test, approve it, and publish it.
8. Return to the Developer tab and refresh. Focus Dot should appear in the published catalogue.

The current simulation stores the bundle, validates the manifest, compiles the JavaScript, and lets an admin execute it inside the isolated admin sandbox. It does not install arbitrary third-party code into the live board. Production execution should use the same iframe sandbox pattern with a permission-checked message bridge.

## Bridge shape

The entry listens for `chalkboard:init`, responds with `chalkboard:ready`, registers its contributions, and handles the `focusDot.add` tool. It generates the focus-dot geometry in the plugin bundle, then requests the generic `board.insertStrokes` capability through `chalkboard:command`. The host must validate the plugin ID, permissions, message origin, and command payload before changing the board.
