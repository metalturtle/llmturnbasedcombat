import type { AttackKind, DungeonMasterInfo, GameSnapshot, Team } from "./combat";

export type TurnIllustration = {
  status: "pending" | "ready" | "failed" | "unavailable";
  sceneUrl?: string;
  error?: string;
};

export type CharacterArt = {
  name: string;
  description: string;
  portraitUrl?: string;
};

export type BattleLogEntry = {
  id: string;
  turnNumber: number;
  team: Team;
  actor: string;
  actionText: string;
  interpretedAction: AttackKind;
  interpretation: string;
  outcome: string;
  roll: number;
  successChance: number;
  succeeded: boolean;
  critical: boolean;
  damage: number;
  illustration: TurnIllustration;
};

export type RoomStatus = "waiting" | "active" | "finished";

export type RoomSeatState = {
  seat: Team;
  displayName: string;
  joined: boolean;
};

export type CombatRoomView = {
  roomId: string;
  status: RoomStatus;
  snapshot: GameSnapshot;
  log: BattleLogEntry[];
  dungeonMaster: DungeonMasterInfo;
  characterArt: {
    player: CharacterArt;
    enemy: CharacterArt;
  };
  seats: {
    player: RoomSeatState;
    enemy: RoomSeatState;
  };
};

export type RoomConnection = {
  roomId: string;
  participantToken: string;
  seat: Team;
  displayName: string;
};

export type RoomJoinResponse = {
  room: CombatRoomView;
  connection: RoomConnection;
};

export type CreateRoomRequest = {
  displayName?: string;
};

export type JoinRoomRequest = {
  displayName?: string;
};

export type SubmitActionRequest = {
  text: string;
  participantToken: string;
};
