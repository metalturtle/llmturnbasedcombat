import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { DungeonMaster, DungeonMasterInfo, ResolvedAction, TurnNarration } from "./combat";
import { RuleBasedDungeonMaster } from "./combat";

const narrationSchema = z.object({
  interpretation: z.string(),
  outcome: z.string(),
});

type OpenAIDungeonMasterOptions = {
  apiKey: string;
  model?: string;
  fallback?: DungeonMaster;
};

export class OpenAIDungeonMaster implements DungeonMaster {
  readonly info: DungeonMasterInfo;

  private readonly client: OpenAI;
  private readonly fallback: DungeonMaster;

  constructor(options: OpenAIDungeonMasterOptions) {
    const model = options.model ?? "gpt-5.4-mini";
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.fallback = options.fallback ?? new RuleBasedDungeonMaster();
    this.info = {
      provider: "openai",
      name: "OpenAIDungeonMaster",
      description: "Narration generated with the OpenAI Responses API.",
      model,
    };
  }

  async narrateTurn(result: ResolvedAction): Promise<TurnNarration> {
    try {
      const response = await this.client.responses.parse({
        model: this.info.model ?? "gpt-5.4-mini",
        input: [
          {
            role: "system",
            content:
              "You are a fantasy combat dungeon master. Write vivid but concise narration. Do not alter rules, stats, damage, success, failure, or turn order. The adjudicated scene summary is the source of truth for what physically happens. Do not upgrade failed or partial attempts into successful impossible feats. Return only the requested fields.",
          },
          {
            role: "user",
            content:
              "Narrate this resolved combat turn. Keep each field under 2 sentences.\n" +
              JSON.stringify(toNarrationPayload(result)),
          },
        ],
        text: {
          format: zodTextFormat(narrationSchema, "combat_turn_narration"),
        },
      });

      if (!response.output_parsed) {
        throw new Error("OpenAI returned no parsed narration.");
      }

      return response.output_parsed;
    } catch (error) {
      console.error("OpenAI narration failed, falling back to RuleBasedDungeonMaster.", error);
      return await this.fallback.narrateTurn(result);
    }
  }
}

function toNarrationPayload(result: ResolvedAction): Record<string, unknown> {
  return {
    actor: result.actor.name,
    target: result.target.name,
    rawAction: result.action.rawText,
    interpretedAction: result.action.attack,
    intentFamily: result.action.intentFamily,
    feasibility: result.action.feasibility,
    requirements: result.action.requirements,
    interpretationReason: result.action.reason,
    confidence: result.action.confidence,
    attemptSummary: result.action.attemptSummary,
    adjudicatedSummary: result.action.adjudicatedSummary,
    roll: result.roll,
    successChance: result.successChance,
    succeeded: result.succeeded,
    critical: result.critical,
    damage: result.damage,
    actorGuardBefore: result.actorGuardBefore,
    actorGuardAfter: result.actorGuardAfter,
    targetHpBefore: result.targetHpBefore,
    targetHpAfter: result.targetHpAfter,
  };
}
