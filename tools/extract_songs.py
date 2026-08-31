import json
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def normalize_search(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def paragraph_text(paragraph):
    text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t"))
    return unicodedata.normalize("NFC", text).strip()


def read_docx_lines(path):
    with zipfile.ZipFile(path) as docx:
        document = ET.fromstring(docx.read("word/document.xml"))

    lines = []
    for paragraph in document.iter(f"{WORD_NS}p"):
        text = paragraph_text(paragraph)
        if text:
            lines.append(re.sub(r"\s+", " ", text))
    return lines


def split_song(line):
    parts = [part.strip() for part in line.split(" - ") if part.strip()]
    if len(parts) < 2:
        return None

    title = parts[-1]
    artist = " - ".join(parts[:-1])
    return artist, title


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "cancionero_corregido_avanzado.docx")
    target = Path(sys.argv[2] if len(sys.argv) > 2 else "data/songs.json")

    rows = []
    seen = set()
    for line in read_docx_lines(source):
        if line.lower().startswith("cancionero karaoke"):
            continue

        parsed = split_song(line)
        if not parsed:
            continue

        artist, title = (unicodedata.normalize("NFC", value) for value in parsed)
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


if __name__ == "__main__":
    main()
