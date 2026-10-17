#!/usr/bin/env python3
"""Validate project integrity, universes, and local documentation links."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    ref_count = 0

    # Dependencies contain intentional executable symlinks; validate owned sources only.
    excluded = {'.git', '.agents', '.codex', '.aws', 'node_modules', 'dist', 'dist-server', 'dist-desktop',
                'space-sim-data', 'private-docs', 'coverage', 'playwright-report', 'test-results', '.gradle', 'build', 'archive'}
    project_files = []
    for directory, folders, files in os.walk(ROOT):
        folders[:] = [name for name in folders if name not in excluded]
        entries = [Path(directory) / name for name in folders + files]
        require(not any(p.is_symlink() for p in entries), 'symlink in project sources')
        project_files.extend(Path(directory) / name for name in files)

    local_links = 0
    ref_dir = ROOT / 'references'
    generated_docs = [p for p in project_files if p.suffix == '.md' and ref_dir not in p.parents]
    for document in generated_docs:
        for raw in re.findall(r'\[[^\]]*\]\(([^)]+)\)', document.read_text()):
            target = raw.strip('<>')
            parsed = urlsplit(target)
            if parsed.scheme or not parsed.path or parsed.path.startswith('#'):
                continue
            resolved = (document.parent / unquote(parsed.path)).resolve()
            require(resolved.is_relative_to(ROOT), f'link outside project: {document}: {raw}')
            require(resolved.exists(), f'broken link: {document}: {raw}')
            local_links += 1

    default_universe_file = ROOT / 'games/space-sim/universes/sandbox/default/universe.json'
    require(default_universe_file.is_file(), 'missing default universe')
    universe = json.loads(default_universe_file.read_text())
    require(universe['schemaVersion'] == 1, 'unexpected universe schema')
    primus_sys = next((s for s in universe['systems'] if s['id'] == 'primus-system'), None)
    require(primus_sys is not None, 'primus-system missing from default universe')
    bodies = {b['id']: b for b in primus_sys['bodies']}
    planet, moon = bodies['planet'], bodies['moon']
    require(math.isclose(planet['mu'] / planet['radius']**2, 50), 'planet units wrong')
    require(planet['mu'] / moon['mu'] == 64, 'moon mass ratio wrong')
    require(moon['parentId'] == 'planet', 'moon parent wrong')
    require(moon['soi']['entryMetres'] < moon['soi']['exitMetres'], 'SOI hysteresis wrong')
    require(moon['ephemeris']['radiusMetres'] == 30 * planet['radius'], 'moon scale wrong')
    require(moon['ephemeris']['direction'] == -1, 'moon direction wrong')

    print(f'PASS: {ref_count} reference files checked; '
          f'{len(generated_docs)} project documents; {local_links} local links; universe consistency')
    print('Scope: project and universe integrity; run npm test and npm run test:browser for implementation checks.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f'FAIL: {exc}') from exc
