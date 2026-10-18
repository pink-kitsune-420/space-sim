const decoder = new TextDecoder('utf-8', { fatal: true });

/** Check nesting before JSON.parse (including malicious trees), and bound object/array counts. */
export function parsePackageJson(bytes: Uint8Array, label: string, maximum = 1024 * 1024, maxNodes = 65536): unknown {
  if (bytes.length > maximum) throw new Error(`${label}: JSON exceeds size limit`);
  const text = decoder.decode(bytes);
  let depth = 0, count = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') { if (++depth > 64 || ++count > maxNodes) throw new Error(`${label}: JSON complexity limit exceeded`); }
    else if (c === '}' || c === ']') depth--;
  }
  return JSON.parse(text);
}
