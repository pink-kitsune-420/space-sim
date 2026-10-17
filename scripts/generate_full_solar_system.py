#!/usr/bin/env python3
"""Generate the 1:1 full solar system universe from NASA/JPL Solar System Dynamics data.

Inputs are files downloaded from JPL SSD (public NASA data), kept outside the repo:

    curl -o DIR/elem.html       https://ssd.jpl.nasa.gov/sats/elem/
    curl -o DIR/phys.html       https://ssd.jpl.nasa.gov/sats/phys_par/
    curl -o DIR/approx_pos.html https://ssd.jpl.nasa.gov/planets/approx_pos.html
    # One Horizons object-data header per planet (199..999) and per satellite code
    # that has no entry in phys.html:
    curl -o DIR/horizons/<code>.txt \
      "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='<code>'&OBJ_DATA='YES'&MAKE_EPHEM='NO'"

Then:  python3 scripts/generate_full_solar_system.py DIR games/space-sim/universes/astronomy/full-solar-system/universe.json

The game is 2D and its ephemerides are circular, so every body moves on a circle of
its semi-major axis in the ecliptic plane. Phases are mean longitudes at J2000
(projected through the inclination); retrograde moons (i > 90 deg) orbit clockwise.
Radii and GM come from JPL where published. Small moons without a published radius
use the Horizons absolute magnitude V(1,0) and albedo (default 0.04), and then a
density of 1.5 g/cm^3 for the mass; moons with neither use a 1.5 km radius.
Dwarf planets other than Pluto and their moons use rounded literature values.
"""

import html
import json
import math
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

G = 6.67430e-11
AU = 149_597_870_700.0
DAY = 86_400.0
J2000_JD = 2451545.0


class Table(HTMLParser):
    """Collect the body rows of one HTML table by id."""

    def __init__(self, table_id):
        super().__init__()
        self.table_id, self.depth, self.in_body = table_id, 0, False
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            if dict(attrs).get('id') == self.table_id or self.depth:
                self.depth += 1
        if not self.depth:
            return
        if tag == 'tbody':
            self.in_body = True
        elif tag == 'tr' and self.in_body:
            self.row = []
        elif tag == 'td' and self.row is not None:
            if self.cell is not None:
                self.row.append(self.cell)
            self.cell = ''

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag == 'table':
            self.depth -= 1
        elif tag == 'td' and self.cell is not None and self.row is not None:
            self.row.append(self.cell)
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.cell is not None:
                self.row.append(self.cell)
                self.cell = None
            self.rows.append([re.sub(r'\s+', ' ', html.unescape(c)).strip() for c in self.row])
            self.row = None
        elif tag == 'tbody':
            self.in_body = False

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data


def number(text):
    text = (text or '').strip().replace('−', '-').rstrip('.')
    try:
        return float(text)
    except ValueError:
        return None


def table(path, table_id):
    parser = Table(table_id)
    parser.feed(Path(path).read_text(encoding='utf-8', errors='replace'))
    return parser.rows


def epoch_jd(text):
    """'2000-01-01.5' -> Julian date (proleptic Gregorian)."""
    m = re.match(r'(\d{4})-(\d{2})-(\d{2}(?:\.\d+)?)', text)
    if not m:
        return J2000_JD
    y, mo, d = int(m.group(1)), int(m.group(2)), float(m.group(3))
    if mo <= 2:
        y, mo = y - 1, mo + 12
    a = y // 100
    b = 2 - a + a // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (mo + 1)) + d + b - 1524.5


def horizons(path):
    """Radius (km), GM (km^3/s^2), V(1,0) and albedo from a Horizons object-data header."""
    if not path.exists():
        return {}
    text = path.read_text(encoding='utf-8', errors='replace')
    out = {}
    m = re.search(r'(?:Vol\.\s*[Mm]ean [Rr]adius|Mean [Rr]adius)\s*\(km\)\s*=\s*([0-9.]+)', text)
    if not m:
        m = re.search(r'\bRadius\s*\(km\)\s*=\s*([~<]?\s*[0-9.]+(?:\s*[xX]\s*[0-9.]+)*)', text)
    if m:
        dims = [float(v) for v in re.findall(r'[0-9.]+', m.group(1)) if v != '.']
        if dims:
            out['radius_km'] = math.prod(dims) ** (1 / len(dims)) if len(dims) == 3 else dims[0]
    m = re.search(r'GM[^=\n]*?km\^3/s\^2\)?\s*=\s*([0-9.]+(?:[eE][+-]?\d+)?)', text)
    if m and number(m.group(1)):
        out['gm_km3s2'] = number(m.group(1))
    else:
        m = re.search(r'Mass\s*\(10\^(\d+)\s*(kg|g)\s*\)\s*=\s*([0-9.]+)', text) \
            or re.search(r'Mass\s*x\s*10\^(\d+)\s*\((kg|g)\)\s*=\s*([0-9.]+)', text)
        if m and number(m.group(3)):
            kg = number(m.group(3)) * 10 ** int(m.group(1)) * (1e-3 if m.group(2) == 'g' else 1)
            out['gm_km3s2'] = kg * G / 1e9
    m = re.search(r'V\(1,0\)\s*=\s*([+-]?[0-9.]+)', text)
    if m and number(m.group(1)) is not None:
        out['h'] = number(m.group(1))
    m = re.search(r'Geometric Albedo\s*=\s*([0-9.]+)', text)
    if m and number(m.group(1)):
        out['albedo'] = number(m.group(1))
    return out


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def display(name):
    """'S2003_J_2' -> 'S/2003 J 2'."""
    m = re.match(r'^S(\d{4})_?([A-Z])_?(\d+)$', name)
    return f'S/{m.group(1)} {m.group(2)} {m.group(3)}' if m else name.replace('_', ' ')


# Planet colours (disc, horizon/accent, sky) chosen for the game's palette.
PLANET_STYLE = {
    'mercury': ('#6f6a66', '#a8a29e', '#00000000', 'craters'),
    'venus': ('#c9a86a', '#f2d9a2', '#f0d49a55', 'smooth'),
    'earth': ('#1b4965', '#62b6cb', '#48cae480', 'globe-lines'),
    'mars': ('#9c4a2f', '#d9825b', '#d9825b40', 'craters'),
    'jupiter': ('#b08a63', '#e3c9a3', '#e3c9a350', 'globe-lines'),
    'saturn': ('#c2a868', '#ecd9a4', '#ecd9a450', 'globe-lines'),
    'uranus': ('#6fb7c4', '#b6e3ea', '#b6e3ea50', 'smooth'),
    'neptune': ('#3a5fb0', '#7d9ee8', '#7d9ee850', 'smooth'),
    'pluto': ('#b39b87', '#e0d0c0', '#00000000', 'craters'),
    'ceres': ('#5f5c58', '#9b9792', '#00000000', 'craters'),
    'eris': ('#d8d4cf', '#f4f1ec', '#00000000', 'craters'),
    'haumea': ('#cfcac4', '#efe9e2', '#00000000', 'craters'),
    'makemake': ('#a8826a', '#d8b9a2', '#00000000', 'craters'),
}

# Procedural looks (see BodyAppearance): style and up to four colours whose roles depend on it.
APPEARANCE = {
    'sun': ('star', ('#fff8e6', '#ffd27a', '#ff8a2a', '#c8661c')),
    'mercury': ('rocky', ('#8a837c', '#5e5852', '#b3aca4', '#8a837c')),
    'venus': ('hazy', ('#d9b878', '#b8925a', '#f2dfae', '#e8cc90')),
    'earth': ('oceanic', ('#1a4f86', '#3f7535', '#c7a56a', '#f2f6f8')),
    'mars': ('arid', ('#b65a33', '#6e3420', '#d79a72', '#f2ede6')),
    'jupiter': ('banded', ('#d8b98e', '#a5714a', '#f4e8d2', '#c25a3c')),
    'saturn': ('banded', ('#e2cd98', '#bf9f68', '#f6ecca', '#d6bd86')),
    'uranus': ('hazy', ('#9fd8e0', '#84c4cf', '#c9eff3', '#9fd8e0')),
    'neptune': ('banded', ('#3f6fd0', '#2b4fa6', '#86aef2', '#eef4ff')),
    'pluto': ('icy', ('#d9c3a8', '#8a6650', '#f6eee0', '#d9c3a8')),
    'ceres': ('rocky', ('#6e6a66', '#4a4743', '#9d9893', '#6e6a66')),
    'eris': ('icy', ('#e6e2dd', '#a8a39c', '#ffffff', '#e6e2dd')),
    'haumea': ('icy', ('#e2ded8', '#a39d95', '#ffffff', '#e2ded8')),
    'makemake': ('icy', ('#c9a487', '#8a6a52', '#efdccb', '#c9a487')),
    'moon': ('rocky', ('#8f8d89', '#4f4d4b', '#c0bdb6', '#8f8d89')),
    'io': ('volcanic', ('#c9b048', '#6e5a2a', '#ff5a1a', '#efe28a')),
    'europa': ('icy', ('#d9cdb8', '#9a6a48', '#f6f1e8', '#d9cdb8')),
    'ganymede': ('rocky', ('#8a8070', '#5a5248', '#b9b0a2', '#d8d8d8')),
    'callisto': ('rocky', ('#5a5248', '#3a352f', '#9a9288', '#5a5248')),
    'titan': ('hazy', ('#d09a4a', '#a8742e', '#e8bf7a', '#c08a3e')),
    'enceladus': ('icy', ('#eef6fb', '#8fb0c4', '#ffffff', '#eef6fb')),
    'triton': ('icy', ('#d6c4bc', '#9a7f74', '#f2e8e2', '#d6c4bc')),
    'charon': ('rocky', ('#8a847e', '#5a544e', '#b5aea7', '#8a847e')),
}

# Dwarf planets beyond Pluto: (a AU, mean longitude deg at J2000, radius km, GM km^3/s^2).
# Rounded literature values; their orbits are as approximate as the circular model.
DWARFS = {
    'ceres': ('Ceres', 2.7675, 153.9, 469.7, 62.6284),
    'eris': ('Eris', 67.86, 204.2, 1163.0, 1108.0),
    'haumea': ('Haumea', 43.13, 218.2, 780.0, 267.4),
    'makemake': ('Makemake', 45.79, 175.0, 715.0, 206.9),
}
# Moons of those dwarf planets: (id, name, parent, a km, period d, radius km, phase deg).
DWARF_MOONS = [
    ('dysnomia', 'Dysnomia', 'eris', 37_273, 15.786, 307.0, 0.0),
    ('hi-iaka', "Hi'iaka", 'haumea', 49_880, 49.12, 160.0, 0.0),
    ('namaka', 'Namaka', 'haumea', 25_657, 18.28, 85.0, 120.0),
    ('mk2', 'MK2', 'makemake', 22_250, 18.02, 87.0, 0.0),
]


def main(source, out):
    source = Path(source)
    approx = Path(source / 'approx_pos.html').read_text(encoding='utf-8', errors='replace')
    approx = html.unescape(re.sub(r'<[^>]+>', '', approx))
    block = approx[approx.find('Table 1'):approx.find('Table 2a')]
    planet_elements = {}
    for name, a, e, inc, L in re.findall(
            r'^(Mercury|Venus|EM Bary|Mars|Jupiter|Saturn|Uranus|Neptune)\s+([0-9.]+)\s+([0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)',
            block, re.M):
        planet_elements['earth' if name == 'EM Bary' else name.lower()] = (float(a), float(L))
    # Pluto from the same JPL table family (Table 1 of the older Standish list).
    planet_elements.setdefault('pluto', (39.48211675, 238.92903833))

    bodies = [{
        'id': 'sun', 'name': 'Sun', 'parentId': None, 'radius': 695_700_000, 'mu': 1.32712440041e20,
        'color': '#ffd000', 'accentColor': '#ff7700', 'atmosphereColor': '#ffaa0060', 'surfaceFeatures': 'star',
        'ephemeris': {'kind': 'fixed-inertial', 'position': [0, 0], 'velocity': [0, 0]},
    }]
    codes = {'mercury': 199, 'venus': 299, 'earth': 399, 'mars': 499, 'jupiter': 599,
             'saturn': 699, 'uranus': 799, 'neptune': 899, 'pluto': 999}
    for pid, code in codes.items():
        info = horizons(source / 'horizons' / f'{code}.txt')
        if 'radius_km' not in info or 'gm_km3s2' not in info:
            raise SystemExit(f'missing Horizons data for {pid} ({code})')
        a_au, longitude = planet_elements[pid]
        color, accent, sky, features = PLANET_STYLE[pid]
        bodies.append({
            'id': pid, 'name': pid.capitalize(), 'parentId': 'sun',
            'radius': round(info['radius_km'] * 1000, 3), 'mu': info['gm_km3s2'] * 1e9,
            'color': color, 'accentColor': accent, 'horizonColor': accent, 'atmosphereColor': sky, 'skyColor': sky,
            'surfaceFeatures': features,
            'ephemeris': {'kind': 'circular-kepler', 'radius': round(a_au * AU),
                          'phaseRadiansAtEpoch': math.radians(longitude % 360), 'direction': 1},
        })
    for pid, (name, a_au, longitude, radius_km, gm) in DWARFS.items():
        color, accent, sky, features = PLANET_STYLE[pid]
        bodies.append({
            'id': pid, 'name': name, 'parentId': 'sun', 'radius': radius_km * 1000, 'mu': gm * 1e9,
            'color': color, 'accentColor': accent, 'horizonColor': accent, 'surfaceFeatures': features,
            'ephemeris': {'kind': 'circular-kepler', 'radius': round(a_au * AU),
                          'phaseRadiansAtEpoch': math.radians(longitude % 360), 'direction': 1},
        })

    physical = {}
    for r in table(source / 'phys.html', 'sat_phys_par'):
        if len(r) >= 12:
            physical[r[2]] = {'gm_km3s2': number(r[3]), 'radius_km': number(r[6])}
    seen = set()
    estimated = []
    ids = {b['id'] for b in bodies}
    for r in table(source / 'elem.html', 'sat_elem'):
        if len(r) < 14:
            continue
        planet, raw_name, code = r[1].lower(), r[2], r[3]
        if code in seen or planet not in codes:
            continue  # Puck appears twice (two ephemerides); keep the first.
        seen.add(code)
        a_km, e, w, M, inc, node, period = (number(r[i]) for i in range(7, 14))
        if not a_km or not period:
            continue
        # Mean anomaly at J2000 from the tabulated epoch.
        M = (M or 0) - 360 / period * (epoch_jd(r[6]) - J2000_JD)
        u = math.radians((w or 0) + M)
        i = math.radians(inc or 0)
        longitude = math.radians(node or 0) + math.atan2(math.cos(i) * math.sin(u), math.cos(u))
        data = dict(physical.get(code) or {})
        extra = horizons(source / 'horizons' / f'{code}.txt')
        for key in ('radius_km', 'gm_km3s2'):
            if not data.get(key) and extra.get(key):
                data[key] = extra[key]
        how = 'published'
        if not data.get('radius_km'):
            if extra.get('h') is not None:
                albedo = extra.get('albedo') or 0.04
                data['radius_km'] = 1329 / math.sqrt(albedo) * 10 ** (-extra['h'] / 5) / 2
                how = 'from magnitude'
            else:
                data['radius_km'] = 1.5
                how = 'assumed'
        if not data.get('gm_km3s2'):
            mass = 4 / 3 * math.pi * (data['radius_km'] * 1000) ** 3 * 1500
            data['gm_km3s2'] = mass * G / 1e9
            how += ', mass from density'
        if how != 'published':
            estimated.append((raw_name, how))
        bid = slug(display(raw_name))
        if bid in ids:
            bid = f'{bid}-{code}'
        ids.add(bid)
        retrograde = (inc or 0) > 90
        bodies.append({
            'id': bid, 'name': display(raw_name), 'parentId': planet,
            'radius': round(data['radius_km'] * 1000, 3), 'mu': data['gm_km3s2'] * 1e9,
            'color': '#5a5550', 'accentColor': '#a39e98', 'surfaceFeatures': 'craters',
            'ephemeris': {'kind': 'circular-kepler', 'radius': round(a_km * 1000),
                          'phaseRadiansAtEpoch': longitude % (2 * math.pi), 'direction': -1 if retrograde else 1},
        })
    for bid, name, parent, a_km, period, radius_km, phase in DWARF_MOONS:
        mass = 4 / 3 * math.pi * (radius_km * 1000) ** 3 * 1500
        bodies.append({
            'id': bid, 'name': name, 'parentId': parent, 'radius': radius_km * 1000, 'mu': mass * G,
            'color': '#77726c', 'accentColor': '#b5b0aa', 'surfaceFeatures': 'craters',
            'ephemeris': {'kind': 'circular-kepler', 'radius': a_km * 1000,
                          'phaseRadiansAtEpoch': math.radians(phase), 'direction': 1},
        })
    # The biggest moons get distinctive colours.
    styles = {'moon': ('#4a4e54', '#9aa0a6'), 'io': ('#c9b440', '#efe08a'), 'europa': ('#b8a990', '#e4d9c6'),
              'ganymede': ('#7d7466', '#b9b0a2'), 'callisto': ('#4f4a44', '#8c867e'), 'titan': ('#c08a3e', '#e8bf7a'),
              'triton': ('#b9a7a0', '#e0d2cc'), 'charon': ('#77716b', '#aaa49e'), 'enceladus': ('#d9e4ea', '#f4fbff')}
    for b in bodies:
        if b['id'] in styles:
            b['color'], b['accentColor'] = styles[b['id']]

    for b in bodies:
        if b['id'] in APPEARANCE:
            style, colors = APPEARANCE[b['id']]
            b['appearance'] = {'style': style, 'colors': list(colors)}
            b['color'] = colors[0]

    by_id = {b['id']: b for b in bodies}

    def orbit(body_id, altitude_m, name, phase=math.pi / 2):
        b = by_id[body_id]
        return {'id': f'{body_id}-orbit', 'name': name, 'bodyId': body_id, 'kind': 'circular-orbit',
                'radius': b['radius'] + altitude_m, 'altitude': altitude_m, 'phaseRadians': phase,
                'direction': 1, 'headingRadians': math.pi}

    def pad(body_id, name):
        b = by_id[body_id]
        return {'id': f'{body_id}-pad', 'name': name, 'bodyId': body_id, 'kind': 'landed',
                'position': [0, b['radius']], 'velocity': [0, 0], 'headingRadians': math.pi / 2, 'zoom': 1}

    presets = [
        pad('earth', 'Earth · North pad · ready to launch'),
        orbit('earth', 400_000, 'Earth low orbit · 400 km'),
        {**orbit('earth', 35_786_000, 'Earth geostationary altitude · 35,786 km'), 'id': 'earth-geo'},
        orbit('moon', 100_000, 'Moon low orbit · 100 km'),
        pad('moon', 'Moon · surface'),
        orbit('mars', 300_000, 'Mars low orbit · 300 km'),
        pad('mars', 'Mars · surface'),
        orbit('jupiter', 100_000_000, 'Jupiter orbit · 100,000 km'),
        orbit('europa', 100_000, 'Europa low orbit · 100 km'),
        orbit('saturn', 120_000_000, 'Saturn orbit · beyond the moonlets'),
        orbit('titan', 300_000, 'Titan low orbit · 300 km'),
        orbit('uranus', 50_000_000, 'Uranus orbit · 50,000 km'),
        orbit('triton', 100_000, 'Triton low orbit · 100 km'),
        orbit('pluto', 50_000, 'Pluto low orbit · 50 km'),
        {**orbit('sun', 1.0 * AU - 695_700_000, 'Sun orbit · 1 AU, beside Earth'), 'id': 'sun-orbit-1au',
         'phaseRadians': by_id['earth']['ephemeris']['phaseRadiansAtEpoch'] + 0.02},
    ]
    universe = {
        '$schema': '../../universe.schema.json',
        'schemaVersion': 1,
        'id': 'full-solar-system',
        'name': 'Full Solar System (1:1 scale, every known moon)',
        'description': (f'The real solar system at full scale: the Sun, 8 planets, 5 dwarf planets and '
                        f'{sum(1 for b in bodies if b["parentId"] not in (None, "sun"))} moons. Orbits are circular '
                        'in the ecliptic plane at their real semi-major axes, phased at J2000.'),
        'author': 'Space Sim Team · data: NASA/JPL Solar System Dynamics',
        'defaultSystemId': 'sol',
        'systems': [{
            'id': 'sol', 'name': 'Solar System (full scale)', 'centralBodyId': 'sun',
            'description': 'Every planet and every known moon at real size and distance.',
            'vehicleDefaults': {'acceleration': 50, 'turnRate': 1.227184630308513, 'initialThrottle': 0.5},
            'bodies': bodies, 'presets': presets,
        }],
    }
    Path(out).write_text(json.dumps(universe, indent=1) + '\n')
    moons = sum(1 for b in bodies if b['parentId'] not in (None, 'sun'))
    print(f'{len(bodies)} bodies ({moons} moons); {len(estimated)} moons with estimated size/mass')


if __name__ == '__main__':
    main(*sys.argv[1:3])
