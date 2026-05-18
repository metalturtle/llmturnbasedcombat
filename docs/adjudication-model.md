# Adjudication Model

This game accepts free-form player actions, but the world still obeys capabilities and combat rules. The adjudication layer sits between raw text input and combat resolution.

## Flow

1. `rawAction`
   - The exact player text.
2. `intent`
   - What the player is trying to do in broad terms.
   - Examples: `attack`, `magic`, `mobility`, `defense`, `rest`, `weird`.
3. `requirements`
   - What the attempted action assumes the actor can do.
   - Examples: `flight`, `fire_magic`, `acrobatics`, `boxing`.
4. `capability check`
   - Compare requirements against the actor's capabilities.
5. `feasibility`
   - One of:
   - `supported`: the actor can do this normally.
   - `partial`: the actor can attempt part of it, but not fully.
   - `unsupported`: the actor lacks the needed ability.
6. `mechanical action`
   - Map the attempt to a combat action used by the rules engine.
   - Current actions: `box`, `fire`, `defend`, `idle`.
7. `resolved scene summary`
   - One short statement describing what physically happens in the world.
   - This is the source of truth for narration and image generation.

## Character Capabilities

Stats do not fully determine what a character can do. Each character also carries capabilities:

- `canUseFire`
- `canFly`
- `boxingSkill`
- `acrobatics`
- `discipline`

These let the game distinguish:

- a fighter who can throw a punch from one who can cast fire
- a spinning flourish from a clumsy overcommitment
- a real aerial move from a failed attempt to fly

## Rule Principles

- The player may attempt anything.
- The world does not grant abilities the character does not possess.
- Unsupported attempts are translated into plausible failed or partial outcomes.
- The result should preserve the spirit of the input without violating the fiction.

## Examples

### Flight Without Flight

Input:

```text
i want the character to fly
```

Adjudication:

- `intent`: `mobility`
- `requirements`: `flight`
- `feasibility`: `unsupported`
- `mechanical action`: `idle`
- `resolved scene summary`: `The fighter jumps, flaps, and strains for lift, but never leaves the ground.`

### Flying Attack Without Flight

Input:

```text
give a flying uppercut
```

Adjudication:

- `intent`: `attack`
- `requirements`: `flight`, `boxing`
- `feasibility`: `partial`
- `mechanical action`: `box`
- `resolved scene summary`: `The fighter tries to launch upward into a flying uppercut, but only manages a grounded leap into a rough upward strike.`

### Fire Without Fire Ability

Input:

```text
burn the enemy with my hands
```

Adjudication:

- `intent`: `magic`
- `requirements`: `fire_magic`
- `feasibility`: `unsupported`
- `mechanical action`: `idle`
- `resolved scene summary`: `The fighter thrusts their hands forward and tries to summon flame, but nothing manifests.`

### Resting In Combat

Input:

```text
sleep on the ground
```

Adjudication:

- `intent`: `rest`
- `requirements`: none
- `feasibility`: `supported`
- `mechanical action`: `idle`
- `resolved scene summary`: `The fighter drops to the ground and tries to rest in the middle of the duel, leaving the initiative uncontested.`

## Why The Scene Summary Matters

The image generator should not infer the physical scene directly from raw player text. It should use the adjudicated scene summary.

That prevents:

- impossible powers being shown as successful
- passive actions turning into cool attack poses
- the image model drifting away from the game rules

The narrator and illustrator should both consume the same adjudicated scene summary so text and visuals stay aligned.
