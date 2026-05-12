# AGENTS.md

Guidance for AI agents and automation working in this repository.

## Project Overview

This is a static Vite + React + TypeScript PWA for browser-based dictation. It supports local Web Speech API dictation, ElevenLabs realtime/batch transcription, OpenAI-compatible LLM post-processing, PWA installation, and GitHub Pages deployment.

There is no application backend in this repo. API calls to ElevenLabs and the configured LLM endpoint are made directly from the browser. User settings and keys are stored only in browser IndexedDB.

## Common Commands

Use npm and the existing lockfile.

```bash
npm ci
npm run dev
npm run build
npm run lint
npm run preview
```

GitHub Actions uses Node.js 22 and runs `npm ci` followed by `npm run build`.

## Repository Layout

- `src/App.tsx`: main app state, dictation flows, transcript editing, LLM post-processing, PWA debug UI.
- `src/api.ts`: browser-side ElevenLabs and OpenAI-compatible API helpers.
- `src/App.css`: app layout and component styling.
- `src/index.css`: global page/root styles.
- `src/settingsStore.ts`: IndexedDB settings load/save helpers and defaults.
- `src/types.ts`: shared app and settings types.
- `src/hooks/usePWAInstall.ts`: PWA install prompt and standalone detection logic.
- `src/components/InstallPrompt.tsx`: install prompt UI.
- `src/sw.ts`: source service worker for `vite-plugin-pwa` injectManifest builds.
- `vite.config.ts`: Vite, React, PWA manifest, service worker, and GitHub Pages base-path handling.
- `.github/workflows/deploy-pages.yml`: GitHub Pages build and deploy workflow.
- `public/`: static icons and manifest assets.

Do not edit `dist/` output or generated build artifacts. Rebuild them instead.

## Development Notes

- Prefer small, scoped React changes that match the current single-file app structure unless a feature clearly justifies extracting components.
- Keep secrets out of source, logs, screenshots, and committed fixtures. API keys are browser-local user data.
- Preserve the static-site architecture. Do not add a backend, proxy, or server-only dependency unless explicitly requested.
- Keep PWA behavior in mind when changing routing, asset paths, icons, manifest fields, service worker behavior, or cache strategy.
- `vite.config.ts` resolves the base path automatically for GitHub Pages. The workflow currently sets `PAGES_BASE_PATH=/`.
- For UI changes, check both normal and mini mode. Transcript and processed text fields must remain directly editable after generated content appears.
- Avoid broad visual rewrites unless requested; this is a utility app, so dense, predictable controls are preferable to landing-page styling.

## Validation

Before handing off code changes, run:

```bash
npm run lint
npm run build
```

For UI or PWA changes, also run the dev server and manually check the relevant flow:

```bash
npm run dev -- --host 0.0.0.0
```

If a local port is already in use, let Vite choose the next port and report the URL.

## Deployment

Branch policy:

- `develop` is the default working and commit branch.
- `main` is the CD release branch.
- GitHub Pages CD listens to pushes on `main`.

Deployment is handled by GitHub Actions on pushes to `main` and by manual workflow dispatch:

- Workflow: `Deploy to GitHub Pages`
- File: `.github/workflows/deploy-pages.yml`
- Build output: `dist/`

After pushing a change, verify the latest GitHub Actions run corresponds to the pushed commit SHA and completed successfully.

When the user asks to "交 CD", treat it as the full commit-and-deploy handoff:

1. Run `npm run lint` and `npm run build` unless the user explicitly says to skip validation.
2. Check `git status --short` and stage only intentional files.
3. Commit normal work on `develop` with a concise message that describes the user-visible change.
4. Push `develop` to `origin`.
5. Fast-forward or merge `develop` into `main`.
6. Push `main` to `origin` to trigger CD.
7. Use `gh run list` / `gh run watch` to confirm the `Deploy to GitHub Pages` run for the pushed `main` commit completed successfully.
8. Report the `develop` commit, deployed `main` commit, workflow result, and any uncommitted or untracked files left in the working tree.

## Git Hygiene

- Check `git status --short` before staging.
- Stage only intentional files.
- Do not commit local agent artifacts such as `.codex` unless the user explicitly asks.
- Do not rewrite history, reset, or discard unrelated work without explicit approval.
