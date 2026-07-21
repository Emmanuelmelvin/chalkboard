# Focus Dot

Focus Dot is the small external plugin package used to simulate Chalkboard's plugin lifecycle.

It is intentionally not bundled into Chalkboard. The package contains:

- `manifest.json` — plugin identity, permissions, and contributions.
- `index.js` — a sandbox-friendly browser entry that communicates through the Chalkboard `postMessage` bridge.
- `logo.svg` — the plugin logo to upload separately in the developer form.
- `package.json` — package metadata for local inspection.

## Upload simulation

Before the first run, apply the latest backend migrations with `npm run db:migrate` from `backend`, and set `SUPER_ADMIN_EMAIL` in `backend/.env` to the Google account that should own the first admin session.

1. Sign in to Chalkboard and open the Developer tab.
2. Select **New plugin**.
3. Drop `focus-dot-0.1.0.zip` into the package square. Chalkboard reads `manifest.json` and `index.js`, lists the archive contents, and prepares the executable entry.
4. Choose `logo.svg` as the plugin logo.
5. Create the draft, then submit it for review.
6. Open `/admin`, complete 2FA setup, run the plugin smoke test, approve it, and publish it.
7. Return to the Developer tab and refresh. Focus Dot should appear in the published catalogue.

If you do not have a ZIP, choose **Add files manually** and provide the manifest and JavaScript entry separately. ZIP packages may contain additional JavaScript modules; relative imports are included in the generated browser entry.

The developer workflow stores the bundle, validates the manifest, and lets an admin execute it inside an isolated review sandbox. Published bundles also run in live rooms inside a scripts-only iframe. Live board changes go through a permission-checked host capability bridge; the bundle never receives direct access to the board store or socket.

## Bridge shape

The entry listens for `chalkboard:init`, responds with `chalkboard:ready`, registers its contributions, and handles the `focusDot.add` tool. It generates the focus-dot geometry in the plugin bundle, then requests the generic `board.insertStrokes` capability through `chalkboard:command`. The host must validate the plugin ID, permissions, message origin, and command payload before changing the board.
