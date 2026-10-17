/** The built web game, embedded by vite.server.config.ts at build time. */
declare module 'virtual:space-sim-client' {
  const assets: Readonly<Record<string, { readonly type: string; readonly data: string }>>;
  export default assets;
}
