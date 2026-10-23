# vendor/

Third-party code served from our own origin (so the service worker can cache it and the game works offline).

## three.module.min.js

- Library: three.js, **r160** (npm `three@0.160.0`), MIT license (header kept in the file)
- Source: `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js` (official npm package build)
- Size: 670,681 bytes
- SHA-256: `3e690ac7d180b0aadf0891bea39eec643e29e2d3e75c99b18689518665f69ba6`
  (matches the hash jsdelivr's data API lists for `/build/three.module.min.js` of `three@0.160.0`)
- No imports of its own (self-contained ES module). Imported only by `js/world3d/*.js` as
  `../../vendor/three.module.min.js`; `.github/scripts/version_assets.py` stamps `?v=<commit>` on that import
  and `.github/workflows/pages.yml` copies `vendor/` into the deployed site.

To upgrade: download the new pinned version, update this file (version + SHA-256), and re-run the tests.
Verify with: `sha256sum vendor/three.module.min.js`
