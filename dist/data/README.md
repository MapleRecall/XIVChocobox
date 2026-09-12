# Track metadata

`track-metadata.json` is a schemaVersion 1 snapshot, keyed by lowercase SCD resource paths.
It contains parsed metadata only, never compressed audio or PCM. The browser loads this
snapshot before supplementing missing entries in the background; playback always parses
the selected local resource again, so the snapshot does not control audio timing.

Each record may include:
- `dungeons`: matched instance/duty names from the local `InstanceContent` and `ContentFinderCondition` sheets.
- `coverTextureIds`: numeric game icon/texture identifiers, one per matched instance.
- `coverTexturePaths`: exact SqPack `.tex` paths derived from those identifiers.
- `coverTextureId` and `coverTexturePath`: first-item compatibility fields.

These fields are optional mappings, not sound IDs. The player reads and decodes the first
available game texture at runtime; unsupported or missing textures fall back to the built-in
cover. The numeric ID-to-path rule is the FFXIV icon convention `ui/icon/NNN000/NNNNNN.tex`.

To rebuild from a local installation, run `node tools/export-metadata.mjs <game-root-or-game-folder>`.
The export regenerates instance mappings and preserves curated cover mappings when no automatic
mapping is available.
