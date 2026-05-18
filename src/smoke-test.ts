import { CombatGame, createDefaultCombatants, interpretAction } from "./combat";

const combatants = createDefaultCombatants();

const action = interpretAction("give a flying uppercut to the enemy", combatants.player);
assert(action.attack === "box", "uppercut should map to box");
assert(action.feasibility === "partial", "flying uppercut should be partial without flight");

const neutralAction = interpretAction("sleep at the ground", combatants.player);
assert(neutralAction.attack === "idle", "sleep should map to idle");

const flightAction = interpretAction("i want the character to fly", combatants.player);
assert(flightAction.attack === "idle", "unsupported flight should resolve to idle");
assert(flightAction.feasibility === "unsupported", "unsupported flight should be marked unsupported");

let index = 0;
const rolls = [0.1, 0.2, 0.3, 0.4];
const game = new CombatGame(undefined, undefined, () => rolls[index++ % rolls.length] ?? 0.5);

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const playerTurn = await game.submitAction("give a flying uppercut to the enemy");
  assert(playerTurn.resolution.action.attack === "box", "player action should resolve as box");
  assert(playerTurn.snapshot.activeTurn === "enemy", "turn should pass to enemy");

  const enemyTurn = await game.submitAction(game.chooseBotAction());
  assert(enemyTurn.snapshot.activeTurn === "player", "turn should pass back to player");
  assert(enemyTurn.snapshot.player.hp < enemyTurn.snapshot.player.maxHp, "enemy should damage player in deterministic smoke test");

  console.log("Smoke test passed.");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
