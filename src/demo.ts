import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CombatGame } from "./combat";

const rl = readline.createInterface({ input, output });
const game = new CombatGame();

main().catch((error: unknown) => {
  console.error(error);
  rl.close();
  process.exitCode = 1;
});

async function main(): Promise<void> {
  console.log("Turn-Based AI Dungeon Master Combat");
  console.log("Type a cinematic action. Examples: flying uppercut, fire blast, brace and block.");
  console.log("");

  while (!game.getSnapshot().finished) {
    const snapshot = game.getSnapshot();
    printState(snapshot);

    if (snapshot.activeTurn === "player") {
      const text = await rl.question("> ");
      await runTurn(text);
    } else {
      const botAction = game.chooseBotAction();
      console.log(`Enemy chooses: ${botAction}`);
      await runTurn(botAction);
    }
  }

  const final = game.getSnapshot();
  console.log("");
  console.log(final.winner === "player" ? "You win." : "You lose.");
  rl.close();
}

async function runTurn(text: string): Promise<void> {
  const result = await game.submitAction(text);
  console.log("");
  console.log(result.narration.interpretation);
  console.log(
    `Roll ${result.resolution.roll} vs ${result.resolution.successChance}% success chance. ` +
      `Interpreted as: ${result.resolution.action.attack}.`,
  );
  console.log(result.narration.outcome);
  console.log("");
}

function printState(snapshot: ReturnType<CombatGame["getSnapshot"]>): void {
  console.log(`${snapshot.player.name}: ${snapshot.player.hp}/${snapshot.player.maxHp} HP`);
  console.log(`${snapshot.enemy.name}: ${snapshot.enemy.hp}/${snapshot.enemy.maxHp} HP`);
  console.log(`Turn: ${snapshot.activeTurn}`);
}
