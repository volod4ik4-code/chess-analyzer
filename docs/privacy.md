---
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy

_Last updated: 2026-11-17_

Chess Analyzer (Windows and Android) is a free, open-source app. It has **no accounts, no ads and no tracking**. Anonymous usage statistics are sent **only if you agree** (see below). Your games, studies and settings are stored only on your device.

## What the app sends over the internet

The app works offline. It goes online only for the features below.

| Feature | Where it connects | What is sent | When |
|---|---|---|---|
| Update check | `api.github.com`, `github.com` (this repository's releases) | A normal HTTPS request, no personal data | At start-up and when you press "Check for updates". On Android also about once an hour in the background, to show an update notification |
| AI coach, questions to the coach, bot chat lines | `chess-analyzer-coach.chessanalyzer.workers.dev` (Cloudflare Workers AI) | The chess position (FEN), moves, Stockfish's findings about them and, if you ask a question, your question text | Only while the AI coach is turned on (it is on by default; turn it off in ⚙ Settings → "AI coach") |
| chess.com games | `api.chess.com` | The chess.com username you type in | Only when you use the "chess.com games" button |
| Statistics in ⚙ Settings | `raw.githubusercontent.com`, `chess-analyzer-coach.chessanalyzer.workers.dev/stats` | A normal HTTPS request, no personal data | Only when you open the statistics |
| Anonymous usage statistics | `chess-analyzer-coach.chessanalyzer.workers.dev/t` | See "Anonymous usage statistics" below | Only if you answered "Yes" on first start (or turned it on in ⚙ Settings) |
| Opening book | `raw.githubusercontent.com` (lichess-org/chess-openings) | A normal HTTPS request, no personal data | Once, if the opening book is not cached yet |

These services may see your IP address, as with any internet request. Their own privacy policies apply: [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement), [Cloudflare](https://www.cloudflare.com/privacypolicy/), [chess.com](https://www.chess.com/legal/privacy).

The AI coach server does not store your requests. Cloudflare applies a rate limit by IP address (to prevent abuse) and keeps standard technical logs.

## Anonymous usage statistics

On first start the app asks whether it may send anonymous usage statistics. Nothing is sent unless you press "Yes". You can turn it off at any time in ⚙ Settings → "Send anonymous statistics"; the counters not yet sent are then deleted.

What is sent (about every 10 minutes, only when something changed):

- a random device ID created by the app (not linked to your name, account or hardware);
- the platform (PC / phone), app version and interface language;
- counters: how many games were analyzed and how many moves, how many moves got each grade (Brilliant, Blunder, …), the average accuracy, games against each bot and their results, stars earned, how often features were used (AI coach, questions, messages to bots, chess.com games, studies, settings).

What is **not** sent: your games or PGN, usernames, the text of your messages or questions, your IP address. The server stores only the country (two letters, determined by Cloudflare) next to the device ID, and the date of the last use. The totals (not per-device data) are shown to everyone in ⚙ Settings → Statistics.

## What the app stores on your device

- Settings: `~/.chess_analyzer.json` (Windows) or the app's local storage (Android).
- Studies: `~/.chess_analyzer_studies` (Windows) or the app's local storage (Android).
- Opening book cache: `~/.chess_analyzer_openings` (Windows).
- Statistics choice, random device ID and unsent counters: `~/.chess_analyzer_telemetry.json` (Windows) or the app's local storage (Android).

Uninstalling the app (Android) or deleting these files (Windows) removes this data.

## Android permissions

- **Internet** — for the features above.
- **Notifications** — to tell you about a new version.
- **Install packages** — to install a downloaded update after you confirm it.

## Children

The app does not knowingly collect any personal data from anyone, including children. The anonymous statistics contain no personal data.

## Contact

Questions: open an issue at [github.com/volod4ik4-code/chess-analyzer/issues](https://github.com/volod4ik4-code/chess-analyzer/issues).

## TikTok integration

The project's author uses a small "Chess Analyzer" TikTok app only to upload the project's own videos to its own TikTok account ([@chessanalyzer.app](https://www.tiktok.com/@chessanalyzer.app)). It uses the TikTok access token of that one account, stored only on the author's computer. It does not access, collect or store any data of other TikTok users, and the Chess Analyzer apps themselves do not connect to TikTok. See also the [Terms of Service](../terms/).
