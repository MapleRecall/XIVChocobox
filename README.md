# XIVChocobox

XIVChocobox is a local-first browser music player for **FINAL FANTASY XIV**.

It lets you browse and play game music and Orchestrion rolls directly from a local FFXIV installation. Audio is read and processed in your browser, so your game files stay on your computer.

## Highlights

- Browse game music and Orchestrion rolls from a local installation
- Search by track title, resource name, or usage
- Loop regions, repeat modes, shuffle, and previous/next track controls
- Preview multichannel tracks and switch available audio tracks
- Show track usage and dungeon artwork when available
- English, Simplified Chinese, and Japanese interfaces
- Remember local preferences such as volume, language, and playback order

## Getting started

### Hosted version

Open the [XIVChocobox web app](https://maplerecall.github.io/XIVChocobox/).

On the first visit, choose one of the following folders:

- Your FFXIV installation directory
- The `game` directory
- The `sqpack` directory

The browser will ask for read-only access to the selected folder. After access is granted, the player can load the available music resources. You can also drag a folder into the page when supported by your browser.

### Run locally

The project is a dependency-free static site. To start a local server:

```sh
git clone https://github.com/MapleRecall/XIVChocobox.git
cd XIVChocobox
npm run dev
```

Then open <http://127.0.0.1:4173/> in a desktop Chrome or Edge browser.

Node.js 22 or newer is recommended for the local server.

## Deployment

The published site is contained in the `dist/` directory and can be served by any static hosting provider. A GitHub Actions workflow for GitHub Pages is included in `.github/workflows/pages.yml`.

The repository contains no game audio or extracted game files. They are read from the user's local installation at runtime.

## Privacy

XIVChocobox does not upload or copy your game files. Music decoding and playback happen locally in the browser. Small preferences and cached track information may be stored in the browser on your device.

## Contributing

Issues and pull requests are welcome. Please keep contributions focused on the player and do not commit FFXIV game assets, extracted resources, or other copyrighted content.

## Acknowledgements

This project benefits from publicly available FFXIV resource format research and open-source tooling, including:

- [xivres](https://github.com/Soreepeong/xivres)
- [vgmstream](https://github.com/vgmstream/vgmstream)
- [FFXIV datamining research](https://github.com/xivapi/ffxiv-datamining/tree/master/research)

XIVChocobox is an independent fan project and is not affiliated with or endorsed by SQUARE ENIX.
