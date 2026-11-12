# Undercover: Double Agent — Audio Wish List

Strictly audio. No visuals, no gameplay, no code — only the sounds the game needs, what exists, and what is still missing. Every item is a sound file (or a short voice line) to record, generate, or source.

## How to read it

- **Have** — the file exists in `assets/audio/` and is wired in.
- **Need** — the game calls for it (or should), but there is no file yet.
- **Mono** — all game audio is mono (standing rule). AAC vs MP3 is still an open pick.
- **Reverb** — gunshots + SFX already run through a procedural echoing reverb (courtyard + theater, commit f3d6c69). New files get it for free.

---

## 1. Gunshots (courtyard)

| Sound | Status | Notes |
|---|---|---|
| Pistol gunshot | Have — `pistol-gunshot.m4a` | |
| Suppressed pistol | Have — `suppressed-pistol.m4a` | |
| Suppressed Walther | Have — `suppressedwalther.m4a` | |
| AK-74 | Have — `ak74.m4a` | |
| Rifle gunshots | Have — `rifle-gunshots.m4a` | |
| RPG7 launch | Need | No RPG sound exists — the RPG7 currently borrows `rifle-gunshots`. A real launcher whoosh + boom. |
| Gunshot hit (flesh) | Have — `gunshot-hit.m4a`, `gunshot-hit2.m4a` | |
| Dry-fire click (empty) | Need | Only if auto-reload is ever turned off. With auto-reload (f3d6c69+) the mag never sits empty, so this is low priority. |
| Reload — pistol | Need | Magazine out / in / slide rack. A real reload foley. |
| Reload — rifle | Need | Magazine out / in / charging handle. A real reload foley. |

## 2. Blades (theater)

| Sound | Status | Notes |
|---|---|---|
| Slash hit | Have — `slash-hit.m4a`, `slash-hit2/3/5/6.m4a` (5 variants) | |
| Slash miss (whoosh) | Have — `slash-miss.m4a`, `slash-miss3.m4a` (2 variants) | |
| Katana draw / sheath | Need | The draw before the first slash. |
| Sword clash (blade on blade) | Need | For a parry or a blocked chop — not yet in the game, but the sound belongs on the list. |

## 3. Footsteps + Foley

| Sound | Status | Notes |
|---|---|---|
| Footstep — concrete | Need (synthesized now) | Courtyard ground is mostly concrete. The current steps are synthesized Web Audio, per-surface. Real recorded steps would replace them. |
| Footstep — dirt | Need (synthesized now) | Dirt strip at (0, 36). |
| Footstep — grass | Need (synthesized now) | Grass patch at (31, −32). |
| Footstep — gravel | Need (synthesized now) | Gravel at (−31, −31). |
| Footstep — asphalt | Need (synthesized now) | Asphalt at (8, −14) + tire marks. |
| Footstep — wood floor | Need | Ballroom wood floor (40×28). No wood steps exist yet. |
| Footstep — dance floor | Need | Ballroom dance floor (13×9). A slightly harder, polished-wood step. |
| Footstep — stage | Need | Theater stage (wood). |
| Footstep — carpet | Need | Theater house aisle (red carpet) + ballroom rugs. A soft, muffled step. |
| Footstep — marble / tile | Need | Ballroom bathroom + any hard interior floor. |
| Cloth / movement rustle | Need | General Foley for walking, turning, crouching. |
| Picking up intel | Need | A small paper / object pickup sound. |
| Door open / close | Need | Ballroom doors, theater curtain pull. |
| Jump / land | Need | A soft land thud. (A `land` animation exists; no land sound.) |

## 4. Grunts + exertion

| Sound | Status | Notes |
|---|---|---|
| Player grunt — hit | Need | Kyle takes a bullet. A short pained grunt. (`hitReaction` animation exists; no grunt sound.) |
| Player grunt — exertion | Need | Sprinting, jumping, takedown effort. |
| Player grunt — knocked down | Need | Theater: Rochelle goes down. A fall grunt + impact. |
| Player get-up | Need | Theater: Rochelle stands back up. A breath + effort sound. |
| Guard grunt — hit | Need | Guard takes a bullet. A short pained grunt. |
| Guard grunt — takedown | Need | Guard taken down silently. A choked / cut-off grunt. |
| Guard death | Need | A death sound (gasp, collapse). Real death clips exist as animation; the sound is separate. |
| Enemy chop grunt | Need | Theater: the enemy's heavy overhead chop. An exertion grunt on the swing. |

## 5. Guards (courtyard) — barks + radio

| Sound | Status | Notes |
|---|---|---|
| Guard — "Halt!" / "Stop!" | Need | On spotting Kyle. A sharp alert bark. |
| Guard — "Who's there?" | Need | Suspicious: heard something, not sure what. |
| Guard — "Contact!" / "Intruder!" | Need | Alert: confirmed sighting, calling it in. |
| Guard — "Searching" / "Check it out" | Need | Moving to investigate a noise or last-known position. |
| Guard — "All clear" / "False alarm" | Need | Returning to patrol after a search. |
| Guard — radio chatter | Need | Short radio bursts between guards (static + a few words). |
| Guard — reload | Need | A guard reloading (same foley as the player rifle reload, or a distinct one). |

## 6. Conversation pieces (small talk + story)

These are voice lines. The words are Kyle's to write — nothing here is a script, only the slots where a line belongs. Each slot needs one short line (a sentence or two).

| Slot | Who | Status | Notes |
|---|---|---|---|
| Ballroom — guest small talk (Vickie) | Vickie | Need | A guest chatting at the ball. One or two lines. |
| Ballroom — guest small talk (Eric) | Eric | Need | Same. |
| Ballroom — guest small talk (Kristen) | Kristen | Need | Same. |
| Ballroom — guest small talk (Donald) | Donald | Need | Same. Donald is drunk — his line can slur. |
| Ballroom — Rochelle + Kyle earpiece | Rochelle / Kyle | Need | The photographer mission already has dialogue text; the spoken lines are the same words, recorded. |
| Handoff — rendezvous | Rochelle / Kyle | Need | The rendezvous lines already exist as text ("Look what the cat dragged in…" / "Miss me?" / "I was just getting started without you."). Spoken versions of those lines. |
| Theater — enemy taunt | Enemy | Need | The enemy taunts Rochelle while she is down. A short mocking line (or just the cocky laugh — the `Being_Cocky` gesture is the visual). |
| Theater — Rochelle battle cry | Rochelle | Need | On the special / final kill. A short cry. |
| Courtyard — Kyle mutter | Kyle | Need | Collecting intel, reaching exfil. One line each, or a single muttered line. |

## 7. Music

| Sound | Status | Notes |
|---|---|---|
| Ballroom waltz | Have — `ballroom_waltz.m4a` (mono AAC, 35 s, loops) | Rochelle + handoff only. Starts on Enter, stops on win. |
| Courtyard ambient music | Need | A low, tense underscore for the stealth courtyard. Or none — the rain + thunder may be enough. Kyle's call. |
| Theater music | Need | A dramatic underscore for the fight. Or none — the slashes + crowd may be enough. Kyle's call. |
| Menu / title music | Need | A short theme for the level menu / start screen. |
| Win sting | Need | A short "mission complete" musical sting. |
| Lose sting | Need | A short "mission failed" musical sting. (Theater has no lose screen; courtyard does.) |

## 8. Ambient + environment

| Sound | Status | Notes |
|---|---|---|
| Rain | Have (synthesized) | Courtyard rain loop, Web Audio. |
| Thunder | Have (synthesized) | Thunder 1–3 s after the flash. |
| Wind | Need | A soft wind bed for the courtyard + the handoff driveway. |
| Ballroom crowd murmur | Need | A low murmur of guests talking, glasses, distant laughter. The ballroom should sound full. |
| Ballroom — glasses / clink | Need | A champagne glass clink, part of the crowd bed or its own spot sound. |
| Theater — audience murmur | Need | A hushed audience before the fight, or a gasp when the fight starts. |
| Theater — curtain | Need | The heavy curtain drawing open. |
| Crickets / night | Need | The handoff driveway at night. A light cricket bed. |

## 9. UI + system

| Sound | Status | Notes |
|---|---|---|
| Button click / tap | Need | A soft UI click for menu buttons and the Enter button. |
| Level select | Need | A short confirm sound when picking a level. |
| Photo taken (camera shutter) | Need | Rochelle's photo mission — the SLR shutter + flash. A real shutter click. |
| Intel collected | Need | A small chime / paper sound when intel is picked up. |
| Exfil unlocked | Need | A short confirm when all 3 intel are collected. |
| Win / mission complete | Need | See Music §7 (win sting). |
| Lose / mission failed | Need | See Music §7 (lose sting). |

---

## Priority (if recording in batches)

1. **Reload foley (pistol + rifle)** — the player reloads constantly now that it is automatic; the reload animation is silent.
2. **Guard barks** — "Halt!", "Contact!", "Who's there?" — the guards are mute right now; a bark makes the alert state read.
3. **Footsteps (concrete + wood)** — the two floors the player spends the most time on.
4. **Grunts (player hit + guard hit)** — the most frequent combat sound after the gunshot itself.
5. **Photo shutter** — the ballroom mission's signature moment.
6. **Ballroom crowd murmur** — the room should sound full.
7. **Conversation pieces** — once Kyle writes the lines.

## Open picks (Kyle)

- Audio format: AAC vs MP3 (still open).
- Courtyard music: tense underscore, or rain + thunder only?
- Theater music: dramatic underscore, or slashes + crowd only?
- The conversation lines themselves (his words, presented as options before recording).
- Whether grunts / barks are recorded by a real voice or generated.
