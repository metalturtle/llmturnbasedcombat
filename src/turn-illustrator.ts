import { generateImage } from "ai";
import { createXai } from "@ai-sdk/xai";
import type { ResolvedAction } from "./combat";
import type { CharacterArt, TurnIllustration } from "./api";

export type SessionCharacterArt = {
  player: CharacterArt;
  enemy: CharacterArt;
};

export interface TurnIllustrator {
  hydratePortrait(sessionId: string, seat: "player" | "enemy", art: CharacterArt): Promise<CharacterArt>;
  illustrateTurn(sessionId: string, art: SessionCharacterArt, result: ResolvedAction): Promise<TurnIllustration>;
}

export class NoopTurnIllustrator implements TurnIllustrator {
  async hydratePortrait(_sessionId: string, _seat: "player" | "enemy", art: CharacterArt): Promise<CharacterArt> {
    return art;
  }

  async illustrateTurn(): Promise<TurnIllustration> {
    return {
      status: "unavailable",
      error: "Turn illustrations require an XAI_API_KEY.",
    };
  }
}

type XaiTurnIllustratorOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
};

export class XaiTurnIllustrator implements TurnIllustrator {
  private readonly xai;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: XaiTurnIllustratorOptions) {
    this.xai = createXai({ apiKey: options.apiKey });
    this.model = options.model ?? "grok-imagine-image-quality";
    this.timeoutMs = options.timeoutMs ?? 45000;
  }

  async hydratePortrait(sessionId: string, seat: "player" | "enemy", art: CharacterArt): Promise<CharacterArt> {
    if (!art.name.trim() || !art.description.trim()) {
      return art;
    }

    try {
      const portraitUrl = await this.generatePortrait(sessionId, seat, art);
      return { ...art, portraitUrl };
    } catch (error) {
      console.error("Character portrait generation failed.", error);
      return art;
    }
  }

  async illustrateTurn(sessionId: string, art: SessionCharacterArt, result: ResolvedAction): Promise<TurnIllustration> {
    try {
      const prompt = await buildTurnScenePrompt(art, result);
      const generated = await generateImage({
        model: this.xai.image(this.model),
        prompt,
        size: "1536x1024",
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });

      return {
        status: "ready",
        sceneUrl: toDataUrl(generated.image.base64, generated.image.mediaType),
      };
    } catch (error) {
      console.error("Turn illustration failed.", error);
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Turn illustration failed.",
      };
    }
  }

  private async generatePortrait(sessionId: string, seat: "player" | "enemy", art: CharacterArt): Promise<string> {
    const generated = await generateImage({
      model: this.xai.image(this.model),
      prompt: buildPortraitPrompt(art, seat),
      size: "1024x1024",
      abortSignal: AbortSignal.timeout(this.timeoutMs),
    });

    return toDataUrl(generated.image.base64, generated.image.mediaType);
  }
}

export function createFallbackCharacterArt(
  player: Pick<CharacterArt, "name" | "description">,
  enemy: Pick<CharacterArt, "name" | "description">,
): SessionCharacterArt {
  return {
    player: { name: player.name, description: player.description },
    enemy: { name: enemy.name, description: enemy.description },
  };
}

function buildPortraitPrompt(art: CharacterArt, seat: "player" | "enemy"): string {
  return [
    `Create a full-body character portrait of ${art.name}.`,
    `Character description: ${art.description}`,
    `This is the ${seat === "player" ? "host fighter" : "joining challenger"} in a two-person martial-arts duel.`,
    "Base the drawing directly on Akira Toriyama's classic adventure manga art language: playful expressions, clean bold linework, rounded but powerful anatomy, bright color blocking, comedic confidence, and badass tournament energy.",
    "Keep the silhouette clear, the costume memorable, and the face highly readable.",
    `Preserve exact identity cues for ${art.name} so the same fighter can be recognized in later action scenes.`,
    "No background crowd, no text, no logo, no UI.",
  ].join(" ");
}

async function buildTurnScenePrompt(art: SessionCharacterArt, result: ResolvedAction): Promise<string | { text: string; images: string[] }> {
  const text = [
    "Create a stylized martial-arts action illustration based directly on Akira Toriyama's classic adventure manga look.",
    "Do not default to the coolest possible pose. Depict the adjudicated physical outcome exactly.",
    "Use clean, confident linework, exaggerated expressions, springy body language, bold speed lines, punchy impact posing, bright saturated colors, comedic charm, and a fun-but-badass tone.",
    "Favor adventurous tournament-arc energy over grim realism: spirited, mischievous, dynamic, readable, and full of momentum.",
    `Character one: ${art.player.name}. ${art.player.description}`,
    `Character two: ${art.enemy.name}. ${art.enemy.description}`,
    `Raw action text: "${result.action.rawText}".`,
    `Attempt summary: ${result.action.attemptSummary}`,
    `Feasibility: ${result.action.feasibility}.`,
    `Resolved scene summary: ${result.action.adjudicatedSummary}`,
    `Mechanical result: success=${String(result.succeeded)}, damage=${String(result.damage)}, target HP after=${String(result.targetHpAfter)}.`,
    "The resolved scene summary is binding. Show the attempt as it actually plays out under the rules, including failure or partial failure.",
    "Do not upgrade impossible actions into successful ones. Do not turn resting or defensive moves into attacks.",
    "Even failed attempts should feel playful and characterful rather than static, but they must remain physically truthful to the adjudicated scene.",
    "No text, captions, HUD, or extra characters.",
  ].join(" ");

  const referenceImages = [art.player.portraitUrl, art.enemy.portraitUrl].filter((value): value is string => Boolean(value));
  if (referenceImages.length === 0) {
    return text;
  }

  return {
    text,
    images: referenceImages,
  };
}

function toDataUrl(base64: string, mediaType: string): string {
  return `data:${mediaType};base64,${base64}`;
}
