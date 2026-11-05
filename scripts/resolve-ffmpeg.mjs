/** Locates ffmpeg/ffprobe without running anything: SAFECALL_FFMPEG_PATH, then PATH, then a per-user WinGet install. */
import {existsSync,readdirSync} from 'node:fs';
import path from 'node:path';

function onPath(exe){
  for(const dir of (process.env.PATH||'').split(path.delimiter)){if(dir&&existsSync(path.join(dir,exe)))return path.join(dir,exe);}
  return null;
}
function winget(exe){
  const root=process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft','WinGet','Packages');
  if(!root||!existsSync(root))return null;
  for(const pkg of readdirSync(root).filter(n=>n.startsWith('Gyan.FFmpeg'))){
    for(const build of readdirSync(path.join(root,pkg))){const p=path.join(root,pkg,build,'bin',exe);if(existsSync(p))return p;}
  }
  return null;
}
export function resolveFfmpeg(tool='ffmpeg'){
  const exe=process.platform==='win32'?`${tool}.exe`:tool;
  const configured=process.env.SAFECALL_FFMPEG_PATH;
  if(configured){const p=tool==='ffmpeg'?configured:path.join(path.dirname(configured),exe);return existsSync(p)?p:null;}
  return onPath(exe)||(process.platform==='win32'?winget(exe):null);
}
