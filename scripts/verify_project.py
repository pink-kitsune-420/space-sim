#!/usr/bin/env python3
"""Validate this planning package; never execute archived code or write to source."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--source', type=Path,
        help='also verify the original checkout, read-only, against the capture',
    )
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'references/manifest.json').read_text())
    paths = set()
    reference = ROOT / 'references/c64'
    for entry in manifest['files']:
        relative = Path(entry['path'])
        require(not relative.is_absolute() and '..' not in relative.parts,
                f'unsafe manifest path: {relative}')
        require(entry['path'] not in paths, f'duplicate reference: {relative}')
        paths.add(entry['path'])
        copied = reference / relative
        require(copied.is_file() and not copied.is_symlink(), f'missing copy: {relative}')
        require(copied.stat().st_size == entry['bytes'], f'changed size: {relative}')
        require(digest(copied) == entry['sha256'], f'changed reference: {relative}')
        if args.source:
            require(digest(args.source / relative) == entry['sha256'],
                    f'original source changed: {relative}')
    actual = {str(p.relative_to(reference)) for p in reference.rglob('*') if p.is_file()}
    require(actual == paths, 'reference files differ from the manifest')
    # Dependencies contain intentional executable symlinks; validate owned sources only.
    excluded = {'.git', '.agents', '.codex', '.aws', 'node_modules', 'dist',
                'coverage', 'playwright-report', 'test-results'}
    project_files = []
    for directory, folders, files in os.walk(ROOT):
        folders[:] = [name for name in folders if name not in excluded]
        entries = [Path(directory) / name for name in folders + files]
        require(not any(p.is_symlink() for p in entries), 'symlink in project sources')
        project_files.extend(Path(directory) / name for name in files)

    if args.source:
        revision = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=args.source, text=True).strip()
        require(revision == manifest['source_revision'], 'source HEAD changed')
        status = subprocess.check_output(
            ['git', 'status', '--porcelain'], cwd=args.source, text=True)
        require(status == manifest['source_status'], 'source working-tree status changed')

    local_links = 0
    generated_docs = [p for p in project_files if p.suffix == '.md' and reference not in p.parents]
    for document in generated_docs:
        for raw in re.findall(r'\[[^\]]*\]\(([^)]+)\)', document.read_text()):
            target = raw.strip('<>')
            parsed = urlsplit(target)
            if parsed.scheme or not parsed.path:
                continue
            resolved = (document.parent / unquote(parsed.path)).resolve()
            require(resolved.is_relative_to(ROOT), f'link outside project: {document}: {raw}')
            require(resolved.exists(), f'broken link: {document}: {raw}')
            local_links += 1

    scenario = json.loads((ROOT / 'packages/scenarios/legacy-c64.json').read_text())
    require(scenario['schemaVersion'] == 1, 'unexpected scenario schema')
    require(scenario['sourceRevision'] == manifest['source_revision'], 'scenario base mismatch')
    bodies = {b['id']: b for b in scenario['bodies']}
    require(len(bodies) == len(scenario['bodies']), 'duplicate body IDs')
    planet, moon = bodies['planet'], bodies['moon']
    require(math.isclose(planet['mu'] / planet['radiusMetres']**2, 50), 'planet units wrong')
    require(planet['mu'] / moon['mu'] == 64, 'moon mass ratio wrong')
    require(moon['parentId'] == 'planet', 'moon parent wrong')
    require(moon['soi']['entryMetres'] < moon['soi']['exitMetres'], 'SOI hysteresis wrong')
    require(moon['ephemeris']['radiusMetres'] == 30 * planet['radiusMetres'], 'moon scale wrong')
    require(moon['ephemeris']['direction'] == -1, 'legacy moon direction wrong')
    for preset in scenario['presets']:
        require(preset['bodyId'] in bodies, 'unknown preset body')
        if preset['kind'] == 'circular-orbit':
            require(preset['radiusMetres'] > bodies[preset['bodyId']]['radiusMetres'],
                    'orbit inside surface')
            require(preset['direction'] == -1, 'legacy orbit direction wrong')

    print(f'PASS: {len(paths)} verbatim reference files; '
          f'{len(generated_docs)} project documents; {local_links} local links; scenario consistency')
    if args.source:
        print(f'PASS: original source hashes, HEAD and working-tree status unchanged at {revision}')
    print('Scope: reference/document/scenario integrity; run npm test and npm run test:browser for implementation checks.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f'FAIL: {exc}') from exc
