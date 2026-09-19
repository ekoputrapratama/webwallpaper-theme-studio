# WebWallpaper Theme Studio

A web-based studio for creating **WebWallpaper themes** — wallpapers for **WebWallpaper**, a KDE Plasma wallpaper plugin that renders HTML5/WebGL/video content on your desktop.

Themes made here are ready to drop into the WebWallpaper themes folder on any KDE Plasma machine.

Deploys to **Vercel** with **Firebase Auth** for sign-in, **Cloud Firestore** for project metadata, and **Vercel Blob** for large files (uploaded videos, preview GIFs).

## What themes does it make?

You can create two kinds of projects:

| Type                   | Output                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTML5 + JS + WebGL** | A full project with `index.html` (WebGL starter included), CSS, and JavaScript. Edit everything in a built-in code editor with a live preview.                             |
| **Video only**         | Upload a looping video. The app generates `index.html` (fullscreen autoplay/loop), a `preview.gif` thumbnail (240px wide, via built-in ffmpeg), and the `.theme` manifest. |

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
author=Somebody
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

### Local-only settings

| Env var        | Default                        | Purpose                                                                                                                  |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `WWC_PROJECTS` | system temp dir                | Where project folders are stored. Set to your themes folder to write directly into your WebWallpaper collection.         |
| `FFMPEG_PATH`  | bundled `ffmpeg-static` binary | Overrides the ffmpeg used for `preview.gif` generation. Falls back to a system `ffmpeg` on `PATH` if neither is present. |

### Firebase + Vercel Blob (sign-in, metadata, large files)

See `.env.example` for the full list. Copy it to `.env.local` first:

```bash
cp .env.example .env.local
```

| Env var                        | Purpose                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN`        | Vercel Blob read-write token, from a Blob store in the Vercel dashboard.                       |
| `BLOB_STORE_ID`                | The Blob store ID (`store_…`). Only needed if you use more than one store.                     |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase **client** SDK config (Firebase console → Project settings). Used for sign-in.        |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Public Firebase Auth domain.                                                               |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`  | Firebase project ID.                                                                        |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket.                                                                  |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase sender ID.                                                                     |
| `NEXT_PUBLIC_FIREBASE_APP_ID`  | Firebase app ID.                                                                               |
| `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` | Optional Firestore database ID. Empty = default database.                                   |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full **service account** JSON as a single string (Firebase Admin SDK: Firestore + session cookies). |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Alternative to the JSON above; only needed if you didn't set it.            |
| `SESSION_COOKIE_NAME`          | Optional session cookie name (default `fb_session`).                                           |

### Deploying to Vercel

1. Create a **Blob store** in the Vercel dashboard and copy its read-write token.
2. In the Firebase console: create/attach a **web app** (for the client `NEXT_PUBLIC_FIREBASE_*` keys) and enable **Firestore** + **Authentication** (email or Google).
3. Download a **service account** JSON: Project settings → Service accounts → *Generate new private key*.
4. Add the env vars above in **Vercel → Project → Settings → Environment Variables** for both `Production` and `Preview`.
5. Deploy (via git push with the bundled GitHub Actions workflow, or `vercel` CLI). Sign in at the `/login` page.

**Local vs. durable storage** — once Firebase Admin is configured, projects persist in Firestore + Blob and a startup log prints `[persist] storage mode: firestore+blob (durable)`. Without it, the app falls back to a local temp dir (`local /tmp (ephemeral)`), which does not survive server restarts or scale across functions.

**Gotchas**

- `FIREBASE_SERVICE_ACCOUNT_JSON` must be a single line with `\n` escapes preserved in `private_key`. Generate it with `jq -c < webwallpaper-…-firebase-adminsdk-….json`. If the key ever contains a literal `...` it has been redacted/truncated and sign-in will fail with `Failed to parse private key`.
- The `private_key` is ~1700 characters; a value of a few dozen characters means it was truncated and won't work.
- Uploaded source videos are kept in the Blob store (they are not deleted after a theme is built).
- `package.json` pins `jose@5.10.0` via an `overrides` block. This is required so `firebase-admin`'s `jwks-rsa` can be loaded by the Vercel/Turbopack bundle (jose v6 is ESM-only); don't remove it.

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
