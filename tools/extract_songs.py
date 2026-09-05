import json
import re
import sys
import unicodedata
from pathlib import Path


DEFAULT_SOURCE = "cancionero_lista_verificada.txt"
DEFAULT_TARGET = "data/songs.json"


def normalize_search(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def clean_text(text):
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text).strip())


def read_song_lines(path):
    return [clean_text(line) for line in path.read_text(encoding="utf-8").splitlines() if clean_text(line)]


def split_song(line):
    parts = [part.strip() for part in line.split(" - ") if part.strip()]
    if len(parts) < 2:
        return None

    title = parts[-1]
    artist = " - ".join(parts[:-1])
    return clean_text(artist), clean_text(title)


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE)
    target = Path(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_TARGET)

    rows = []
    seen = set()
    skipped = []
    for line in read_song_lines(source):
        parsed = split_song(line)
        if not parsed:
            skipped.append(line)
            continue

        artist, title = parsed
        key = normalize_search(f"{artist}|{title}")
        if key in seen:
            continue
        seen.add(key)

        rows.append(
            {
                "id": f"song-{len(rows) + 1:04d}",
                "artist": artist,
                "title": title,
                "search": normalize_search(f"{artist} {title}"),
            }
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps({"source": source.name, "count": len(rows), "songs": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Extracted {len(rows)} songs to {target}")
    if skipped:
        print(f"Skipped {len(skipped)} lines without ' - ' separator.")


if __name__ == "__main__":
    main()
