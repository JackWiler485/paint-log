#!/usr/bin/env python3
"""Build data/paints.json from the Paintdex Warhammer paint list.

Downloads data/paints/warhammer.json from
https://github.com/s10-steve/paintdex (MIT licence) and keeps the fields the
app uses: id, name, range, type, hex colour, discontinued and metallic.

Usage (needs Python 3):
    python3 tools/build-paints.py
"""

import json
import pathlib
import urllib.request
from datetime import date

REPO = 's10-steve/paintdex'
SOURCE_URL = f'https://raw.githubusercontent.com/{REPO}/main/data/paints/warhammer.json'
OUT_FILE = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'paints.json'


def main():
    with urllib.request.urlopen(SOURCE_URL) as response:
        source = json.loads(response.read().decode('utf-8'))

    paints = []
    for paint in source:
        entry = {
            'id': paint['id'],
            'name': paint['name'],
            'range': paint['range'],
            'type': paint['type'],
            'hex': paint['hex'].upper(),
        }
        if paint.get('discontinued'):
            entry['discontinued'] = True
        if paint.get('metallic'):
            entry['metallic'] = True
        paints.append(entry)

    paints.sort(key=lambda p: (p['name'].lower(), p['range']))
    output = {
        'source': f'https://github.com/{REPO}',
        'licence': 'MIT',
        'built': date.today().isoformat(),
        'paints': paints,
    }
    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    current = sum(1 for p in paints if not p.get('discontinued'))
    print(f'{len(paints)} paints ({current} current). Wrote {OUT_FILE} ({OUT_FILE.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
