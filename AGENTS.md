# AGENTS.md

## Commands

- **Dev server**: `npm run dev` (runs `node --no-warnings --watch server.js`)
- **Start**: `npm start`
- **Install**: `npm install`
- There are no lint, format, typecheck, or test scripts. `npm test` is not defined.

## Requirements

- **Node.js >= 22.5.0** (uses `node:sqlite` `DatabaseSync` which is experimental on older versions). Node 22.10.0+ recommended.
- ESM only (`"type": "module"` in package.json). Use `import`/`export`, not `require`.

## Architecture

- **Backend**: Express + SQLite (via `node:sqlite` built-in, no driver needed). Entry: `server.js`.
- **Frontend**: Single-page Alpine.js app in `public/`. No build step, no bundler, no transpiler.
- **Database**: Auto-created on boot in `data/` (gitignored). Schema in `src/db.js:migrate()`.
- Single route files under `src/routes/`: `auth.js`, `rooms.js`, `tenants.js`, `payments.js`, `dashboard.js`.
- Auth middleware in `src/auth.js`. Cookie `kk_token` or `Authorization: Bearer` header.

## Conventions

- **Language**: All UI text, error messages, API responses, and code comments are in **Bahasa Indonesia**. Keep them that way.
- **Money**: Integer Rupiah (no decimals, no cents). Use `Number.parseInt(x, 10) || 0`.
- **Single-owner only**: Registration closes after first owner created. Enforced at app level.
- `syncRoomStatus` in `src/routes/tenants.js` auto-sets room status on tenant create/update/delete. Does NOT override `maintenance` status.
- JSON body limit: 1mb. Static file cache: 1h in production, 0 in development.
- SPA fallback regex: `GET /^\/(?!api\/).*/` — serves `index.html` for non-API routes.

## Gotchas

- **CI workflows are broken boilerplate**: `.github/workflows/` uses Node 20 (needs 22.5+) and runs `npm test` (not defined). Do not rely on them.
- `--no-warnings` flag suppresses experimental module warnings in both start scripts.
- `FONNTE_TOKEN` env var exists for future WhatsApp integration but no code uses it yet.
- Alpine.js is vendored at `public/js/vendor/alpine.min.js`. The app component in `public/js/app.js` registers via `alpine:init` event — load order matters.
