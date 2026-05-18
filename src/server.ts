import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { ViteDevServer } from "vite";
import { CombatGame, RuleBasedDungeonMaster, type DungeonMaster, type Team, type TurnResult } from "./combat";
import { OpenAIDungeonMaster } from "./openai-dungeon-master";
import {
  NoopTurnIllustrator,
  XaiTurnIllustrator,
  createFallbackCharacterArt,
  type SessionCharacterArt,
  type TurnIllustrator,
} from "./turn-illustrator";
import type {
  BattleLogEntry,
  CombatRoomView,
  CreateRoomRequest,
  JoinRoomRequest,
  RoomJoinResponse,
  RoomSeatState,
  RoomStatus,
  SubmitActionRequest,
  TurnIllustration,
} from "./api";

type RoomSeat = {
  seat: Team;
  displayName: string;
  participantToken: string;
};

type CombatRoom = {
  roomId: string;
  status: RoomStatus;
  game: CombatGame;
  log: BattleLogEntry[];
  characterArt: SessionCharacterArt;
  seats: {
    player: RoomSeat | null;
    enemy: RoomSeat | null;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const generatedRoot = path.resolve(root, "generated");
const port = Number(process.env.PORT ?? 5173);
const app = express();
const rooms = new Map<string, CombatRoom>();
const dungeonMaster = createDungeonMaster();
const turnIllustrator = createTurnIllustrator();

app.use(express.json());
app.use("/generated", express.static(generatedRoot));

app.post("/api/rooms", async (req, res) => {
  const body = req.body as Partial<CreateRoomRequest>;
  const displayName = normalizeDisplayName(body.displayName, "Player One");
  const roomId = createRoomId();
  const participantToken = crypto.randomUUID();
  const game = new CombatGame(undefined, dungeonMaster);
  game.renameCombatant("player", displayName);
  game.renameCombatant("enemy", "Waiting Challenger");
  const room: CombatRoom = {
    roomId,
    status: "waiting",
    game,
    log: [],
    characterArt: createFallbackCharacterArt(game.getSnapshot().player, game.getSnapshot().enemy),
    seats: {
      player: { seat: "player", displayName, participantToken },
      enemy: null,
    },
  };
  rooms.set(roomId, room);
  void hydrateCharacterArt(roomId, room.game.getSnapshot().player, room.game.getSnapshot().enemy);
  res.json(toJoinResponse(room, room.seats.player));
});

app.post("/api/rooms/:roomId/join", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }

  if (room.seats.enemy) {
    res.status(409).json({ error: "Room already has two players." });
    return;
  }

  const body = req.body as Partial<JoinRoomRequest>;
  const displayName = normalizeDisplayName(body.displayName, "Player Two");
  const participantToken = crypto.randomUUID();
  const enemySeat: RoomSeat = { seat: "enemy", displayName, participantToken };
  room.seats.enemy = enemySeat;
  room.status = room.game.getSnapshot().finished ? "finished" : "active";
  room.game.renameCombatant("enemy", displayName);
  room.characterArt.enemy.name = displayName;

  res.json(toJoinResponse(room, enemySeat));
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }

  room.status = computeRoomStatus(room);
  res.json(toRoomView(room));
});

app.post("/api/rooms/:roomId/action", async (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }

  const body = req.body as Partial<SubmitActionRequest>;
  const text = body.text?.trim();
  const participantToken = body.participantToken?.trim();
  if (!text || !participantToken) {
    res.status(400).json({ error: "Action text and participant token are required." });
    return;
  }

  const actingSeat = findSeatByToken(room, participantToken);
  if (!actingSeat) {
    res.status(403).json({ error: "Invalid participant token." });
    return;
  }

  if (room.status !== "active") {
    res.status(409).json({ error: room.status === "waiting" ? "Waiting for another player to join." : "Combat is already finished." });
    return;
  }

  const snapshot = room.game.getSnapshot();
  if (snapshot.finished) {
    room.status = "finished";
    res.json(toRoomView(room));
    return;
  }

  if (snapshot.activeTurn !== actingSeat.seat) {
    res.status(409).json({ error: "It is not your turn." });
    return;
  }

  const turn = await room.game.submitAction(text);
  const entry = toLogEntry(turn, room.log.length + 1, { status: "pending" });
  room.log.push(entry);
  void hydrateTurnIllustration(req.params.roomId, room, entry, turn.resolution);
  room.status = computeRoomStatus(room);

  res.json(toRoomView(room));
});

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await attachViteOrStatic(app);

  app.listen(port, () => {
    console.log(`Combat server running at http://localhost:${port}`);
  });
}

async function hydrateCharacterArt(roomId: string, player: CombatRoomView["snapshot"]["player"], enemy: CombatRoomView["snapshot"]["enemy"]): Promise<void> {
  const art = await turnIllustrator.createCharacterArt(roomId, player, enemy);
  const room = rooms.get(roomId);
  if (room) {
    room.characterArt = art;
  }
}

async function hydrateTurnIllustration(
  roomId: string,
  room: CombatRoom,
  entry: BattleLogEntry,
  resolution: TurnResult["resolution"],
): Promise<void> {
  const illustration = await turnIllustrator.illustrateTurn(roomId, room.characterArt, resolution);
  const liveRoom = rooms.get(roomId);
  if (!liveRoom) {
    return;
  }

  const liveEntry = liveRoom.log.find((candidate) => candidate.id === entry.id);
  if (liveEntry) {
    liveEntry.illustration = illustration;
  }
}

function createDungeonMaster(): DungeonMaster {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new RuleBasedDungeonMaster();
  }

  const model = process.env.OPENAI_MODEL;
  return new OpenAIDungeonMaster(model ? { apiKey, model } : { apiKey });
}

function toRoomView(room: CombatRoom): CombatRoomView {
  return {
    roomId: room.roomId,
    status: computeRoomStatus(room),
    snapshot: room.game.getSnapshot(),
    log: room.log,
    dungeonMaster: dungeonMaster.info,
    characterArt: {
      player: toPublicCharacterArt(room.characterArt.player),
      enemy: toPublicCharacterArt(room.characterArt.enemy),
    },
    seats: {
      player: toSeatState("player", room.seats.player),
      enemy: toSeatState("enemy", room.seats.enemy),
    },
  };
}

function toJoinResponse(room: CombatRoom, seat: RoomSeat | null): RoomJoinResponse {
  if (!seat) {
    throw new Error("Missing seat while creating join response.");
  }

  return {
    room: toRoomView(room),
    connection: {
      roomId: room.roomId,
      participantToken: seat.participantToken,
      seat: seat.seat,
      displayName: seat.displayName,
    },
  };
}

function toLogEntry(turn: TurnResult, turnNumber: number, illustration: TurnIllustration): BattleLogEntry {
  return {
    id: crypto.randomUUID(),
    turnNumber,
    team: turn.resolution.actor.id,
    actor: turn.resolution.actor.name,
    actionText: turn.resolution.action.rawText,
    interpretedAction: turn.resolution.action.attack,
    interpretation: turn.narration.interpretation,
    outcome: turn.narration.outcome,
    roll: turn.resolution.roll,
    successChance: turn.resolution.successChance,
    succeeded: turn.resolution.succeeded,
    critical: turn.resolution.critical,
    damage: turn.resolution.damage,
    illustration,
  };
}

function toPublicCharacterArt(art: SessionCharacterArt["player"]) {
  return {
    name: art.name,
    description: art.description,
    ...(art.portraitUrl ? { portraitUrl: art.portraitUrl } : {}),
  };
}

function toSeatState(seat: Team, occupant: RoomSeat | null): RoomSeatState {
  return {
    seat,
    displayName: occupant?.displayName ?? (seat === "player" ? "Player One" : "Waiting Challenger"),
    joined: occupant !== null,
  };
}

function findSeatByToken(room: CombatRoom, token: string): RoomSeat | null {
  if (room.seats.player?.participantToken === token) {
    return room.seats.player;
  }

  if (room.seats.enemy?.participantToken === token) {
    return room.seats.enemy;
  }

  return null;
}

function computeRoomStatus(room: CombatRoom): RoomStatus {
  const snapshot = room.game.getSnapshot();
  if (snapshot.finished) {
    return "finished";
  }

  if (!room.seats.player || !room.seats.enemy) {
    return "waiting";
  }

  return "active";
}

function normalizeDisplayName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 24) : fallback;
}

function createRoomId(): string {
  let roomId = "";
  do {
    roomId = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (rooms.has(roomId));

  return roomId;
}

async function attachViteOrStatic(server: express.Express): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    const clientDist = path.resolve(root, "dist/client");
    server.use(express.static(clientDist));
    server.use((_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
    return;
  }

  const { createServer: createViteServer } = await import("vite");
  const vite: ViteDevServer = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
  });

  server.use(vite.middlewares);
  server.use(async (req, res, next) => {
    try {
      const url = req.originalUrl;
      const templatePath = path.resolve(root, "index.html");
      const template = fs.readFileSync(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

function createTurnIllustrator(): TurnIllustrator {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return new NoopTurnIllustrator();
  }

  const model = process.env.XAI_IMAGE_MODEL;
  const timeoutValue = Number(process.env.XAI_IMAGE_TIMEOUT_MS ?? 45000);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 45000;
  return new XaiTurnIllustrator(
    model ? { apiKey, rootDir: generatedRoot, model, timeoutMs } : { apiKey, rootDir: generatedRoot, timeoutMs },
  );
}
