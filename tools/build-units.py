#!/usr/bin/env python3
"""Build data/units.json from the BSData wh40k-11e-mfm dataset.

Downloads one YAML file per faction from
https://github.com/BSData/wh40k-11e-mfm (MIT licence) and keeps only what the
app needs: faction names, unit names, chapter/sub-faction groups, the Legends
flag, squad sizes and points. Rules text, detachments and enhancements are
left out.

Usage (needs Python 3 and PyYAML):
    python3 tools/build-units.py
"""

import json
import pathlib
import urllib.request
from datetime import date

import yaml

REPO = 'BSData/wh40k-11e-mfm'
API_URL = f'https://api.github.com/repos/{REPO}/contents/data'
RAW_URL = f'https://raw.githubusercontent.com/{REPO}/main/data/'
OUT_FILE = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'units.json'

# Factions whose groups are sub-factions the user can pick (e.g. Ultramarines).
SUBFACTION_FACTIONS = {'space-marines'}

# Group labels that add nothing in the app, so they are dropped.
HIDDEN_GROUPS = {'Space Marines', 'Every Model Has The Imperium Keyword'}


def fetch(url):
    with urllib.request.urlopen(url) as response:
        return response.read().decode('utf-8')


def parse_range(text):
    """'[1,2]' -> (1, 2), '[3,)' -> (3, None)."""
    low, high = text.strip('[]()').split(',')
    return int(low), (int(high) if high else None)


def convert_unit(unit):
    pricing = []
    for price in unit.get('pricing', []):
        low, high = parse_range(price['range'])
        costs = [[cost['models'], cost['points']] for cost in price.get('costs', [])]
        pricing.append([low, high, costs])

    sizes = sorted({models for models, _ in pricing[0][2]}) if pricing else []
    result = {'name': unit['name'], 'sizes': sizes, 'pricing': pricing}
    group = unit.get('groupTitle')
    if group and group not in HIDDEN_GROUPS:
        result['group'] = group
    if unit.get('legends'):
        result['legends'] = True
    return result


def main():
    files = [item['name'] for item in json.loads(fetch(API_URL))
             if item['name'].endswith('.yaml') and item['name'] != 'meta.yaml']
    meta = yaml.safe_load(fetch(RAW_URL + 'meta.yaml'))

    factions = []
    for file_name in sorted(files):
        data = yaml.safe_load(fetch(RAW_URL + file_name))
        units = sorted((convert_unit(u) for u in data.get('units') or []),
                       key=lambda u: u['name'].lower())
        faction = {'id': data['slug'], 'name': data['name'], 'units': units}
        if data['slug'] in SUBFACTION_FACTIONS:
            faction['subfactions'] = sorted({u['group'] for u in units if 'group' in u})
        factions.append(faction)
        print(f"{data['name']}: {len(units)} units")

    factions.sort(key=lambda f: f['name'].lower())
    output = {
        'source': f'https://github.com/{REPO}',
        'licence': 'MIT',
        'dataVersion': str(meta.get('version', '')),
        'dataUpdated': str(meta.get('lastUpdated', '')),
        'built': date.today().isoformat(),
        'factions': factions,
    }
    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {OUT_FILE} ({OUT_FILE.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
