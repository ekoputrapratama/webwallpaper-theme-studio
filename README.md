# WebWallpaper Theme Studio

A web-based studio for creating **WebWallpaper themes** — wallpapers for **WebWallpaper**, a KDE Plasma wallpaper plugin that renders HTML5/WebGL/video content on your desktop.

Themes made here are ready to drop into the WebWallpaper themes folder on any KDE Plasma machine.

## What themes does it make?

You can create two kinds of projects:

| Type | Output |
| ---- | ------ |
| **HTML5 + JS + WebGL** | A full project with `index.html` (WebGL starter included), CSS, and JavaScript. Edit everything in a built-in code editor with a live preview. |
| **Video only** | Upload a looping video. The app generates `index.html` (fullscreen autoplay/loop), a `preview.gif` thumbnail (240px wide, via built-in ffmpeg), and the `.theme` manifest. |

Every project exports as a **`.zip`** (or its folder) containing:

- `index.html` — the theme entry point
- `thumbnail.svg` / `preview.gif` — the thumbnail shown in the wallpaper picker
- `<project-name>.theme` — the manifest file WebWallpaper reads

## The `.theme` format

An INI-style manifest with lowercase keys:

```ini
[Theme]
name=My Wallpaper
description=Made with WebWallpaper Theme Studio
author=Someone
version=1.0
thumbnail=thumbnail.svg
entry=index.html
```

This matches the format used by WebWallpaper (see [ekoputrapratama/webwallpaper-kde](https://github.com/ekoputrapratama/webwallpaper-kde)).

## Running

Requires **Node.js 20+** and npm.

```bash
npm install          # installs deps + the bundled ffmpeg binary
npm run dev          # development server  → http://localhost:3000
```

Production:

```bash
npm run build
npm start            # serve the production build → http://localhost:3000
```

Note: `ffmpeg-static` downloads its binary during `npm install`. If npm blocks install scripts, run
`npm install-scripts approve ffmpeg-static`, or the app will attempt it automatically on first use.

## Configuration

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `WWC_PROJECTS` | system temp dir | Where project folders are stored. Set to your themes folder to write directly into your WebWallpaper collection. |
| `FFMPEG_PATH` | bundled `ffmpeg-static` binary | Overrides the ffmpeg used for `preview.gif` generation. Falls back to a system `ffmpeg` on `PATH` if neither is present. |

## Install the result in WebWallpaper

1. Open a project in the studio and click **Export .zip**.
2. Unzip the folder into WebWallpaper's themes directory, or set `WWC_PROJECTS` to point at it directly so projects are saved there automatically.
3. Pick the theme from the WebWallpaper wallpaper list.

## Package layout

```
lib/ffmpeg.ts         bundled-ffmpeg resolution (static → env → system)
lib/themes.ts         theme build logic (.theme writer, templates, gif generation)
app/api/projects/     project CRUD, video upload, meta updates, zip export
app/p/                serves each project's files for live previews
components/           dashboard (project list + creation) and code editor
```