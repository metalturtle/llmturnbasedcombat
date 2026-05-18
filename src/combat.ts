export type AttackKind = "box" | "fire" | "defend" | "idle";
export type IntentFamily = "attack" | "magic" | "mobility" | "defense" | "rest" | "weird";
export type Feasibility = "supported" | "partial" | "unsupported";
export type ActionRequirement = "flight" | "fire_magic" | "acrobatics" | "boxing";

export type Team = "player" | "enemy";

export type Stats = {
  strength: number;
  agility: number;
  speed: number;
  defense: number;
};

export type Character = {
  id: Team;
  name: string;
  hp: number;
  maxHp: number;
  stats: Stats;
  guard: number;
  capabilities: {
    canUseFire: boolean;
    canFly: boolean;
    boxingSkill: number;
    acrobatics: number;
    discipline: number;
  };
};

export type InterpretedAction = {
  rawText: string;
  attack: AttackKind;
  intentFamily: IntentFamily;
  feasibility: Feasibility;
  requirements: ActionRequirement[];
  attemptSummary: string;
  adjudicatedSummary: string;
  confidence: number;
  reason: string;
  successChanceModifier: number;
  damageMultiplier: number;
};

export type ResolvedAction = {
  actor: Character;
  target: Character;
  action: InterpretedAction;
  roll: number;
  successChance: number;
  succeeded: boolean;
  critical: boolean;
  damage: number;
  targetHpBefore: number;
  targetHpAfter: number;
  actorGuardBefore: number;
  actorGuardAfter: number;
};

export type TurnNarration = {
  interpretation: string;
  outcome: string;
};

export type DungeonMasterInfo = {
  provider: "rule-based" | "openai";
  name: string;
  description: string;
  model?: string;
};

export interface DungeonMaster {
  readonly info: DungeonMasterInfo;
  narrateTurn(result: ResolvedAction): Promise<TurnNarration> | TurnNarration;
}

export type GameSnapshot = {
  player: Character;
  enemy: Character;
  activeTurn: Team;
  finished: boolean;
  winner?: Team;
};

export type TurnResult = {
  snapshot: GameSnapshot;
  resolution: ResolvedAction;
  narration: TurnNarration;
};

export type Rng = () => number;

type AttackProfile = {
  baseDamage: number;
  baseChance: number;
  strengthScale: number;
  agilityScale: number;
  speedScale: number;
  defenseBypass: number;
};

const attackProfiles: Record<AttackKind, AttackProfile> = {
  box: {
    baseDamage: 9,
    baseChance: 64,
    strengthScale: 1.5,
    agilityScale: 0.7,
    speedScale: 0.4,
    defenseBypass: 0.15,
  },
  fire: {
    baseDamage: 12,
    baseChance: 56,
    strengthScale: 0.8,
    agilityScale: 0.4,
    speedScale: 0.7,
    defenseBypass: 0.35,
  },
  defend: {
    baseDamage: 0,
    baseChance: 100,
    strengthScale: 0,
    agilityScale: 0,
    speedScale: 0,
    defenseBypass: 0,
  },
  idle: {
    baseDamage: 0,
    baseChance: 100,
    strengthScale: 0,
    agilityScale: 0,
    speedScale: 0,
    defenseBypass: 0,
  },
};

const boxWords = [
  "box",
  "boxing",
  "punch",
  "uppercut",
  "jab",
  "hook",
  "kick",
  "strike",
  "slam",
  "elbow",
  "knee",
];

const fireWords = [
  "fire",
  "flame",
  "burn",
  "ignite",
  "ember",
  "inferno",
  "blast",
  "scorch",
  "pyro",
];

const defendWords = ["defend", "guard", "block", "brace", "dodge", "evade", "shield"];
const idleWords = ["idle", "wait", "rest", "sleep", "pause", "nothing", "still", "hesitate", "kneel", "lie down"];

export function createDefaultCombatants(): { player: Character; enemy: Character } {
  return {
    player: {
      id: "player",
      name: "Player",
      hp: 100,
      maxHp: 100,
      guard: 0,
      stats: {
        strength: 8,
        agility: 6,
        speed: 7,
        defense: 5,
      },
      capabilities: {
        canUseFire: true,
        canFly: false,
        boxingSkill: 7,
        acrobatics: 4,
        discipline: 5,
      },
    },
    enemy: {
      id: "enemy",
      name: "Ash Duelist",
      hp: 92,
      maxHp: 92,
      guard: 0,
      stats: {
        strength: 7,
        agility: 7,
        speed: 6,
        defense: 6,
      },
      capabilities: {
        canUseFire: true,
        canFly: false,
        boxingSkill: 5,
        acrobatics: 5,
        discipline: 7,
      },
    },
  };
}

export function interpretAction(text: string, actor: Character): InterpretedAction {
  const normalized = text.toLowerCase();
  const scores: Record<AttackKind, number> = {
    box: scoreWords(normalized, boxWords),
    fire: scoreWords(normalized, fireWords),
    defend: scoreWords(normalized, defendWords),
    idle: scoreWords(normalized, idleWords),
  };
  const wantsFlight = hasAny(normalized, ["fly", "flight", "airborne", "hover", "soar", "take off", "wings"]);
  const wantsRest = hasAny(normalized, ["sleep", "nap", "rest", "lie down", "curl up"]);
  const wantsAcrobatics = hasAny(normalized, ["spin", "spinning", "flip", "cartwheel", "somersault", "twirl"]);
  const wantsPhysical = scores.box > 0;
  const wantsFire = scores.fire > 0;
  const wantsDefend = scores.defend > 0;
  const bestScore = Math.max(...Object.values(scores));

  const intentFamily: IntentFamily = wantsRest
    ? "rest"
    : wantsDefend
      ? "defense"
      : wantsFire
        ? "magic"
        : wantsFlight
          ? "mobility"
          : wantsPhysical
            ? "attack"
            : "weird";

  const requirements: ActionRequirement[] = [];
  if (wantsFlight) {
    requirements.push("flight");
  }
  if (wantsFire) {
    requirements.push("fire_magic");
  }
  if (wantsAcrobatics || (wantsFlight && wantsPhysical)) {
    requirements.push("acrobatics");
  }
  if (wantsPhysical) {
    requirements.push("boxing");
  }

  const confidence = bestScore === 0 ? 0.35 : Math.min(0.95, 0.45 + bestScore * 0.15);
  return adjudicateAction({
    actor,
    rawText: text,
    normalized,
    intentFamily,
    requirements,
    wantsFlight,
    wantsRest,
    wantsAcrobatics,
    wantsPhysical,
    wantsFire,
    wantsDefend,
    confidence,
  });
}

export class RuleBasedDungeonMaster implements DungeonMaster {
  readonly info: DungeonMasterInfo = {
    provider: "rule-based",
    name: "RuleBasedDungeonMaster",
    description: "Local template narrator. No external LLM is called.",
  };

  narrateTurn(result: ResolvedAction): TurnNarration {
    return {
      interpretation: this.narrateInterpretation(result.actor, result.target, result.action),
      outcome: this.narrateOutcome(result),
    };
  }

  private narrateInterpretation(actor: Character, target: Character, action: InterpretedAction): string {
    if (action.feasibility === "unsupported") {
      return `${actor.name} tries "${action.rawText}", but the move asks for abilities they do not have. ${action.attemptSummary}`;
    }

    if (action.feasibility === "partial") {
      return `${actor.name} attempts "${action.rawText}", but the move only partially fits their abilities. ${action.attemptSummary}`;
    }

    return `${actor.name} commits to "${action.rawText}" with a clear plan. ${action.attemptSummary}`;
  }

  private narrateOutcome(result: ResolvedAction): string {
    const { actor, target, action } = result;

    if (action.attack === "idle") {
      return `${action.adjudicatedSummary} ${target.name} remains at ${result.targetHpAfter}/${target.maxHp} HP.`;
    }

    if (action.attack === "defend") {
      return `${action.adjudicatedSummary} Their guard rises for the next exchange.`;
    }

    if (!result.succeeded) {
      return `${action.adjudicatedSummary} ${target.name} avoids the real danger and the move fails to connect.`;
    }

    const criticalText = result.critical ? " The timing is perfect, turning the hit into a brutal critical blow." : "";
    const hpText = `${target.name} takes ${result.damage} damage and drops to ${result.targetHpAfter}/${target.maxHp} HP.`;
    return `${action.adjudicatedSummary}${criticalText} ${hpText}`;
  }
}

export class CombatGame {
  private player: Character;
  private enemy: Character;
  private activeTurn: Team = "player";

  constructor(
    combatants = createDefaultCombatants(),
    private readonly dungeonMaster: DungeonMaster = new RuleBasedDungeonMaster(),
    private readonly rng: Rng = Math.random,
  ) {
    this.player = cloneCharacter(combatants.player);
    this.enemy = cloneCharacter(combatants.enemy);
  }

  getSnapshot(): GameSnapshot {
    const winner = this.player.hp <= 0 ? "enemy" : this.enemy.hp <= 0 ? "player" : undefined;

    return {
      player: cloneCharacter(this.player),
      enemy: cloneCharacter(this.enemy),
      activeTurn: this.activeTurn,
      finished: winner !== undefined,
      ...(winner ? { winner } : {}),
    };
  }

  async submitAction(text: string): Promise<TurnResult> {
    const snapshot = this.getSnapshot();
    if (snapshot.finished) {
      throw new Error("Combat is already finished.");
    }

    const actor = this.activeTurn === "player" ? this.player : this.enemy;
    const target = this.activeTurn === "player" ? this.enemy : this.player;
    const action = interpretAction(text, actor);
    const resolution = resolveAction(actor, target, action, this.rng);

    if (target.hp > 0) {
      this.activeTurn = this.activeTurn === "player" ? "enemy" : "player";
    }

    const narration = await this.dungeonMaster.narrateTurn(resolution);

    return {
      snapshot: this.getSnapshot(),
      resolution,
      narration,
    };
  }

  chooseBotAction(): string {
    const bot = this.enemy;
    const player = this.player;

    if (bot.hp < bot.maxHp * 0.3 && bot.guard === 0) {
      return "brace behind a guarded stance";
    }

    if (player.stats.defense >= 7 || bot.hp < player.hp) {
      return "hurl a focused fire blast at the player";
    }

    return "step in with a sharp hook punch";
  }

  renameCombatant(team: Team, name: string): void {
    if (team === "player") {
      this.player.name = name;
      return;
    }

    this.enemy.name = name;
  }
}

export function resolveAction(actor: Character, target: Character, action: InterpretedAction, rng: Rng): ResolvedAction {
  const actorGuardBefore = actor.guard;
  const actorGuardAfter = action.attack === "defend" ? 12 + actor.stats.defense : action.attack === "idle" ? actor.guard : 0;
  const targetHpBefore = target.hp;
  const profile = attackProfiles[action.attack];

  if (action.attack === "idle") {
    return {
      actor: cloneCharacter(actor),
      target: cloneCharacter(target),
      action,
      roll: 1,
      successChance: 100,
      succeeded: true,
      critical: false,
      damage: 0,
      targetHpBefore,
      targetHpAfter: target.hp,
      actorGuardBefore,
      actorGuardAfter,
    };
  }

  if (action.attack === "defend") {
    actor.guard = actorGuardAfter;
    return {
      actor: cloneCharacter(actor),
      target: cloneCharacter(target),
      action,
      roll: 1,
      successChance: 100,
      succeeded: true,
      critical: false,
      damage: 0,
      targetHpBefore,
      targetHpAfter: target.hp,
      actorGuardBefore,
      actorGuardAfter,
    };
  }

  const successChance = clamp(
    profile.baseChance +
      actor.stats.agility * 2 +
      actor.stats.speed * 1.5 -
      target.stats.agility * 1.7 -
      target.stats.speed * 0.8 +
      action.successChanceModifier,
    10,
    95,
  );
  const roll = Math.floor(rng() * 100) + 1;
  const succeeded = roll <= successChance;
  const critical = succeeded && roll <= Math.max(6, successChance * 0.12);
  const damage = succeeded ? calculateDamage(actor, target, profile, critical, action.damageMultiplier) : 0;

  actor.guard = 0;
  target.hp = Math.max(0, target.hp - damage);

  return {
    actor: cloneCharacter(actor),
    target: cloneCharacter(target),
    action,
    roll,
    successChance: Math.round(successChance),
    succeeded,
    critical,
    damage,
    targetHpBefore,
    targetHpAfter: target.hp,
    actorGuardBefore,
    actorGuardAfter: actor.guard,
  };
}

function calculateDamage(
  actor: Character,
  target: Character,
  profile: AttackProfile,
  critical: boolean,
  damageMultiplier: number,
): number {
  const raw =
    profile.baseDamage +
    actor.stats.strength * profile.strengthScale +
    actor.stats.agility * profile.agilityScale +
    actor.stats.speed * profile.speedScale;
  const mitigatedDefense = target.stats.defense * (1 - profile.defenseBypass) + target.guard;
  const criticalMultiplier = critical ? 1.75 : 1;

  return Math.max(1, Math.round((raw - mitigatedDefense) * criticalMultiplier * damageMultiplier));
}

function scoreWords(text: string, words: string[]): number {
  return words.reduce((score, word) => (text.includes(word) ? score + 1 : score), 0);
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function adjudicateAction(input: {
  actor: Character;
  rawText: string;
  normalized: string;
  intentFamily: IntentFamily;
  requirements: ActionRequirement[];
  wantsFlight: boolean;
  wantsRest: boolean;
  wantsAcrobatics: boolean;
  wantsPhysical: boolean;
  wantsFire: boolean;
  wantsDefend: boolean;
  confidence: number;
}): InterpretedAction {
  const { actor, rawText, normalized, intentFamily, requirements, wantsFlight, wantsRest, wantsAcrobatics, wantsPhysical, wantsFire, wantsDefend, confidence } =
    input;
  const capabilities = actor.capabilities;

  if (wantsRest) {
    return buildAction({
      rawText,
      attack: "idle",
      intentFamily,
      feasibility: "supported",
      requirements,
      confidence,
      reason: "The input describes a passive or resting action.",
      attemptSummary: `${actor.name} tries to disengage and rest in the middle of the fight.`,
      adjudicatedSummary: `${actor.name} drops low and tries to rest on the ground while the duel keeps moving around them.`,
    });
  }

  if (wantsDefend) {
    return buildAction({
      rawText,
      attack: "defend",
      intentFamily,
      feasibility: "supported",
      requirements,
      confidence,
      reason: "The input maps to a guarded or defensive posture.",
      attemptSummary: `${actor.name} uses the move to protect themselves and brace for the next exchange.`,
      adjudicatedSummary: `${actor.name} plants their feet, raises their guard, and watches for the next opening.`,
    });
  }

  if (wantsFire && !capabilities.canUseFire) {
    if (wantsPhysical) {
      return buildAction({
        rawText,
        attack: "box",
        intentFamily,
        feasibility: "partial",
        requirements,
        confidence,
        reason: "The move asks for fire, but the fighter can only convert it into a physical follow-through.",
        attemptSummary: `${actor.name} tries to ignite the attack, fails to summon flame, and falls back on body momentum.`,
        adjudicatedSummary: `${actor.name} reaches for fire that never comes, then barrels forward into a rough grounded strike instead.`,
        successChanceModifier: -10,
        damageMultiplier: 0.85,
      });
    }

    return buildAction({
      rawText,
      attack: "idle",
      intentFamily,
      feasibility: "unsupported",
      requirements,
      confidence,
      reason: "The move depends on fire magic, which the fighter does not possess.",
      attemptSummary: `${actor.name} tries to conjure flame, but nothing answers the gesture.`,
      adjudicatedSummary: `${actor.name} thrusts their hands out and strains for fire, but only empty effort and heatless sparks follow.`,
    });
  }

  if (wantsFlight && !capabilities.canFly) {
    if (wantsFire && capabilities.canUseFire) {
      return buildAction({
        rawText,
        attack: "fire",
        intentFamily,
        feasibility: "partial",
        requirements,
        confidence,
        reason: "The fighter can use fire, but cannot actually take flight.",
        attemptSummary: `${actor.name} tries to rise into the air while casting, but the airborne part fails.`,
        adjudicatedSummary: `${actor.name} hops, flails for lift, and stays grounded, loosing the fire attack from an awkward leap instead of true flight.`,
        successChanceModifier: -12,
        damageMultiplier: 0.9,
      });
    }

    if (wantsPhysical) {
      return buildAction({
        rawText,
        attack: "box",
        intentFamily,
        feasibility: "partial",
        requirements,
        confidence,
        reason: "The fighter can strike, but not fly.",
        attemptSummary: `${actor.name} tries to turn the move airborne, but never actually leaves the ground in a meaningful way.`,
        adjudicatedSummary: `${actor.name} flaps, leaps, and overreaches for lift, then crashes that failed takeoff into a clumsy grounded strike.`,
        successChanceModifier: -14,
        damageMultiplier: 0.8,
      });
    }

    return buildAction({
      rawText,
      attack: "idle",
      intentFamily,
      feasibility: "unsupported",
      requirements,
      confidence,
      reason: "The move depends on flight, which the fighter does not possess.",
      attemptSummary: `${actor.name} tries to take off, but their body offers no real lift.`,
      adjudicatedSummary: `${actor.name} jumps and flaps for the air, but cannot get off the ground.`,
    });
  }

  if (wantsFire) {
    return buildAction({
      rawText,
      attack: "fire",
      intentFamily,
      feasibility: wantsAcrobatics && capabilities.acrobatics < 5 ? "partial" : "supported",
      requirements,
      confidence,
      reason:
        wantsAcrobatics && capabilities.acrobatics < 5
          ? "The spell is real, but the added flourish overcomplicates the motion."
          : "The move maps cleanly to a fire attack.",
      attemptSummary: `${actor.name} channels a fire-based attack from the prompt.`,
      adjudicatedSummary:
        wantsAcrobatics && capabilities.acrobatics < 5
          ? `${actor.name} gets the fire out, but the flashy body motion makes the casting messy and unstable.`
          : `${actor.name} drives heat through the motion and launches a focused fire attack at the opponent.`,
      successChanceModifier: wantsAcrobatics && capabilities.acrobatics < 5 ? -8 : 0,
      damageMultiplier: wantsAcrobatics && capabilities.acrobatics < 5 ? 0.95 : 1,
    });
  }

  if (wantsPhysical) {
    const acrobaticsPenalty = wantsAcrobatics && capabilities.acrobatics < 5;
    return buildAction({
      rawText,
      attack: "box",
      intentFamily,
      feasibility: acrobaticsPenalty ? "partial" : "supported",
      requirements,
      confidence,
      reason: acrobaticsPenalty ? "The physical strike is valid, but the flourish exceeds the fighter's control." : "The move maps to a close-range physical attack.",
      attemptSummary: `${actor.name} commits to a close-range physical technique from the prompt.`,
      adjudicatedSummary:
        acrobaticsPenalty
          ? `${actor.name} throws the strike with too much spin and not enough control, turning the attack into a rough, unstable blow.`
          : `${actor.name} steps in and delivers the physical attack cleanly through close range.`,
      successChanceModifier: acrobaticsPenalty ? -10 : 0,
      damageMultiplier: acrobaticsPenalty ? 0.9 : 1,
    });
  }

  return buildAction({
    rawText,
    attack: "idle",
    intentFamily,
    feasibility: "partial",
    requirements,
    confidence,
    reason: "The prompt is unusual and does not map cleanly to a supported combat technique.",
    attemptSummary: `${actor.name} tries something unconventional, but the duel rules only catch part of the intent.`,
    adjudicatedSummary:
      actor.capabilities.discipline >= 6
        ? `${actor.name} checks the strange impulse before overcommitting, giving up momentum instead of turning it into a clean move.`
        : `${actor.name} fumbles through the strange idea without turning it into a decisive action.`,
  });
}

function buildAction(action: {
  rawText: string;
  attack: AttackKind;
  intentFamily: IntentFamily;
  feasibility: Feasibility;
  requirements: ActionRequirement[];
  confidence: number;
  reason: string;
  attemptSummary: string;
  adjudicatedSummary: string;
  successChanceModifier?: number;
  damageMultiplier?: number;
}): InterpretedAction {
  return {
    rawText: action.rawText,
    attack: action.attack,
    intentFamily: action.intentFamily,
    feasibility: action.feasibility,
    requirements: action.requirements,
    confidence: action.confidence,
    reason: action.reason,
    attemptSummary: action.attemptSummary,
    adjudicatedSummary: action.adjudicatedSummary,
    successChanceModifier: action.successChanceModifier ?? 0,
    damageMultiplier: action.damageMultiplier ?? 1,
  };
}

function cloneCharacter(character: Character): Character {
  return {
    ...character,
    stats: { ...character.stats },
    capabilities: { ...character.capabilities },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
