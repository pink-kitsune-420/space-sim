// Exercise the packaged runtime and embedded HTTP assets on every release OS.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const executable=resolve(process.argv[2]??'dist-desktop/space-sim');
async function smoke(unavailableBrowsers=false){
const env={...process.env};
if(unavailableBrowsers){
 const missing=resolve('missing-browser-smoke');
 env.DISPLAY='';env.WAYLAND_DISPLAY='';
 const names=['ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA','PATH','ComSpec'];
 for(const name of Object.keys(env))if(names.some(target=>target.toUpperCase()===name.toUpperCase()))delete env[name];
 for(const name of names)env[name]=missing;
}
const child=spawn(executable,[...(unavailableBrowsers?['--browser',resolve('missing-browser-smoke.exe')]:['--no-open']),'--port','0'],{stdio:['ignore','pipe','pipe'],env});
let stdout='',stderr='';
child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
const exited=new Promise(resolve=>child.once('exit',resolve));
try{
 const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(`Desktop did not start: ${stdout}\n${stderr}`)),15000);
  const check=()=>{const url=/Game running at: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout)?.[1];if(url){clearTimeout(timer);resolve(url);}};
  child.stdout.on('data',check);child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error(`Desktop exited (${code}): ${stderr}`));});check();
 });
 if(unavailableBrowsers){
  const until=Date.now()+10000;while(!stderr.includes('Could not open a browser.')&&Date.now()<until&&child.exitCode===null)await new Promise(resolve=>setTimeout(resolve,25));
  assert.match(stderr,/Could not open a browser\./,'failed browser launch reports a usable manual URL');
 }
 const response=await fetch(address,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/name="space-sim-desktop"/);assert.match(html,/<title>Spacelab/);
 const asset=/<script[^>]*src="([^"]+)"/.exec(html)?.[1];assert.ok(asset,'embedded application script');
 const script=await fetch(new URL(asset,address),{signal:AbortSignal.timeout(10000)});assert.equal(script.status,200);assert.ok((await script.arrayBuffer()).byteLength>1000);
 assert.equal((await fetch(new URL('missing-smoke-file',address))).status,404);
 assert.equal(child.exitCode,null,'desktop remains running while serving the game');
 console.log(`Packaged desktop ${unavailableBrowsers?'missing-browser fallback':'startup and embedded player'} verified (${process.platform}/${process.arch}).`);
}finally{
 child.kill();await Promise.race([exited,new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);timer.unref();})]);
}

}
await smoke();
if(process.platform!=='darwin')await smoke(true);
