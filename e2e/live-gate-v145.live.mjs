// v1.46: no original MP4 is selectable; real Meta gates still apply to synthetic TTS audio.
import {test,expect} from '@playwright/test';
const BASE='http://127.0.0.1:4178';

test('only generated WAV call cases are offered, never third-party recordings',async({page})=>{
  await page.goto(`${BASE}/live`);
  await expect(page.locator('#answer')).toBeEnabled();
  const items=await page.locator('#media-select option').evaluateAll(nodes=>nodes.map(n=>n.value));
  expect(items).toEqual(['synthetic-prosecutor-en','synthetic-delivery-en']);
  await expect(page.locator('#asr-provider')).toHaveText('Actual streamed ASR');
  for(const id of items){
    await page.selectOption('#media-select',id);
    await expect(page.locator('#media-kind')).toContainText('Synthetic speech');
    await expect(page.locator('#rights')).toBeEnabled();
    await expect(page.locator('#consent')).toBeEnabled();
  }
  const originals=await page.evaluate(async()=>Promise.all(['prosecutor','delivery'].map(async id=>(await fetch(`/media/${id}.mp4`)).status)));
  expect(originals).toEqual([404,404]);
  await page.click('#answer'); // No consents: audio plays locally only and cannot invoke the upstream runner.
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#video').currentTime),{timeout:15000}).toBeGreaterThan(1);
  await expect(page.locator('#asr-status')).toHaveText('Audio only');
});
