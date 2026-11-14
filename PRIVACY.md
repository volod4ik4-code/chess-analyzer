# Privacy Policy

_Last updated: 2026-11-14_

Chess Analyzer (Windows and Android) is a free, open-source app. It has **no accounts, no analytics, no ads and no tracking**. Your games, studies and settings are stored only on your device.

## What the app sends over the internet

The app works offline. It goes online only for the features below.

| Feature | Where it connects | What is sent | When |
|---|---|---|---|
| Update check | `api.github.com`, `github.com` (this repository's releases) | A normal HTTPS request, no personal data | At start-up and when you press "Check for updates". On Android also about once an hour in the background, to show an update notification |
| AI coach, questions to the coach, bot chat lines | `chess-analyzer-coach.chessanalyzer.workers.dev` (Cloudflare Workers AI) | The chess position (FEN), moves, Stockfish's findings about them and, if you ask a question, your question text | Only while the AI coach is turned on (it is on by default; turn it off in ⚙ Settings → "AI coach") |
| chess.com games | `api.chess.com` | The chess.com username you type in | Only when you use the "chess.com games" button |
| Statistics in ⚙ Settings | `raw.githubusercontent.com` | A normal HTTPS request, no personal data | Only when you open the statistics |
| Opening book | `raw.githubusercontent.com` (lichess-org/chess-openings) | A normal HTTPS request, no personal data | Once, if the opening book is not cached yet |

These services may see your IP address, as with any internet request. Their own privacy policies apply: [GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement), [Cloudflare](https://www.cloudflare.com/privacypolicy/), [chess.com](https://www.chess.com/legal/privacy).

The AI coach server does not store your requests. Cloudflare applies a rate limit by IP address (to prevent abuse) and keeps standard technical logs.

## What the app stores on your device

- Settings: `~/.chess_analyzer.json` (Windows) or the app's local storage (Android).
- Studies: `~/.chess_analyzer_studies` (Windows) or the app's local storage (Android).
- Opening book cache: `~/.chess_analyzer_openings` (Windows).

Uninstalling the app (Android) or deleting these files (Windows) removes this data.

## Android permissions

- **Internet** — for the features above.
- **Notifications** — to tell you about a new version.
- **Install packages** — to install a downloaded update after you confirm it.

## Children

The app does not knowingly collect any personal data from anyone, including children.

## Contact

Questions: open an issue at [github.com/volod4ik4-code/chess-analyzer/issues](https://github.com/volod4ik4-code/chess-analyzer/issues).
