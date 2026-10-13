# ER-GreenWave frontend

Next.js (App Router) dispatcher dashboard. See `../GreenWave_ARCHITECTURE.md` and `../AGENTS.md`.
Requires Node 22+ (`.nvmrc`).

## Commands (run from `frontend/`)

```bash
npm ci
npm run dev             # http://localhost:3000
npm run lint
npm run typecheck       # next typegen && tsc --noEmit
npm run format:check
npm test
npm run build
npm run generate:types  # regenerate src/types/api.generated.ts from ../contracts/openapi.json
```

`src/types/api.generated.ts` is generated from the backend's Pydantic models. Never edit it by hand.
