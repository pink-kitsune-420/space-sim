import { ChildProcess, type spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { browserCandidates, launchCandidates } from '../../apps/desktop/src/browser-launch';

const url='http://127.0.0.1:6465/';
function spawner(action:(command:string,child:ChildProcess)=>void){
 const children:ChildProcess[]=[];
 const start=vi.fn((command:string)=>{
  const child=new ChildProcess();vi.spyOn(child,'unref').mockImplementation(()=>{});children.push(child);
  queueMicrotask(()=>action(command,child));return child;
 });
 return {children,start,spawn:start as unknown as typeof spawn};
}
it('discovers Windows app browsers outside PATH and retains a default-browser fallback',()=>{
 const candidates=browserCandidates('win32',{'ProgramFiles(x86)':'C:\\Program Files (x86)',ProgramFiles:'C:\\Program Files',LOCALAPPDATA:'C:\\Users\\Pilot\\AppData\\Local',ComSpec:'C:\\Windows\\System32\\cmd.exe'},url,true);
 expect(candidates[0]).toEqual({command:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',args:[`--app=${url}`,'--window-size=1280,800','--start-fullscreen']});
 expect(candidates.some(c=>c.command==='C:\\Users\\Pilot\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')).toBe(true);
 expect(candidates.at(-1)).toEqual({command:'C:\\Windows\\System32\\cmd.exe',args:['/d','/c','start','',url]});
});
it('advances after asynchronous ENOENT and keeps the server alive when a browser hands off to an existing instance',async()=>{
 const close=vi.fn(),f=spawner((command,child)=>{
  if(command==='missing'){child.emit('error',Object.assign(new Error('not found'),{code:'ENOENT'}));child.emit('close',-2);}
  else {child.emit('spawn');child.emit('exit',0);child.emit('close',0);}
 });
 expect(await launchCandidates([{command:'missing',args:[]},{command:'browser',args:[url]}],close,f.spawn,1)).toBe(true);
 expect(f.start.mock.calls.map(call=>call[0])).toEqual(['missing','browser']);expect(close).not.toHaveBeenCalled();expect(f.children[1]!.unref).toHaveBeenCalled();
});
it('tries the next browser after a process starts but immediately fails',async()=>{
 const f=spawner((command,child)=>{child.emit('spawn');if(command==='broken')child.emit('exit',1);else child.emit('exit',0);});
 expect(await launchCandidates([{command:'broken',args:[]},{command:'working',args:[]}],undefined,f.spawn,1)).toBe(true);
 expect(f.start.mock.calls.map(call=>call[0])).toEqual(['broken','working']);
});
it('reports complete launch failure without terminating the game server',async()=>{
 const close=vi.fn(),f=spawner((_command,child)=>{child.emit('error',new Error('not found'));child.emit('close',-2);});
 expect(await launchCandidates([{command:'missing',args:[]},{command:'also-missing',args:[]}],close,f.spawn,1)).toBe(false);
 expect(close).not.toHaveBeenCalled();
});
it('handles a synchronous launch error before trying the next candidate',async()=>{
 const f=spawner((_command,child)=>{child.emit('spawn');child.emit('exit',0);});
 f.start.mockImplementationOnce(()=>{throw Error('invalid command');});
 expect(await launchCandidates([{command:'bad',args:[]},{command:'browser',args:[]}],undefined,f.spawn,1)).toBe(true);
 expect(f.start).toHaveBeenCalledTimes(2);
});
it.each([false,true])('only a confirmed owned native window ends the server on exit (owned=%s)',async ownsWindow=>{
 const close=vi.fn(),f=spawner((_command,child)=>child.emit('spawn'));
 expect(await launchCandidates([{command:'window',args:[],ownsWindow}],close,f.spawn,1)).toBe(true);
 f.children[0]!.emit('exit',0);expect(close).toHaveBeenCalledTimes(ownsWindow?1:0);
});
it('retains custom-browser and macOS/Linux fallback behavior without assuming a GUI process exists',()=>{
 expect(browserCandidates('darwin',{},url,false,'/custom/browser')[0]).toEqual({command:'/custom/browser',args:[url]});
 expect(browserCandidates('darwin',{},url,false).at(-1)).toEqual({command:'open',args:[url]});
 const graphical=browserCandidates('linux',{DISPLAY:':1'},url,false),headless=browserCandidates('linux',{},url,false);
 expect(graphical[0]?.ownsWindow).toBe(true);expect(headless.some(candidate=>candidate.ownsWindow)).toBe(false);
 expect(headless.at(-1)).toEqual({command:'xdg-open',args:[url]});
});
