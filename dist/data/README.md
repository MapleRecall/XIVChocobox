# Track metadata

`track-metadata.json` is a schemaVersion 1 snapshot, keyed by lowercase SCD resource paths.
It contains parsed metadata only, never compressed audio or PCM. The browser loads this
snapshot before supplementing missing entries in the background; playback always parses
the selected local resource again, so the snapshot does not control audio timing.

Each record may include:
- `dungeons`: matched instance/duty names from the local `InstanceContent`/`ContentFinderCondition` direct relation or the `TerritoryType.BGM` → `BGMSituation` → `BGM` scene relation; territory `PlaceName` is preferred for the displayed name.
- `uses`: Chinese usage text for the list subtitle. It is generated from the curated BGM `Locations` snapshot first, then falls back to local instance/territory mappings when no location is available.
- `usageByLocale`: localized usage arrays for `zh`, `en`, and `ja`; the UI selects the active language at runtime.
- `coverTextureIds`: numeric game icon/texture identifiers, one per matched instance.
- `coverTexturePaths`: exact SqPack `.tex` paths derived from those identifiers.
- `coverTextureId` and `coverTexturePath`: first-item compatibility fields.

These fields are optional mappings, not sound IDs. The player reads and decodes the first
available game texture at runtime; unsupported or missing textures fall back to the built-in
cover. The numeric ID-to-path rule is the FFXIV icon convention `ui/icon/NNN000/NNNNNN.tex`.

To rebuild from a local installation, run `node tools/export-metadata.mjs <game-root-or-game-folder>`.
The export regenerates both mapping routes, applies `ContentFinderCondition.ContentType` priority
so normal duties win over special-content reuse, and preserves curated cover mappings when no
automatic mapping is available.
