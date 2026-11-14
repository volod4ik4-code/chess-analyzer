"""
Запускач ChessAnalyzer.exe: сама програма - файл app\\chess_analyzer.py поруч з exe.
Exe однаковий у всіх версіях, тож Windows (Smart App Control) перевіряє його лише один раз,
а оновлення змінюють тільки app\\chess_analyzer.py.
Імпорти нижче - щоб PyInstaller поклав у _internal усе, що потрібно програмі.
Нові модулі в chess_analyzer.py -> додати сюди, підняти LAUNCHER_LEVEL і перезібрати запускач.
"""
import base64, copy, ctypes, datetime, glob, io, json, math, os, queue, re, runpy, shutil  # noqa: E401,F401
import struct, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request  # noqa: E401,F401
import webbrowser, zipfile, zlib  # noqa: E401,F401
import tkinter, tkinter.ttk, tkinter.filedialog, tkinter.messagebox  # noqa: E401,F401
import chess, chess.pgn, chess.engine, chess.polyglot, chess.svg  # noqa: E401,F401

LAUNCHER_LEVEL = 1

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    script = os.path.join(here, "app", "chess_analyzer.py")
    sys.argv[0] = script
    sys.modules["chess_analyzer_launcher"] = sys.modules[__name__]
    runpy.run_path(script, run_name="__main__")
