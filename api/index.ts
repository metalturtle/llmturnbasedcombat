import { createRoom, getRoom, joinRoom, normalizeDisplayName, submitRoomAction } from "../src/room-service";
import type { CreateRoomRequest, JoinRoomRequest, SubmitActionRequest } from "../src/api";

export default async function handler(req: any, res: any): Promise<void> {
  const method = String(req.method ?? "GET").toUpperCase();
  const url = new URL(String(req.url ?? "/api"), "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "");
  const path = pathname.startsWith("/api") ? pathname.slice(4) || "/" : pathname || "/";

  try {
    if (method === "POST" && path === "/rooms") {
      const body = (req.body ?? {}) as Partial<CreateRoomRequest>;
      res.status(200).json(createRoom(normalizeDisplayName(body.displayName, "Player One")));
      return;
    }

    const joinMatch = path.match(/^\/rooms\/([^/]+)\/join$/);
    if (method === "POST" && joinMatch) {
      const roomId = joinMatch[1]!;
      const body = (req.body ?? {}) as Partial<JoinRoomRequest>;
      res.status(200).json(joinRoom(roomId.toUpperCase(), normalizeDisplayName(body.displayName, "Player Two")));
      return;
    }

    const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
    if (method === "GET" && roomMatch) {
      const roomId = roomMatch[1]!;
      const room = getRoom(roomId.toUpperCase());
      if (!room) {
        res.status(404).json({ error: "Unknown room." });
        return;
      }

      res.status(200).json(room);
      return;
    }

    const actionMatch = path.match(/^\/rooms\/([^/]+)\/action$/);
    if (method === "POST" && actionMatch) {
      const roomId = actionMatch[1]!;
      const body = (req.body ?? {}) as Partial<SubmitActionRequest>;
      const text = body.text?.trim();
      const participantToken = body.participantToken?.trim();

      if (!text || !participantToken) {
        res.status(400).json({ error: "Action text and participant token are required." });
        return;
      }

      res.status(200).json(await submitRoomAction(roomId.toUpperCase(), participantToken, text));
      return;
    }

    res.status(404).json({ error: "Unknown API route." });
  } catch (error) {
    res.status(statusForError(error)).json({ error: toMessage(error, "API request failed.") });
  }
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusForError(error: unknown): number {
  const message = toMessage(error, "");
  if (message === "Unknown room.") {
    return 404;
  }

  if (message === "Invalid participant token.") {
    return 403;
  }

  if (message.includes("already") || message.includes("Waiting") || message.includes("turn") || message.includes("finished")) {
    return 409;
  }

  return 400;
}
