/// <reference types="vite/client" />

declare module 'virtual:spacelab-bundled-modules' {
  const entries: readonly import('../../../modules/mod-menu/src/catalogue').BundledModuleEntry[];
  export default entries;
}

declare module 'virtual:starter-products' {
  const products: readonly import('./starter-product-format').StarterProduct[];
  export default products;
}
