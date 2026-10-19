"""Integrity scope regressions: python3 -m unittest discover -s tests -p '*_test.py'."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify_project', Path(__file__).resolve().parents[1] / 'scripts/verify_project.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write('games/space-sim/universes/sandbox/default/universe.json',
                   (verify.ROOT / 'games/space-sim/universes/sandbox/default/universe.json').read_text())
        self.write('README.md', '[public](public.md)')
        self.write('public.md', 'Public documentation')

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def git(self, *args):
        subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)

    def checkout(self):
        self.git('init', '-q')
        self.write('.gitignore', 'ROADMAP.md\nprivate-docs/\n.tickets/\n')
        self.git('add', '.')
        self.write('ROADMAP.md', '[shared tracker](.tickets/)')
        self.write('private-docs/notes.md', '[external](../../outside.md)')

    def run_check(self):
        with patch.object(verify, 'ROOT', self.root), patch.object(sys, 'argv', ['verify_project']), contextlib.redirect_stdout(io.StringIO()):
            verify.main()

    def test_prepared_checkout_ignores_private_shared_links(self):
        self.checkout()
        self.run_check()
        self.assertFalse((self.root / '.tickets').exists())

    def test_public_source_export(self):
        self.run_check()

    def test_broken_public_links_in_checkout_and_export(self):
        self.write('public.md', '[missing](missing.md)')
        with self.assertRaisesRegex(ValueError, 'broken link'):
            self.run_check()
        self.checkout()
        with self.assertRaisesRegex(ValueError, 'broken link'):
            self.run_check()

    def test_new_public_sources_are_checked(self):
        self.checkout()
        self.write('new.md', '[missing](missing.md)')
        with self.assertRaisesRegex(ValueError, 'broken link'):
            self.run_check()

    def test_external_public_link_is_rejected(self):
        self.checkout()
        self.write('public.md', '[outside](../outside.md)')
        with self.assertRaisesRegex(ValueError, 'link outside project'):
            self.run_check()

    def test_source_symlinks_in_checkout_and_export(self):
        (self.root / 'source.ts').symlink_to('/does-not-exist')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.run_check()
        self.checkout()
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.run_check()

    def test_source_directory_symlink(self):
        self.checkout()
        (self.root / 'games/space-sim/universes/sandbox/default/universe.json').unlink()
        (self.root / 'games/space-sim/universes/sandbox/default').rmdir()
        (self.root / 'games/space-sim/universes/sandbox/default').symlink_to('/tmp')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.run_check()

    def test_universe_consistency_is_checked(self):
        self.checkout()
        path = self.root / 'games/space-sim/universes/sandbox/default/universe.json'
        universe = json.loads(path.read_text())
        next(b for system in universe['systems'] if system['id'] == 'primus-system' for b in system['bodies'] if b['id'] == 'planet')['mu'] = 1
        path.write_text(json.dumps(universe))
        with self.assertRaisesRegex(ValueError, 'planet units wrong'):
            self.run_check()


if __name__ == '__main__':
    unittest.main()
