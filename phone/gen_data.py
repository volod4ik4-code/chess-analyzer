"""Готує дані для телефонної версії з chess_analyzer.py: data.js (тексти, кольори, фігури, версії)
і book.json (база дебютів lichess, як load_opening_book)."""
import io
import json
import os
import sys

sys.path.insert(0, r"C:\Users\1\Desktop\chess analyzer")
import chess          # noqa: E402
import chess.pgn      # noqa: E402
import chess_analyzer as ca  # noqa: E402

www = sys.argv[1]
OPEN = {}
for _b in ca.BOTS:
    _keep = ca.STATE["lang"]
    ca.STATE["lang"] = "uk"; _u = ca.bot_openings_text(_b)
    ca.STATE["lang"] = "en"; _e = ca.bot_openings_text(_b)
    ca.STATE["lang"] = _keep
    OPEN[_b["id"]] = (_u, _e)
data = {
    "APP_VERSION": ca.APP_VERSION, "DONATE_URL": ca.DONATE_URL, "DONATE_CARD": ca.DONATE_CARD,
    "TIKTOK_URL": ca.TIKTOK_URL, "TELEGRAM_URL": ca.TELEGRAM_URL, "GITHUB_URL": ca.GITHUB_URL, "CHANGELOG": ca.changelog_view(),
    "QUALITY": ca.QUALITY, "QUALITY_EN": ca.QUALITY_EN, "TR_EN": ca.TR_EN,
    "BOARD_THEMES": ca.BOARD_THEMES, "BAD": list(ca.BAD), "GRAPH_MARKS": list(ca.GRAPH_MARKS),
    "DEFAULTS": ca.DEFAULTS, "SHAPE_COLORS": ca.SHAPE_COLORS, "ARROW_MODES": list(ca.ARROW_MODES),
    # палітра телефона - своя (ПК з 1.18.0 має іншу); змінювати лише свідомо
    "COLORS": {"BG": "#1f1d1b", "PANEL": "#2b2927", "PANEL2": "#383532", "FG": "#ecebe9",
               "MUTED": "#9d9a95", "ACCENT": "#81b64c"},
    "MATE_SCORE": ca.MATE_SCORE, "BOOK_MAX_DEFICIT": ca.BOOK_MAX_DEFICIT, "WIN_K": ca.WIN_K, "RATING_K": list(ca.RATING_K),
    "ACC_K": ca.ACC_K, "ACC_DECAY": ca.ACC_DECAY, "ACC_POWER": ca.ACC_POWER, "WON_ANYWAY": ca.WON_ANYWAY,
    "BRILLIANT_LIMIT": list(ca.BRILLIANT_LIMIT), "BEST_TOLERANCE": ca.BEST_TOLERANCE, "GREAT_GAP": ca.GREAT_GAP, "BLUNDER_SURE": ca.BLUNDER_SURE, "MISS_MATERIAL": ca.MISS_MATERIAL, "HARD_DEPTHS": list(ca.HARD_DEPTHS),
    "AI_COACH_URL": ca.AI_COACH_URL,
    # боти (1.24.0): дебютні варіанти вже як ходи UCI
    "BOT_LEVELS": list(ca.BOT_LEVELS),
    "BOT_PHOTOS": ca.BOT_PHOTOS, "BOT_PHOTO_CREDITS": ca.BOT_PHOTO_CREDITS, "BOT_CANNED": ca.BOT_CANNED, "ALIEN_CANNED": ca.ALIEN_CANNED,
    "BOTS": [dict({k: b[k] for k in ("id", "uk", "en", "years", "elo", "aggr", "risk", "d_uk", "d_en", "cat",
                                     "fact_uk", "fact_en")},
                  open_uk=OPEN[b["id"]][0], open_en=OPEN[b["id"]][1],
                  w=ca.bot_lines(b, True), b=ca.bot_lines(b, False)) for b in ca.BOTS],
    "BOT_PHOTO_FX": ca.BOT_PHOTO_FX, "BOT_PHOTO_NOTE": ca.BOT_PHOTO_NOTE,
    "LICHESS_SFX": ca.LICHESS_SFX, "ALIEN_PIECES": ca.ALIEN_PIECES, "ALIEN_THEME": ca.ALIEN_THEME, "WITTY_BOOK": ca.WITTY_BOOK,
    "BADGE_GLYPHS": ca.BADGE_GLYPHS,
    "PIECES": ca.PIECE_DATA[max(ca.PIECE_DATA)],
}
with open(os.path.join(www, "data.js"), "w", encoding="utf-8") as f:
    f.write("// Згенеровано з chess_analyzer.py (gen_data.py) - не редагувати вручну\n")
    f.write("export const D = " + json.dumps(data, ensure_ascii=False) + ";\n")

# версія сторінки: Java порівнює її з маленьким оновленням (files/www/version.json)
with open(os.path.join(www, "version.json"), "w", encoding="utf-8") as f:
    json.dump({"version": ca.APP_VERSION}, f)

book, nxt = {}, {}
src = os.path.join(os.path.expanduser("~"), ".chess_analyzer_openings")
for letter in "abcde":
    with open(os.path.join(src, f"{letter}.tsv"), encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3 or parts[0].strip().lower() == "eco":
                continue
            eco, name, pgn = parts[0], parts[1], parts[2]
            game = chess.pgn.read_game(io.StringIO(pgn))
            if game is None:
                continue
            board = game.board()
            for mv in game.mainline_moves():
                nxt.setdefault(board.epd(), set()).add(mv.uci())
                board.push(mv)
                book.setdefault(board.epd(), 0)
            book[board.epd()] = [eco, name]
with open(os.path.join(www, "book.json"), "w", encoding="utf-8") as f:
    json.dump({"book": book, "next": {k: sorted(v) for k, v in nxt.items()}}, f,
              ensure_ascii=False, separators=(",", ":"))
print("version", ca.APP_VERSION, "book positions", len(book), "next", len(nxt))
