/** A strict, offline-only 20-turn training fixture.
 * The entire script stays server-side; only already-audible turns are revealed.
 * This is a deterministic scenario replay, NOT transcription and NOT model inference.
 */
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const MAX_DIALOGUE_TURNS=20;
const ROLES=new Set(['caller','receiver','investigator','narrator']);
export function readReplayFixture(item,mediaDir){
 if(!item||item.replayAvailable!==true||!/^training-(?:bank|delivery)-20-en$/.test(item.id))throw new Error('REPLAY_NOT_ALLOWED');
 const raw=JSON.parse(readFileSync(path.join(mediaDir,`${item.id}.manifest.json`),'utf8'));
 const audio=readFileSync(path.join(mediaDir,item.filename));
 const sha=createHash('sha256').update(audio).digest('hex');
 if(raw.sha256!==sha||raw.id!==item.id||raw.kind!=='SYNTHETIC_TTS'||raw.turnLimit!==MAX_DIALOGUE_TURNS||raw.scenarioSource!=='CURATED_SEEDED_FIXTURE'||
  !Number.isInteger(raw.scenarioSeed)||raw.durationSeconds!==item.durationSeconds||!Array.isArray(raw.turns)||raw.turns.length!==MAX_DIALOGUE_TURNS)throw new Error('REPLAY_MANIFEST_INVALID');
 let previous=0;
 const turns=raw.turns.map((turn,i)=>{
  if(turn.index!==i||!ROLES.has(turn.role)||typeof turn.text!=='string'||turn.text.length<2||turn.text.length>400||
    !Number.isSafeInteger(turn.startMs)||!Number.isSafeInteger(turn.endMs)||turn.startMs<previous||turn.endMs<=turn.startMs||turn.endMs>Math.round(item.durationSeconds*1000))throw new Error('REPLAY_TURN_INVALID');
  previous=turn.endMs;
  return Object.freeze({index:i,role:turn.role,text:turn.text,startMs:turn.startMs,endMs:turn.endMs});
 });
 return Object.freeze({id:item.id,seed:raw.scenarioSeed,turns:Object.freeze(turns)});
}
