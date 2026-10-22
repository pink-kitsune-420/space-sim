import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const publicId='virtual:starter-products',virtualId='\0'+publicId;
const root=fileURLToPath(new URL('../',import.meta.url));
// Source identity includes the complete current first-party generating graph.
const sources=['scripts/starter-products.ts','apps/web/src/starter-product-format.ts','games/space-sim-successor/planet-preview.json','apps/web/src/successor-materials.ts','apps/web/src/successor-overview.ts','packages/sim-core/src/planet-surface.ts','packages/sim-core/src/surface.ts','packages/game-api/src/planet-map.ts','packages/game-api/src/planet-field/bake.ts','packages/game-api/src/planet-field/field.ts','packages/game-api/src/planet-field/noise.ts','packages/game-api/src/planet-field/definition.ts','packages/game-api/src/math.ts','packages/sim-core/src/dmath.ts','packages/game-api/src/render-overview.ts'];
const digest=b=>createHash('sha256').update(b).digest('hex');

/** Same canonical products for local-origin hosted files and embedded offline data.
 * No runtime dependency, persistent cache or changed module/physics authority. */
export function starterProductsPlugin(){
 let products, pending, isBuild=false;
 async function prepare(){
  if(pending)return pending;
  pending=(async()=>{
   const directory=await mkdtemp(join(tmpdir(),'space-lab-starter-build-'));
   try{
    await build({configFile:false,root,logLevel:'silent',build:{ssr:resolve(root,'scripts/starter-products.ts'),outDir:directory,emptyOutDir:true,minify:false,rollupOptions:{output:{entryFileNames:'starter.mjs'}}}});
    const {buildStarterProducts}=await import(pathToFileURL(join(directory,'starter.mjs')).href);
    const hash=createHash('sha256');for(const name of sources){hash.update(name);hash.update(await readFile(resolve(root,name)));}
    const sourceIdentity=hash.digest('hex');
    products=buildStarterProducts().map(p=>{
     const compressed=gzipSync(p.bytes,{level:9}),sha=digest(compressed);
     return {compressed,descriptor:{format:'space-lab.starter-product/1',bodyId:p.bodyId,surfaceIdentity:p.surfaceIdentity,sourceIdentity,bytes:p.bytes.length,compressedBytes:compressed.length,digest:sha,rawDigest:digest(p.bytes),path:'starter-products/'+p.bodyId+'-'+sha.slice(0,16)+'.bin',tree:p.tree}};
    });return products;
   }finally{await rm(directory,{recursive:true,force:true});}
  })();return pending;
 }
 return {name:'space-lab-starter-products',
  configResolved(config){isBuild=config.command==='build';},
  resolveId(id){if(id===publicId)return virtualId;},
  async load(id){if(id!==virtualId)return;for(const name of sources)this.addWatchFile(resolve(root,name));return 'export default '+JSON.stringify((await prepare()).map(p=>p.descriptor))+';';},
  async generateBundle(){for(const p of await prepare())this.emitFile({type:'asset',fileName:p.descriptor.path,source:p.compressed});this.emitFile({type:'asset',fileName:'starter-products/index.json',source:JSON.stringify(products.map(p=>p.descriptor))});},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(!req.url?.startsWith('/starter-products/'))return next();
   try{const product=(await prepare()).find(p=>'/'+p.descriptor.path===req.url.split('?')[0]);if(!product)return next();res.setHeader('Content-Type','application/octet-stream');res.end(product.compressed);}catch(error){next(error);}
  });server.watcher.on('change',file=>{if(sources.some(name=>resolve(root,name)===file)){pending=undefined;products=undefined;}});},
  transformIndexHtml:{order:'post',handler(html){
   if(!isBuild)return html;
   // Inert until a loading-shell paint. The offline inliner embeds the same entry;
   // neither path needs dynamic imports or a second JavaScript dependency graph.
   html=html.replace(/<script\b([^>]*type="module"[^>]*src="[^"]+"[^>]*)><\/script>/g,(_,attrs)=>'<script '+attrs.replace('type="module"','type="application/x-space-lab-entry"')+' data-space-lab-entry></script>');
   return html.replace('</body>',`<script>requestAnimationFrame(function(){setTimeout(function(){var source=document.querySelector('script[data-space-lab-entry]');if(!source)return;var entry=document.createElement('script');entry.type='module';if(source.hasAttribute('src'))entry.src=source.getAttribute('src');else entry.textContent=source.textContent;entry.onerror=function(){document.getElementById('loading-stage').textContent='The application could not load. Retry or open a legacy world.';document.getElementById('loading-retry').hidden=false;};document.head.appendChild(entry);source.remove();},0);});</script>\n</body>`);
  }},
 };
}
