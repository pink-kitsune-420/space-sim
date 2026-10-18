/** The host supplies a borrowed settings root; every control ID is scoped to this mount. */
export function audioSettings(prefix: string): string {
  return `<h3>Sound</h3><div class="settings-buttons"><button id="${prefix}-toggle" type="button" aria-pressed="true">Sound: On</button></div>
<label for="${prefix}-volume">Volume</label><input id="${prefix}-volume" type="range" min="0" max="100" value="40" aria-label="Sound volume"/>
<p id="${prefix}-status" class="control-note">Engine rumble and flight cues.</p>`;
}
