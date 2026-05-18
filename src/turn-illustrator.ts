import { generateImage } from "ai";
import { createXai } from "@ai-sdk/xai";
import type { Character, ResolvedAction } from "./combat";
import type { CharacterArt, TurnIllustration } from "./api";

type VisualProfile = {
  shortLabel: string;
  description: string;
};

export type SessionCharacterArt = {
  player: CharacterArt;
  enemy: CharacterArt;
};

export interface TurnIllustrator {
  createCharacterArt(sessionId: string, player: Character, enemy: Character): Promise<SessionCharacterArt>;
  illustrateTurn(sessionId: string, art: SessionCharacterArt, result: ResolvedAction): Promise<TurnIllustration>;
}

export class NoopTurnIllustrator implements TurnIllustrator {
  async createCharacterArt(_sessionId: string, player: Character, enemy: Character): Promise<SessionCharacterArt> {
    return createFallbackCharacterArt(player, enemy);
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

  async createCharacterArt(sessionId: string, player: Character, enemy: Character): Promise<SessionCharacterArt> {
    const fallback = createFallbackCharacterArt(player, enemy);

    try {
      const playerArt = await this.generatePortrait(sessionId, player.name, defaultVisualProfiles.player);
      const enemyArt = await this.generatePortrait(sessionId, enemy.name, defaultVisualProfiles.enemy);

      return {
        player: {
          ...fallback.player,
          portraitUrl: playerArt,
        },
        enemy: {
          ...fallback.enemy,
          portraitUrl: enemyArt,
        },
      };
    } catch (error) {
      console.error("Character portrait generation failed.", error);
      return fallback;
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

  private async generatePortrait(sessionId: string, name: string, profile: VisualProfile): Promise<string> {
    const generated = await generateImage({
      model: this.xai.image(this.model),
      prompt: buildPortraitPrompt(name, profile),
      size: "1024x1024",
      abortSignal: AbortSignal.timeout(this.timeoutMs),
    });

    return toDataUrl(generated.image.base64, generated.image.mediaType);
  }
}

const defaultVisualProfiles: Record<"player" | "enemy", VisualProfile> = {
  player: {
    shortLabel: "Player Brawler",
    description:
      "Athletic young arena brawler with short black hair, warm brown skin, teal combat jacket with gold trim, dark trousers, cobalt boxing gloves, and a determined expression.",
  },
  enemy: {
    shortLabel: "Ash Duelist",
    description:
      "Lean ember duelist with ash-gray hair, pale skin, a crimson-and-black longcoat, ember-glow gauntlets, scorched leather boots, and a severe expression framed by drifting sparks.",
  },
};

export function createFallbackCharacterArt(player: Character, enemy: Character): SessionCharacterArt {
  return {
    player: { name: player.name, description: defaultVisualProfiles.player.description },
    enemy: { name: enemy.name, description: defaultVisualProfiles.enemy.description },
  };
}

function buildPortraitPrompt(name: string, profile: VisualProfile): string {
  return [
    `Create a stylized fantasy character portrait of ${name}.`,
    profile.description,
    "Full body, readable silhouette, expressive face, crisp linework, playful heroic energy, bold costume shapes, and consistent costume details.",
    "Lean toward classic martial-arts adventure manga energy: mischievous charm, compact powerful anatomy, bright color blocking, and upbeat badass attitude.",
    `Keep the design stable under the label ${profile.shortLabel}.`,
  ].join(" ");
}

async function buildTurnScenePrompt(art: SessionCharacterArt, result: ResolvedAction): Promise<string | { text: string; images: string[] }> {
  const text = [
    "Create a stylized fantasy action illustration with playful martial-arts adventure energy.",
    "Do not default to the coolest possible pose. Depict the adjudicated physical outcome exactly.",
    "Use clean, confident linework, exaggerated expressions, springy body language, bold speed lines, punchy impact posing, bright saturated colors, and a fun-but-badass tone.",
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

  if (!art.player.portraitUrl || !art.enemy.portraitUrl) {
    return text;
  }

  return {
    text,
    images: [art.player.portraitUrl, art.enemy.portraitUrl],
  };
}

function toDataUrl(base64: string, mediaType: string): string {
  return `data:${mediaType};base64,${base64}`;
}
