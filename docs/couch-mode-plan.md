# EmuLatte Couch Mode — Build Plan

A second, gamepad-first **play-only** fullscreen "face" of EmuLatte (a port of CREMA's UX,
re-pointed at EmuLatte's data and stripped of PC-gaming features), alongside the existing
mouse/keyboard **Desktop Mode**. Written for a general-public release — display/fullscreen
logic is platform-adaptive and density/aspect are user-driven, not tied to any one rig.

## 1. Concept & guardrails
- Same app, same `emulatte.db`, same launch pipeline. Couch Mode = browse → pick → play.
- Port CREMA's **UX patterns** (focus model, navigation, sleep, ambient sound), not its code
  wholesale — CREMA reads the suite `games.db` and is full of PC-gaming features.
- **Fluid, not fixed-canvas** (decided): no 1920×1080 transform-scale. Density comes from
  `webFrame.setZoomFactor`, so 4:3 and 16:9 both reflow correctly.
- All heavy configuration stays in Desktop Mode.

## 2. Architecture
- Separate renderer entry `couch.html` + `couch.js` (lean, gamepad-focused), reusing
  `preload.js`, existing IPC, and `emulatte.db`. Shared helpers (escHtml, cover-shaping,
  category map) extracted to a small shared module.
- Entry: a **"GO FULLSCREEN" pill** on the desktop faux-titlebar (same placement/styling as
  CafeNeurotico's pill, no CREMA branding) + a Settings toggle + `--couch` flag + F11.
- One window, content swap by default (`loadFile('couch.html')` ↔ `loadFile('index.html')`);
  relaunch only when the display path requires it (see §3).

## 3. Platform-adaptive display targeting (general-public core)
`enterCouch({displayIndex, density})` in main picks a strategy:

| Platform / session | Target = current screen | Target = a *different* screen |
|---|---|---|
| Windows / macOS / Linux X11 | setBounds + setFullScreen in-place | same, in-place |
| Linux Wayland (KWin/GNOME/wlroots) | in-place fullscreen | relaunch under XWayland (`--ozone-platform=x11 --couch --display=N`), then target |
| gamescope (future / Deck) | compositor places it; in-place | passthrough, no XWayland |

- Default option is **"Current screen"** → works natively everywhere, no relaunch. The XWayland
  relaunch is reserved for "put it on *that other* screen" on native Wayland.
- Relaunch uses the existing `app.relaunch({args}) + app.exit(0)` plumbing (backup/restore).
- `get-monitors` feeds the picker; numbered displays (no resolution/name reliance).

## 4. Density / "CRT" handling
- User **Display Density** control: presets Auto / Comfortable (1.0) / Large (1.5) /
  Extra-Large (2.0) / Low-res CRT (~2.5) + fine slider. Applied via `webFrame.setZoomFactor`.
- **Auto** suggests density from the target output's resolution (≤720p → larger), always
  overridable. Not hardcoded to any screen. Fluid layout → fewer/bigger cards, reflows for 4:3+16:9.

## 5. Couch UI — keep vs strip
Keep (gamepad-navigable): game wall (All / System / Favourites / Recents / Want) using the
console/handheld/arcade categories + A–Z/Last-Played/etc sorts; game detail (cover, hero/SS reel,
description, ▶ PLAY → `launch-game`); Now-Playing; fav/want; optional on-screen-keyboard search;
optional sleep/screensaver (CN wallpapers) + ambient BGM/SFX.
Strip: Steam/Heroic/GOG install watchers & store flows; PC platform filters; IGDB
perspective/flow/difficulty modifiers; anything bound to the suite `games.db` schema (data layer
swapped to EmuLatte IPC/`emulatte.db`).

## 6. Gamepad model
Port CREMA's Gamepad-API polling + focus engine (`.ggp-focused`, D-pad/stick nav, A=select,
B=back, X/Y context, bumpers=system/tab jump, Start+Select=wake/exit). Button-prompt layouts
(Xbox/PS/Nintendo). Keyboard fallback (arrows/Enter/Esc). Cursor hidden (setting, default on).

## 7. Settings (Desktop → new "Couch Mode" section)
New `emulatte.db` settings keys: `couch_display`, `couch_density`, `couch_start_on_launch`,
`couch_gamepad_layout`, `couch_hide_cursor`, `couch_sound`, `couch_screensaver`.
Controls: Enter Couch Mode · Target Screen · Display Density · Start in Couch Mode on launch ·
Gamepad layout · Hide cursor · Ambient sound · Screensaver/sleep delay.

## 8. Main-process / IPC additions
`enter-couch-mode(opts)` / `exit-couch-mode` (fullscreen + targeting + relaunch decision).
CLI parse in main: `--couch`, `--display=N` (+ auto `--ozone-platform=x11` on the Wayland
cross-output path). Reuse `get-monitors`, `get-games`, `launch-game`, settings get/set. No schema change.

## 9. Phasing (each shippable)
- **Phase 0 — spike:** prove fullscreen-on-chosen-output on Win/Mac/X11 + Wayland XWayland-relaunch.
- **Phase 1 — shell:** couch.html + GO FULLSCREEN pill + fullscreen-on-current-screen + fluid game
  wall from emulatte.db + density zoom. Mouse-usable end-to-end.
- **Phase 2 — gamepad:** focus engine, navigation, button prompts, keyboard fallback.
- **Phase 3 — couch features:** game detail, Now-Playing, search keyboard, filters/sorts, sleep + sound.
- **Phase 4 — targeting & polish:** chosen-screen targeting (incl. Wayland relaunch), start-in-couch,
  layouts, 4:3/16:9 verification.

## 10. Risks / open items
- Wayland cross-output is the only real unknown → Phase 0 validates; "Current screen" default sidesteps.
- Fractional-scaled main monitors: only use XWayland during couch mode (Desktop stays native).
- Controller variety: standard Gamepad API covers most; exotic pads may need mapping.
- i18n: CREMA has en/pt_BR; decide English-first vs porting the i18n layer.

---
Status: planning blueprint (2026-06-28). Implementation starts at Phase 0.
