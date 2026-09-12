# Track metadata

`track-metadata.json` is a schemaVersion 1 snapshot, keyed by lowercase SCD resource paths.
It contains parsed metadata only, never compressed audio or PCM. The browser loads this
snapshot before supplementing missing entries in the background; playback always parses
the selected local resource again, so the snapshot does not control audio timing.

Each record reserves:
- `coverTextureId`: null or a future numeric game icon/texture identifier.
- `coverTexturePath`: null or an exact SqPack texture resource path (for textures without a numeric ID).

Both fields are optional cover mappings, not sound IDs. The current player carries them to
the cover placeholder but does not decode textures yet. No numeric ID-to-path rule is
assumed: general game textures do not all have a universal numeric identifier.

To rebuild from a local installation, run `node tools/export-metadata.mjs <sqpack>`.
The export should preserve any curated cover mappings when refreshing the snapshot.
