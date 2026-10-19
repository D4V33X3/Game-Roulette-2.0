# Game Roulette 2.0

Game Roulette is a Windows desktop game library built with JavaScript, HTML, CSS, and Electron. It does not require Python.

## Features

- Browse a local game library, edit game details, and organize named collections.
- Filter collections by detected launcher and platform, including Steam and PlayStation 2.
- Connect a Steam account, sync eligible games, view Steam achievements, and find game artwork.
- Track RetroAchievements and show the local achievement overlay in OBS.
- Scan ROM folders and launch games with configured emulators such as PCSX2, DuckStation, and Dolphin.
- Use Big Picture mode with keyboard and supported gamepad controls.
- Customize the app with built-in gaming themes or create and share custom themes.

Game Roulette does not include commercial game files, emulator programs, or BIOS files. You must install and configure those separately.

## Run from source

1. Install Node.js and pnpm.
2. Open a terminal in the project folder and run `pnpm install`.
3. Run `pnpm start` to open the desktop app.
4. Run `pnpm test` to execute the automated checks.

For a Windows x64 portable build, run `pnpm dist:portable`. The generated build is placed in `release/`.

## Your data and privacy

The source package contains no game library, connected account, API key, personal avatar, or player profile. A fresh profile starts with the display name “Player”. If you already have Game Roulette data on this PC, the app uses that local profile; it is not bundled with the app or source package.

Packaged app data is saved in the current Windows user's `%USERPROFILE%\.rom_roulette` folder. It includes that player's library, settings, cover cache, and account state. Steam and RetroAchievements keys are protected with Electron's operating-system secure storage on Windows. These local files are excluded from Git by `.gitignore`.

When running an unpackaged development build, the app uses a fresh temporary data folder for each launch. Set `GAME_ROULETTE_DATA_DIR` if you want to use a specific development data folder.

The OBS overlay is a local browser source. Game Roulette does not include Twitch integration.

## License

Game Roulette is open source under the MIT License. You may use, copy, modify, distribute, sublicense, and sell the software or forks, provided that copies and substantial portions retain the copyright and license notice in `LICENSE`. The software is provided without warranty. See `LICENSE` for the full terms. Third-party components, artwork, and services remain subject to their own terms.

## Build details

- App version: 2.0.0
- Desktop framework: Electron
- Main process and UI: JavaScript, HTML, and CSS
- Python runtime: not required

