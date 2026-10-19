/// <reference types="vite/client" />

declare module 'virtual:spacelab-bundled-modules' {
  const entries: readonly import('../../../modules/mod-menu/src/catalogue').BundledModuleEntry[];
  export default entries;
}
