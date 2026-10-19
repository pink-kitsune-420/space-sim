"""Check final download completeness, archives and hashes before publication.

Usage: python3 scripts/verify_release_distribution.py release-files v0.6.2a
Android remains optional, matching the release workflow's sideload-build policy.
"""
from pathlib import Path
import hashlib
import stat
import sys
import tarfile
import zipfile


def verify(root, tag):
    native = {
        f'space-sim{server}-{tag}-{platform}.{extension}'
        for server in ['', '-server']
        for platform, extension in [('linux-x64', 'tar.gz'), ('macos-arm64', 'tar.gz'), ('windows-x64', 'zip')]
    }
    bundle = f'spacelab-{tag}-all-platforms.zip'
    required = native | {'SHA256SUMS.txt', 'LICENSE', 'CREDITS.md', f'space-lab-{tag}-offline.html',
        f'spacelab-{tag}-itch.zip', f'space-sim-universes-{tag}.tar.gz', 'space-sim.spacegame',
        'space-sim.spaceuniverse', bundle}
    present = {p.name for p in root.iterdir() if p.is_file()}
    missing = required - present
    if missing:
        raise ValueError(f'Missing release files: {sorted(missing)}')
    # Additional editable game/universe packs are permitted as the catalogue grows.
    checks = {}
    for line in (root / 'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        name = name.lstrip('*')
        if Path(name).name != name or name in checks or name == 'SHA256SUMS.txt':
            raise ValueError(f'Invalid checksum entry: {name}')
        with (root / name).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                raise ValueError(f'Checksum mismatch: {name}')
        checks[name] = digest
    if set(checks) != present - {'SHA256SUMS.txt'}:
        raise ValueError('Checksums do not cover every download')
    for filename in native:
        binary = 'space-sim-server' if filename.startswith('space-sim-server') else 'space-sim'
        if filename.endswith('.zip'):
            binary += '.exe'
            with zipfile.ZipFile(root / filename) as archive:
                if set(archive.namelist()) != {binary, 'NODE-LICENSE.txt'}:
                    raise ValueError(f'Invalid executable archive: {filename}')
                license_bytes = archive.read('NODE-LICENSE.txt')
                if archive.getinfo(binary).file_size == 0:
                    raise ValueError(f'Empty executable: {filename}')
        else:
            with tarfile.open(root / filename) as archive:
                if set(archive.getnames()) != {binary, 'NODE-LICENSE.txt'}:
                    raise ValueError(f'Invalid executable archive: {filename}')
                member = archive.getmember(binary)
                if not member.isfile() or member.size == 0 or stat.S_IMODE(member.mode) != 0o755:
                    raise ValueError(f'Invalid executable permissions or content: {filename}')
                license_bytes = archive.extractfile('NODE-LICENSE.txt').read()
        if b'Node.js' not in license_bytes or len(license_bytes) < 10000:
            raise ValueError(f'Missing runtime license: {filename}')
    with zipfile.ZipFile(root / bundle) as archive:
        if set(archive.namelist()) != present - {bundle, 'SHA256SUMS.txt'}:
            raise ValueError('All-platform bundle does not contain the individual downloads')
        for name in archive.namelist():
            with archive.open(name) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != checks[name]:
                    raise ValueError(f'Bundle member differs from individual download: {name}')
    html = (root / f'space-lab-{tag}-offline.html').read_bytes()
    with zipfile.ZipFile(root / f'spacelab-{tag}-itch.zip') as archive:
        if archive.read('index.html') != html:
            raise ValueError('Browser ZIP differs from the tested offline player')
    apk = root / f'space-sim-{tag}-android.apk'
    if apk.exists():
        with zipfile.ZipFile(apk) as archive:
            if archive.read('assets/public/space-lab-offline.html') != html:
                raise ValueError('Android embeds a different browser build')
    print(f'Verified {len(present)} downloads, {len(checks)} hashes, six executable archives and matching browser payloads.')


if __name__ == '__main__':
    verify(Path(sys.argv[1]), sys.argv[2])
