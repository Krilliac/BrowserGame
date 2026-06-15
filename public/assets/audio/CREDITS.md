# Audio Assets — Credits & License Manifest

All files in `public/assets/audio/`. License hygiene per
`wiki/research/rendering-and-assets.md`: prefer CC0; CC-BY / CC-BY-SA acceptable
with attribution recorded below; no GPL-only / unclear-license / ripped assets.

Total folder size: ~2.1 MB (target < 3 MB). Formats: OGG Vorbis + one MP3.
Durations are approximate (estimated from size/bitrate; ffprobe unavailable in
the sourcing environment).

---

> **Note:** combat cast/shoot SFX are now **synthesized at runtime** (`src/client/sound.ts`); the
> former `shoot_arrow.ogg` (CC-BY-SA 3.0) and `cast_fire.ogg` (CC0) files were removed, so no
> attribution-required audio remains. Only the CC0 ambient loops + CC0-consistent one-shots ship.

## Files sourced in this pass

### ambient_forest.mp3  →  game event: `ambient-forest` (wilderness / forest loop)
- Source page: https://opengameart.org/content/forest-ambience
- Direct download: https://opengameart.org/sites/default/files/Forest_Ambience.mp3
- Author: TinyWorlds (Ludum Dare 29 entry)
- License: **CC0** (public domain, no attribution required)
- Format / size: MP3, stereo 48 kHz 128 kbps, ~717 KB (~45 s, loops seamlessly)

### ambient_dungeon.ogg  →  game event: `ambient-dungeon` (dungeon / crypt / cave loop)
- Source page: https://opengameart.org/content/dungeon-ambience
- Direct download: https://opengameart.org/sites/default/files/dungeon002_0.ogg
- Author: yd
- License: **CC0** (public domain, no attribution required)
- Format / size: OGG Vorbis, stereo 44100 Hz ~64 kbps, ~1.2 MB (~2.5 min, loopable)

---

## Pre-existing files (present in folder before this sourcing pass)

These short retro-style one-shots were already in the folder. They are valid OGG
Vorbis (verified with `file`). Provenance was not recorded by the original
placement and could not be independently verified in this pass; they are
consistent with CC0 generated/Kenney-style SFX. If strict license provenance is
required, re-source these from a documented CC0 origin (Kenney Impact/UI/RPG
audio or jsfxr-generated). Event mapping below is by audible role + filename.

| File            | Game event              | Format (verified)              | Size    |
|-----------------|-------------------------|--------------------------------|---------|
| swing.ogg       | `swing` (melee swing)   | OGG Vorbis, stereo 48 kHz      | ~17 KB  |
| hit.ogg         | `hit` (melee impact)    | OGG Vorbis, stereo 44.1 kHz    | ~9 KB   |
| hurt.ogg        | `hurt` (monster hurt)   | OGG Vorbis, stereo 44.1 kHz    | ~11 KB  |
| death.ogg       | `death` (monster death) | OGG Vorbis, stereo 44.1 kHz    | ~9 KB   |
| pickup_coin.ogg | `pickup` (coin / loot)  | OGG Vorbis, stereo 48 kHz      | ~27 KB  |
| levelup.ogg     | `levelup` (level up)    | OGG Vorbis, stereo 44.1 kHz    | ~14 KB  |

---

## Attribution

All shipped audio is **CC0** (or CC0-consistent) and needs no attribution (credit appreciated).
No CC-BY / CC-BY-SA audio remains after the cast/shoot SFX were synthesized.

---

## Event → file mapping (for a simple sound manager)

| Event key        | File                  | Type     | Notes                         |
|------------------|-----------------------|----------|-------------------------------|
| swing            | swing.ogg             | one-shot | melee swing / whoosh          |
| hit              | hit.ogg               | one-shot | melee impact / landed hit     |
| hurt             | hurt.ogg              | one-shot | monster takes damage          |
| death            | death.ogg             | one-shot | monster death                 |
| pickup           | pickup_coin.ogg       | one-shot | coin / loot pickup            |
| levelup          | levelup.ogg           | one-shot | level up                      |
| ambient-forest   | ambient_forest.mp3    | loop     | wilderness / forest bed       |
| ambient-dungeon  | ambient_dungeon.ogg   | loop     | dungeon / crypt / cave bed    |
| arrow / cast     | (synthesized)         | one-shot | generated in src/client/sound.ts |
