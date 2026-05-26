<div align="center">

<img src="assets/icons/EmuLatte.svg" width="128" alt="EmuLatte"/>

<br>

# E M U L A T T E

**ROM library manager for the obsessively organized.**

*55 systems. Multi-source art. RetroAchievements. Trailers. All your emulation, one place.*

<br>

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-8B5A2B?style=flat-square&labelColor=2C1E16)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-D4A373?style=flat-square&labelColor=2C1E16)](https://github.com/shampoo-is-a-lie)
[![Built with Electron](https://img.shields.io/badge/Built%20with-Electron%2041-A47148?style=flat-square&labelColor=2C1E16)](https://electronjs.org)
[![Part of CN Ecosystem](https://img.shields.io/badge/Part%20of-Cafe%20Neurotico-D4A373?style=flat-square&labelColor=432818)](https://github.com/shampoo-is-a-lie)

</div>

<br>

---

<br>

## ◈ &nbsp; What It Is

EmuLatte is the emulation side of the [Cafe Neurotico Ecosystem](https://github.com/shampoo-is-a-lie). It manages your ROM libraries across every system you care about — scraping art and metadata from multiple sources, tracking achievements, downloading trailers, and launching games exactly the way you configured them.

It keeps everything emulation-related in one self-contained app so neither it nor CNGM gets in the other's way.

<br>

---

<br>

## ◈ &nbsp; ROM Library

```
┌─────────────────────────────────────────────────────────────┐
│  55 bundled system presets — SNES · Genesis · PS1 · N64     │
│  GBA · NDS · PSP · Dreamcast · Saturn · PC Engine and more  │
│                                                             │
│  Each preset ships with opinionated RetroArch core          │
│  defaults so you're not starting from zero.                 │
│                                                             │
│  Launch via RetroArch (native or Flatpak, auto-detected)    │
│  or any fully custom emulator command you define.           │
│  Per-game core override when the system default isn't right.│
└─────────────────────────────────────────────────────────────┘
```

An **Emulator Scanner** detects what's already installed on your system — RetroArch, standalone cores, Flatpak variants — and maps them automatically.

<br>

---

<br>

## ◈ &nbsp; Game Page

Every game has a full-screen detail page:

- **Hero image** with Ken Burns slideshow if multiple screenshots exist
- **Cover art** sidebar with release year, genre, developer, players
- **Description** pulled from scrapers
- **RetroAchievements panel** — progress ring, unlock count, quick access to the full achievement list
- **▶ PLAY** button, **WATCH TRAILER**, **EDIT DETAILS**

<br>

---

<br>

## ◈ &nbsp; Art & Metadata Scraping

Four sources, one picker. Hit **SCRAPE** on any asset type and choose where to pull from:

| Source | Art | Metadata |
|:---|:---:|:---:|
| **SteamGridDB** | covers · heroes · logos · screenshots | — |
| **ScreenScraper.fr** | covers · heroes · screenshots | ✓ |
| **TheGamesDB** | covers · heroes · screenshots | ✓ |
| **IGDB** | covers · screenshots | ✓ |

Scraped assets go directly into the game's record. You can also pick a **local file** for any asset type, or delete individual images with the ✕ button.

Full metadata scrapes (title, year, genre, developer, publisher, description) are available from ScreenScraper, TGDB, SGDB, and IGDB — applied with one click from the edit modal.

> **CNGM credential import** — if you already have SGDB, IGDB, or ScreenScraper keys configured in CNGM, EmuLatte can import them so you don't enter them twice.

<br>

---

<br>

## ◈ &nbsp; RetroAchievements

Connect your RetroAchievements account and EmuLatte tracks your progress per game:

- Progress ring on the game page showing unlock percentage
- Full achievement list modal — filter by **All**, **Unlocked**, or **Locked**
- Achievements cached locally; refresh on demand
- MD5 ROM verification to match your file to the correct game entry

<br>

---

<br>

## ◈ &nbsp; Trailers

Search YouTube for a game's trailer directly inside EmuLatte. Pick a result, download it, and watch it in-app — no browser needed.

- Powered by **yt-dlp** + **ffmpeg** (bundled in the AppImage)
- Downloaded trailers cached locally — the **▶ WATCH TRAILER** button appears on the game page once one is saved
- Delete cached trailers individually from the edit modal

<br>

---

<br>

## ◈ &nbsp; Playlists

Create named collections and assign any game to as many playlists as you want. Filter the library by playlist from the sidebar.

<br>

---

<br>

## ◈ &nbsp; Ecosystem Integration

```
  CNGM           Central hub — PC game library, store sync, launches all companion apps
    │
    ├──▸  CREMA       Fullscreen / gamepad counterpart for CNGM + EmuLatte
    │
    ├──▸  GRINDER     GOG & Epic install engine — feeds games back into CNGM
    │
    ├──▸  EmuLatte ◈  ROM library manager — emulation counterpart to CNGM
    │
    └──▸  CN Clock    Floating desktop clock — shows art from CNGM + EmuLatte
```

CNGM and CREMA can each optionally read EmuLatte's library and surface your ROMs under an **Emulation** category — no import, no duplication. They read EmuLatte's DB directly and use the same launch commands it stores. Management always stays in EmuLatte.

All data lives in `GameManagerConfig/EmuLatte/` — backs up with everything else.

<br>

---

<br>

## ◈ &nbsp; Installation

```bash
# Download EmuLatte.AppImage from the Releases page, then:
chmod +x EmuLatte.AppImage
./EmuLatte.AppImage
```

Place it alongside your CNGM installation (e.g. `~/Games/CNGM/`) so the shared `GameManagerConfig/` directory is found automatically.

<br>

### Building from Source

```bash
git clone https://github.com/shampoo-is-a-lie/EmuLatte
cd EmuLatte
npm install
npm run dist
```

> **Note:** The AppImage bundles yt-dlp, ffmpeg, and ffprobe for trailer support. These binaries are not tracked in git — place them in `assets/bin/linux/` before building if you want trailer functionality in dev mode.

<br>

---

<br>

<div align="center">

*Built by* **Shampoo is a Lie** &nbsp;·&nbsp; GPL-3.0 &nbsp;·&nbsp; *Made for Linux desktops that take emulation seriously*

```
◈ ─────────────────────────────────────── ◈
```

</div>
