import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { ViteDevServer } from "vite";
import { createRoom, getRoom, joinRoom, normalizeDisplayName, submitRoomAction } from "./room-service";
import type { CreateRoomRequest, JoinRoomRequest, SubmitActionRequest } from "./api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 5173);
const app = express();

app.use(express.json({ limit: "25mb" }));

app.post("/api/rooms", (req, res) => {
  try {
    const body = req.body as Partial<CreateRoomRequest>;
    res.json(createRoom(normalizeDisplayName(body.displayName, "Player One")));
  } catch (error) {
    res.status(500).json({ error: toMessage(error, "Could not create room.") });
  }
});

app.post("/api/rooms/:roomId/join", (req, res) => {
  try {
    const body = req.body as Partial<JoinRoomRequest>;
    res.json(joinRoom(req.params.roomId.toUpperCase(), normalizeDisplayName(body.displayName, "Player Two")));
  } catch (error) {
    res.status(statusForError(error)).json({ error: toMessage(error, "Could not join room.") });
  }
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId.toUpperCase());
  if (!room) {
    res.status(404).json({ error: "Unknown room." });
    return;
  }

  res.json(room);
});

app.post("/api/rooms/:roomId/action", async (req, res) => {
  const body = req.body as Partial<SubmitActionRequest>;
  const text = body.text?.trim();
  const participantToken = body.participantToken?.trim();

  if (!text || !participantToken) {
    res.status(400).json({ error: "Action text and participant token are required." });
    return;
  }

  try {
    res.json(await submitRoomAction(req.params.roomId.toUpperCase(), participantToken, text));
  } catch (error) {
    res.status(statusForError(error)).json({ error: toMessage(error, "Could not submit action.") });
  }
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
