# Turn-Based Combat Prototype

This is a TypeScript prototype for a turn-based combat system where player text is interpreted into game actions, the rules engine resolves the move, and a dungeon-master layer narrates the attempt and result.

## Run

```bash
npm run dev
```

Open `http://localhost:5173`.

For the old terminal prototype:

```bash
npm run cli
```

Type free-form actions like:

```text
give a flying uppercut to the enemy
hurl a fire blast at their chest
brace and block the next attack
```

## Design

- `src/server.ts` runs an Express server with Vite middleware in development.
- `POST /api/rooms` creates a two-player combat room with a unique room ID.
- `POST /api/rooms/:roomId/join` joins the second seat in that room.
- `GET /api/rooms/:roomId` fetches the current room state for polling.
- `POST /api/rooms/:roomId/action` submits a turn for the caller's seat.
- `src/client/main.tsx` renders the browser combat UI.
- `interpretAction()` adjudicates free-form player text into a feasible combat action plus a resolved scene summary.
- `resolveAction()` uses strength, agility, speed, defense, guard, and luck to determine success and damage.
- `DungeonMaster` is an interface. `RuleBasedDungeonMaster` is the local prototype narrator, and an LLM-backed narrator can be added behind the same interface later.
- `CombatGame` owns turns, snapshots, and combat completion.

The current browser flow is room-based PvP. The terminal demo remains local only.

## Current AI

If `OPENAI_API_KEY` is set, the server uses `OpenAIDungeonMaster` and calls the OpenAI Responses API for narration. Otherwise it falls back to `RuleBasedDungeonMaster`.

The default OpenAI model is `gpt-5.4-mini`. Override it with `OPENAI_MODEL`.
Turn illustrations use xAI with `XAI_API_KEY`. The default image model is `grok-imagine-image-quality`.

```bash
export OPENAI_API_KEY="your_api_key_here"
export OPENAI_MODEL="gpt-5.4-mini"
export XAI_API_KEY="your_xai_key_here"
export XAI_IMAGE_MODEL="grok-imagine-image-quality"
export XAI_IMAGE_TIMEOUT_MS="45000"
npm run dev
```

The combat rules remain authoritative in `src/combat.ts`. The model only narrates the already-resolved turn.
