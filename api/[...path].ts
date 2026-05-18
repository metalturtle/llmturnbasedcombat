import type { CreateRoomRequest, JoinRoomRequest, SubmitActionRequest } from "../src/api";

export default async function handler(req: any, res: any): Promise<void> {
  const method = String(req.method ?? "GET").toUpperCase();
  const pathSegments = normalizePathSegments(req.query?.path);
  const roomService = await import("../src/room-service");

  try {
    if (method === "POST" && matches(pathSegments, ["rooms"])) {
      const body = (req.body ?? {}) as Partial<CreateRoomRequest>;
      res.status(200).json(roomService.createRoom(body));
      return;
    }

    if (method === "POST" && pathSegments.length === 3 && pathSegments[0] === "rooms" && pathSegments[2] === "join") {
      const roomId = pathSegments[1]!;
      const body = (req.body ?? {}) as Partial<JoinRoomRequest>;
      res.status(200).json(roomService.joinRoom(roomId.toUpperCase(), body));
      return;
    }

    if (method === "GET" && pathSegments.length === 2 && pathSegments[0] === "rooms") {
      const roomId = pathSegments[1]!;
      const room = roomService.getRoom(roomId.toUpperCase());
      if (!room) {
        res.status(404).json({ error: "Unknown room." });
        return;
      }

      res.status(200).json(room);
      return;
    }

    if (method === "POST" && pathSegments.length === 3 && pathSegments[0] === "rooms" && pathSegments[2] === "action") {
      const roomId = pathSegments[1]!;
      const body = (req.body ?? {}) as Partial<SubmitActionRequest>;
      const text = body.text?.trim();
      const participantToken = body.participantToken?.trim();

      if (!text || !participantToken) {
        res.status(400).json({ error: "Action text and participant token are required." });
        return;
      }

      res.status(200).json(await roomService.submitRoomAction(roomId.toUpperCase(), participantToken, text));
      return;
    }

    res.status(404).json({ error: "Unknown API route." });
  } catch (error) {
    res.status(statusForError(error)).json({ error: toMessage(error, "API request failed.") });
  }
}

function normalizePathSegments(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((segment) => String(segment));
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  return [];
}

function matches(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((segment, index) => segment === expected[index]);
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
