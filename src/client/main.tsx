import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Character } from "../combat";
import type { BattleLogEntry, CombatRoomView, RoomConnection, RoomJoinResponse } from "../api";
import "./styles.css";

type LoadState = "lobby" | "loading" | "ready" | "error";
type StoredConnection = RoomConnection;

function App(): React.ReactElement {
  const [room, setRoom] = useState<CombatRoomView | null>(null);
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [action, setAction] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("lobby");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room")?.toUpperCase() ?? "";
    if (!roomId) {
      return;
    }

    setJoinRoomId(roomId);
    const stored = readStoredConnection(roomId);
    if (!stored) {
      return;
    }

    setConnection(stored);
    void refreshRoom(roomId, stored);
  }, []);

  useEffect(() => {
    if (!room || !connection) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshRoom(room.roomId, connection);
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [room?.roomId, connection?.participantToken]);

  const latest = useMemo(() => room?.log.at(-1), [room]);
  const yourTurn = room && connection ? room.status === "active" && room.snapshot.activeTurn === connection.seat : false;

  async function createRoom(): Promise<void> {
    setLoadState("loading");
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = await readJson<RoomJoinResponse>(response);
      writeStoredConnection(payload.connection);
      window.history.replaceState(null, "", `?room=${payload.room.roomId}`);
      setConnection(payload.connection);
      setRoom(payload.room);
      setAction("");
      setJoinRoomId(payload.room.roomId);
      setLoadState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create room.");
      setLoadState("error");
    }
  }

  async function joinRoom(): Promise<void> {
    const roomId = joinRoomId.trim().toUpperCase();
    if (!roomId) {
      setError("Room ID is required.");
      return;
    }

    setLoadState("loading");
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = await readJson<RoomJoinResponse>(response);
      writeStoredConnection(payload.connection);
      window.history.replaceState(null, "", `?room=${payload.room.roomId}`);
      setConnection(payload.connection);
      setRoom(payload.room);
      setAction("");
      setLoadState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join room.");
      setLoadState("error");
    }
  }

  async function refreshRoom(roomId: string, activeConnection: RoomConnection): Promise<void> {
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      const nextRoom = await readJson<CombatRoomView>(response);
      setRoom(nextRoom);
      setConnection(activeConnection);
      setLoadState("ready");
    } catch {
      // Ignore polling failures and keep the current UI state.
    }
  }

  function leaveRoom(): void {
    if (connection) {
      clearStoredConnection(connection.roomId);
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoom(null);
    setConnection(null);
    setAction("");
    setError(null);
    setLoadState("lobby");
  }

  async function submitAction(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!room || !connection || !action.trim() || room.snapshot.finished || !yourTurn) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${room.roomId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: action, participantToken: connection.participantToken }),
      });
      setRoom(await readJson<CombatRoomView>(response));
      setAction("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit action.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return <main className="shell status">Loading combat...</main>;
  }

  if (!room || !connection || loadState === "lobby") {
    return (
      <main className="shell lobby">
        <section className="topbar">
          <div>
            <p className="eyebrow">Dungeon Master</p>
            <h1>Turn Combat Rooms</h1>
          </div>
        </section>

        <section className="lobby-grid">
          <article className="center-panel">
            <h2>Identity</h2>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your fighter name"
              aria-label="Display name"
            />
          </article>

          <article className="center-panel">
            <h2>Create Room</h2>
            <button onClick={() => void createRoom()}>Create Room</button>
          </article>

          <article className="center-panel">
            <h2>Join Room</h2>
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value.toUpperCase())}
              placeholder="Room ID"
              aria-label="Room ID"
            />
            <button className="secondary" onClick={() => void joinRoom()}>
              Join Room
            </button>
          </article>
        </section>

        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Dungeon Master</p>
          <h1>Turn Combat</h1>
          <small className="room-code">Room {room.roomId} | You are {connection.displayName}</small>
        </div>
        <div className="dm-panel">
          <span>{room.dungeonMaster.name}</span>
          <small>{room.dungeonMaster.description}</small>
          {room.dungeonMaster.model ? <small>Model: {room.dungeonMaster.model}</small> : null}
        </div>
      </section>

      <section className="battlefield">
        <CombatantPanel
          character={room.snapshot.player}
          art={room.characterArt.player}
          side="player"
          seat={room.seats.player}
        />
        <div className="center-panel">
          <div className="turn-marker">
            <span>Turn</span>
            <strong>{room.status === "waiting" ? "Waiting" : room.snapshot.finished ? "Finished" : room.snapshot.activeTurn}</strong>
          </div>
          <div className="seat-status">
            <small>Player seat: {room.seats.player.displayName}</small>
            <small>Enemy seat: {room.seats.enemy.joined ? room.seats.enemy.displayName : "Open"}</small>
          </div>
          {room.status === "waiting" ? (
            <div className="empty-log">Waiting for another player to join room {room.roomId}.</div>
          ) : null}
          {latest ? <LatestResult entry={latest} /> : <div className="empty-log">Awaiting first move.</div>}
        </div>
        <CombatantPanel
          character={room.snapshot.enemy}
          art={room.characterArt.enemy}
          side="enemy"
          seat={room.seats.enemy}
        />
      </section>

      <section className="command-row">
        <form onSubmit={(event) => void submitAction(event)} className="action-form">
          <input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            disabled={submitting || room.snapshot.finished || room.status !== "active" || !yourTurn}
            placeholder="give a flying uppercut to the enemy"
            aria-label="Combat action"
          />
          <button disabled={submitting || !action.trim() || room.snapshot.finished || room.status !== "active" || !yourTurn}>
            {submitting ? "Resolving" : "Attack"}
          </button>
        </form>
        <button className="secondary" onClick={leaveRoom}>
          Leave Room
        </button>
      </section>

      {!yourTurn && room.status === "active" && !room.snapshot.finished ? (
        <p className="muted">Waiting for {room.snapshot.activeTurn === "player" ? room.seats.player.displayName : room.seats.enemy.displayName}.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="log">
        <h2>Battle Log</h2>
        <div className="log-list">
          {room.log.length === 0 ? (
            <p className="muted">No turns resolved.</p>
          ) : (
            room.log.map((entry) => <LogEntry key={entry.id} entry={entry} />)
          )}
        </div>
      </section>
    </main>
  );
}

function CombatantPanel({
  character,
  art,
  side,
  seat,
}: {
  character: Character;
  art: CombatRoomView["characterArt"]["player"];
  side: "player" | "enemy";
  seat: CombatRoomView["seats"]["player"];
}): React.ReactElement {
  const hpPercent = Math.round((character.hp / character.maxHp) * 100);

  return (
    <article className={`combatant ${side}`}>
      {art.portraitUrl ? <img className="portrait" src={art.portraitUrl} alt={character.name} /> : null}
      <div className="combatant-header">
        <div>
          <p className="eyebrow">{side}</p>
          <h2>{character.name}</h2>
          <small className="muted">{seat.joined ? seat.displayName : "Open seat"}</small>
        </div>
        <strong>
          {character.hp}/{character.maxHp}
        </strong>
      </div>
      <div className="hp-track" aria-label={`${character.name} hit points`}>
        <div style={{ width: `${hpPercent}%` }} />
      </div>
      <dl className="stats">
        <Stat label="STR" value={character.stats.strength} />
        <Stat label="AGI" value={character.stats.agility} />
        <Stat label="SPD" value={character.stats.speed} />
        <Stat label="DEF" value={character.stats.defense} />
      </dl>
      <div className="guard">Guard {character.guard}</div>
      <p className="art-note">{art.description}</p>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LatestResult({ entry }: { entry: BattleLogEntry }): React.ReactElement {
  return (
    <div className="latest">
      <span className={`pill ${entry.succeeded ? "success" : "miss"}`}>
        {entry.interpretedAction}
        {entry.critical ? " crit" : ""}
      </span>
      <small>"{entry.actionText}"</small>
      {entry.illustration.sceneUrl ? (
        <img className="turn-scene" src={entry.illustration.sceneUrl} alt={`Turn ${entry.turnNumber} scene`} />
      ) : entry.illustration.status === "pending" ? (
        <p className="muted">Illustration pending...</p>
      ) : null}
      <p>{entry.outcome}</p>
      <small>
        Roll {entry.roll} / {entry.successChance}%, Damage {entry.damage}
      </small>
    </div>
  );
}

function LogEntry({ entry }: { entry: BattleLogEntry }): React.ReactElement {
  return (
    <article className={`log-entry ${entry.team}`}>
      <header>
        <strong>
          Turn {entry.turnNumber}: {entry.actor}
        </strong>
        <span>{entry.interpretedAction}</span>
      </header>
      {entry.illustration.sceneUrl ? (
        <img className="turn-scene" src={entry.illustration.sceneUrl} alt={`Turn ${entry.turnNumber} scene`} />
      ) : entry.illustration.status === "pending" ? (
        <p className="muted">Illustration pending...</p>
      ) : (
        <p className="muted">{entry.illustration.error ?? "Illustration unavailable."}</p>
      )}
      <p className="action-text">"{entry.actionText}"</p>
      <p>{entry.interpretation}</p>
      <p>{entry.outcome}</p>
      <footer>
        Roll {entry.roll} vs {entry.successChance}% | Damage {entry.damage}
      </footer>
    </article>
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const error = isErrorBody(body) ? body.error : "Request failed.";
    throw new Error(error);
  }

  return body as T;
}

function isErrorBody(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

function storageKey(roomId: string): string {
  return `turn-combat-room:${roomId}`;
}

function writeStoredConnection(connection: RoomConnection): void {
  const value: StoredConnection = connection;
  window.localStorage.setItem(storageKey(connection.roomId), JSON.stringify(value));
}

function readStoredConnection(roomId: string): StoredConnection | null {
  const raw = window.localStorage.getItem(storageKey(roomId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredConnection;
  } catch {
    return null;
  }
}

function clearStoredConnection(roomId: string): void {
  window.localStorage.removeItem(storageKey(roomId));
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
