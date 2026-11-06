# Double Agent — New Asset Wishlist
Checked against the mobile repo on 2026-11-05. Items already in the repo and wired are NOT re-listed as missing.

## Removed from the old wishlist — now obtained
- Cats: Mabel, Margo, Moxie GLBs, wired, with 30 pooled animation actions
- Rochelle: Mixamo FBX, wired as contact and as player in the handoff
- Guests: Vickie, Eric, Kristen, Donald as Mixamo FBXs, wired
- Ballroom props: chandelier, bar, bar top, table, chair — wired
- Ballroom textures: 56 textures in assets/textures/, ballroom set wired
- Player weapons: all 12 white/black GLBs — wired
- Talking dance: Rumba (pair) + Salsa solo cuts — wired
- White Lamborghini model: assets/white_lambo.glb, now parked curbside on the east edge of the round drive — model obtained, driving gameplay still missing (see Courtyard)
- Donald drunk animations: Drunk_Idle (standing), Drunk_Stumbling_Walking (moving), Falling_Down (2.27 s, played once and held) — wired for Donald in all three ballroom pages, procedural wobble/flat fall removed (commit 478e570)
- Ballroom waltz: user-supplied mono AAC, wired as looping background music, volume by zone — loudest inside the ballroom (0.7), faint outside (0.12), fading through the doors/steps (commit 7c27935)
- South road: asphalt road south from the round drive to z 75, beyond the player limit (z 45), lawn extended to cover it; two procedural placeholder cars (red sedan west curb, blue car on the south road) — real car GLBs still wanted
- Bushes: now clustered faceted lobes (3 shapes) with the lawn grass/clover texture, still procedural — real bush GLB still wanted

## 1. Mansion exterior — real models to replace today's procedural build
Today's exterior (handoff page) is procedural: round drive, bushes, mansion wings, columns, portico, and 6 steps are geometry, not supplied models. Bushes are now clustered faceted lobes, not single spheres, and the south drive has a road off it — both still procedural.
- Bush / hedge GLB — rounded mansion-style bushes, to replace the procedural clustered bushes around the drive, facade, and island
- Mansion facade GLB — stone front, windows, and portico, to replace procedural wings and columns
- Stone steps GLB — a flight of steps, to replace the 6 procedural step boxes
- Other vehicles — real car GLBs, to replace the two procedural placeholder cars (red sedan, blue car on the south road)
- North yard and road — no yard or road exists outside the north exit yet. Needed for the end cinematic escape, separate from the south drive and its road

## 2. End cinematic
- Boarding and drive-off animation set — cats and agents getting onto / into the vehicle and driving off. Vehicle model itself is NOT missing (White Lambo is in the repo).
- Open decision, not an asset: the Lambo is parked curbside in the south drive, the escape exit is the north door. Whether the escape uses the south Lambo, a north vehicle, or the Lambo moves north is still open.
- Cat tail flick clip — not separately labeled in the pooled cat actions (see 5a).

## 3. Ballroom band and bartender — still missing
Characters, Mixamo rigs only (per the Mixamo-for-everyone direction):
- Bartender model — Mixamo, in bartender outfit with apron, distinct from Kyle and the guests
- Band trio models — Mixamo piano player, drummer, and bass player

Props:
- Grand piano — black, lid open, keys, bench
- Drum kit — small jazz kit: kick, snare, hi-hat, ride cymbal
- Double bass — upright, with bow
- Cake table — round, white cloth, tiered cake, knife, plates

Bar props:
- Wine glasses, whiskey tumblers, cocktail and champagne glasses
- Bar bottles — wine, whiskey, liquor, champagne, no readable brand text
- Bar stools, back bar shelving and mirror, pendant lights over the bar
- Cocktail shaker, ice bucket and bar tools, wine rack and decanter
- Bar mats, coasters, napkins, garnish tray and extra glassware

Animations:
- Bartender pour, shake, wipe, serve — distinct clips. Bartending.fbx is on disk and unwired (see section 6), it does not cover all four.
- Drinking sip, hold-and-gesture, toast — distinct clips. Drinking.fbx is on disk and unwired (see section 6).

## 4. Audio — waltz wired, rest still missing
Ballroom cinematic (waltz obtained — user-supplied mono AAC, wired as looping background music with distance-based volume; the rest still missing):
- Piano crash — Mabel runs across the piano keys, song stops dead
- Camera shutter click — each collar photo
- Cat treat eating and purr
- Cat running paws
- Drink spill and light tumble thud — Donald
- Ballroom crowd murmur and bar drinks clinking
- Yard ambience — outside the ballroom
- Door unlock chime — passcode moon, note, rose accepted

Courtyard stealth:
- Suppressed and unsuppressed gunshots, footsteps, reload clicks
- Alert and caution stingers, guard barks
- Ambient loops, stealth and alert music loops

## 5. Courtyard stealth — still missing
Characters, Mixamo rigs only:
- Civilian, scientist, boss, female agent variant

Vehicles and driving:
- Motorcycle model, motorcycle riding animation
- Drivable car rig, Driving Turn animation
- White Lambo driving gameplay — system, not model. Model is obtained.

Animations:
- Pistol Crouch Walk, Pistol Crouch Fire, Checking Watch
- Prone crawl, lean / peek, drag / hide body, disguise change, interrogate, climb wall, slide under, swim

Systems, not models:
- Throwable knife / grenade, placeable C4 / claymore, lockpicks

Environments:
- Enterable interior office, server room, warehouse
- Opening interior doors, vents, camera-disable security office, real cover models

Textures, still missing:
- Hazard stripes, signage / posters, floor markings, night / wet-look variants

Textures obtained, unwired (files exist, not referenced in any page — do not re-request): facility door / EXFIL gate metal, metal barrel textures, weathered concrete barrier texture. Building window glass and tire marks / oil stains textures are now wired in the courtyard, so they are removed from missing.

## 5a. Checked, not dropped
- Suppressors, glasses, watch — wired in the courtyard (suppressor, glasses, watch loaders), not missing.
- Pen, cufflinks, bag — GLBs exist, intentionally HUD-only: no sensible bone anchor that would not clip the weapon hand, per the courtyard comment. Not missing.
- Cat tail flick — not separately labeled in the 30 pooled cat actions, so it is kept below as a still-missing clip unless it is already inside an idle/sit clip.
- Opening_Door_Inwards clip exists in the courtyard animation manifest; an interior door system is still missing.

## 6. Obtained but unwired — awaiting your pick, NOT missing
Do not re-request these. They are verified on disk and ready to wire on your tap:
- Dance: Samba, Twist, YMCA, Macarena, Hokey Pokey, Dancing (needs root strip)
- Drunk variants still unwired: Drunk Idle Variation (x2), Drunk Walk, Drunk Walk Backwards, Drunk Run Forward, Drunk Run Backward — Drunk_Idle, Drunk_Stumbling_Walking and Falling_Down are now wired for Donald, do not re-request those
- Drinking, Bartending
