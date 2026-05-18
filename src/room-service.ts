import crypto from "node:crypto";
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
  RoomJoinResponse,
  RoomSeatState,
  RoomStatus,
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

const rooms = new Map<string, CombatRoom>();
const dungeonMaster = createDungeonMaster();
const turnIllustrator = createTurnIllustrator();

export function createRoom(displayName: string): RoomJoinResponse {
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
  return toJoinResponse(room, room.seats.player);
}

export function joinRoom(roomId: string, displayName: string): RoomJoinResponse {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Unknown room.");
  }

  if (room.seats.enemy) {
    throw new Error("Room already has two players.");
  }

  const participantToken = crypto.randomUUID();
  const enemySeat: RoomSeat = { seat: "enemy", displayName, participantToken };
  room.seats.enemy = enemySeat;
  room.status = room.game.getSnapshot().finished ? "finished" : "active";
  room.game.renameCombatant("enemy", displayName);
  room.characterArt.enemy.name = displayName;

  return toJoinResponse(room, enemySeat);
}

export function getRoom(roomId: string): CombatRoomView | null {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  room.status = computeRoomStatus(room);
  return toRoomView(room);
}

export async function submitRoomAction(roomId: string, participantToken: string, text: string): Promise<CombatRoomView> {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Unknown room.");
  }

  const actingSeat = findSeatByToken(room, participantToken);
  if (!actingSeat) {
    throw new Error("Invalid participant token.");
  }

  if (room.status !== "active") {
    throw new Error(room.status === "waiting" ? "Waiting for another player to join." : "Combat is already finished.");
  }

  const snapshot = room.game.getSnapshot();
  if (snapshot.finished) {
    room.status = "finished";
    return toRoomView(room);
  }

  if (snapshot.activeTurn !== actingSeat.seat) {
    throw new Error("It is not your turn.");
  }

  const turn = await room.game.submitAction(text);
  const entry = toLogEntry(turn, room.log.length + 1, { status: "pending" });
  room.log.push(entry);
  void hydrateTurnIllustration(roomId, room, entry, turn.resolution);
  room.status = computeRoomStatus(room);

  return toRoomView(room);
}

export function normalizeDisplayName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 24) : fallback;
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

function createRoomId(): string {
  let roomId = "";
  do {
    roomId = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (rooms.has(roomId));

  return roomId;
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

function createTurnIllustrator(): TurnIllustrator {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return new NoopTurnIllustrator();
  }

  const model = process.env.XAI_IMAGE_MODEL;
  const timeoutValue = Number(process.env.XAI_IMAGE_TIMEOUT_MS ?? 45000);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 45000;
  return new XaiTurnIllustrator(model ? { apiKey, model, timeoutMs } : { apiKey, timeoutMs });
}
