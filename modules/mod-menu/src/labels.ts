/** Friendly fallback for old manifests whose display name is their identifier. */
export function moduleLabel(manifest: { readonly id: string; readonly name: string }): string {
  if (manifest.name !== manifest.id) return manifest.name;
  if (manifest.id === 'builtin.content') return 'Universe content';
  if (manifest.id === 'builtin.motion') return 'Orbital flight';
  const words = manifest.id.split('.').at(-1)!.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${manifest.id.startsWith('example.') ? ' (example)' : ''}`;
}
