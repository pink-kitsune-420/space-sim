import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

export interface BrowserCandidate { readonly command:string;readonly args:readonly string[];readonly ownsWindow?:boolean }
/** External browser processes may hand their window to an existing instance and
 * exit immediately. Only our native GTK window owns the desktop server lifetime. */
export function browserCandidates(platform:NodeJS.Platform,env:NodeJS.ProcessEnv,url:string,fullscreen:boolean,customBrowser?:string):BrowserCandidate[]{
 const candidates:BrowserCandidate[]=customBrowser?[{command:customBrowser,args:[url]}]:[],
  appArgs=[`--app=${url}`,'--window-size=1280,800',...(fullscreen?['--start-fullscreen']:[])];
 if(platform==='win32'){
  const roots=[...new Set([env['ProgramFiles(x86)'],env.ProgramFiles,env.LOCALAPPDATA].filter((root):root is string=>!!root))];
  for(const vendor of ['Microsoft/Edge','Google/Chrome'])for(const root of roots)
   candidates.push({command:win32.join(root,...vendor.split('/'),'Application',vendor.startsWith('Microsoft')?'msedge.exe':'chrome.exe'),args:appArgs});
  candidates.push({command:'msedge',args:appArgs},{command:'chrome',args:appArgs},
   {command:env.ComSpec||'cmd.exe',args:['/d','/c','start','',url]});
 }else if(platform==='darwin'){
  for(const browser of ['Google Chrome','Microsoft Edge','Brave Browser'])candidates.push({command:`/Applications/${browser}.app/Contents/MacOS/${browser}`,args:appArgs});
  candidates.push({command:'open',args:[url]});
 }else{
  if(env.DISPLAY||env.WAYLAND_DISPLAY){
   const pyScript = [
        'import sys, gi',
        'gi.require_version("Gtk", "3.0")',
        'gi.require_version("WebKit2", "4.1")',
        'from gi.repository import Gtk, WebKit2',
        'win = Gtk.Window(title="Spacelab")',
        'win.set_default_size(1280, 800)',
        'win.set_position(Gtk.WindowPosition.CENTER)',
        fullscreen ? 'win.fullscreen()' : '',
        'win.connect("destroy", Gtk.main_quit)',
        'wv = WebKit2.WebView()',
        'wv.connect("notify::title", lambda view, _: win.set_title(view.get_title() or "Spacelab"))',
        's = wv.get_settings()',
        's.set_enable_webgl(True)',
        's.set_enable_accelerated_2d_canvas(True)',
        'wv.load_uri(sys.argv[1])',
        'win.add(wv)',
        'win.show_all()',
        'Gtk.main()',
      ].filter(Boolean).join('; ');
   candidates.push({command:'python3',args:['-c',pyScript,url],ownsWindow:true});
  }
  for(const command of ['google-chrome','google-chrome-stable','chromium','chromium-browser','brave-browser','microsoft-edge'])candidates.push({command,args:appArgs});
  candidates.push({command:'firefox',args:['--new-window',url]},{command:'xdg-open',args:[url]});
 }
 return candidates;
}

/** Wait for asynchronous spawn errors and immediate startup failures before
 * choosing a browser. A successful external handoff never closes the server. */
export async function launchCandidates(candidates:readonly BrowserCandidate[],onClose?:()=>void,spawnProcess=spawn,startupMilliseconds=500):Promise<boolean>{
 for(const candidate of candidates){
  const child=await new Promise<ChildProcess|undefined>(resolve=>{
   let process:ChildProcess;
   try{process=spawnProcess(candidate.command,[...candidate.args],{detached:!candidate.ownsWindow,stdio:'ignore'});}catch{resolve(undefined);return;}
   let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
   const finish=(success:boolean)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolve(success?process:undefined);};
   process.once('error',()=>finish(false));
   process.once('spawn',()=>{if(!settled)timer=setTimeout(()=>finish(true),startupMilliseconds);});
   process.once('exit',code=>finish(code===0&&!candidate.ownsWindow));
  });
  if(!child)continue;
  if(candidate.ownsWindow){if(onClose)child.once('exit',onClose);}else child.unref();
  return true;
 }
 return false;
}

export function launchAppBrowser(url:string,fullscreen:boolean,customBrowser?:string,onClose?:()=>void):Promise<boolean>{
 return launchCandidates(browserCandidates(process.platform,process.env,url,fullscreen,customBrowser),onClose);
}
