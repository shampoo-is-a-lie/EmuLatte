# EmuLatte
**by Cafe Neurotico** — "I use RetroArch BTW"

EmuLatte is a ROM library manager for Linux. It handles everything emulation-related in the [Cafe Neurotico Ecosystem](https://github.com/shampoo-is-a-lie) — keeping it separate and self-contained from the PC game side so neither gets in the way of the other.

## What it does

- Manage ROM libraries across multiple systems from a single interface
- 55 bundled system presets — SNES, Genesis, PS1, N64, GBA, NDS, PSP, and more — with opinionated RetroArch core defaults so you don't start from scratch
- Launch via RetroArch (auto-detects native vs Flatpak) or any custom emulator command
- Per-game core override when the system default isn't right
- Scrape metadata and artwork from [ScreenScraper.fr](https://www.screenscraper.fr/) — box art, hero images, screenshots, descriptions, release dates
- Playlist manager for custom collections
- All data in `GameManagerConfig/EmuLatte/` — backs up with everything else

## Ecosystem integration

CNGM and CREMA each have an optional toggle to read EmuLatte's library and show it under an **Emulation** category. Nothing is imported — they read EmuLatte's DB directly, and game launches use the same commands EmuLatte stores. Management always happens in EmuLatte.

## Installation

Download `EmuLatte.AppImage` from the [releases page](../../releases), make it executable, and run it. No installation required.

```bash
chmod +x EmuLatte.AppImage
./EmuLatte.AppImage
```

## Building from source

```bash
npm install
npm run dist
```

## License

[GPL v3](LICENSE)
