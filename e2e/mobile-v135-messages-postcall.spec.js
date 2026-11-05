/** Browser E2E contract; environment blocked at navigation in local runner.
 * Must NOT be presented as PASS without a real Chromium run on a permitted host.
 */
import {test,expect} from '@playwright/test';

async function ready(page){
 await page.goto('/mobile');
 await expect(page.locator('#mobile-skeleton')).toBeHidden();
 await expect(page.locator('#home-case')).not.toHaveText('—');
}
test('v135 mock inbox quarantines scam links and records blocked API decision',async({page})=>{
 await ready(page);
 await page.locator('button[data-go="messages"]').first().click();
 await expect(page.locator('#view-messages')).toBeVisible();
 await page.locator('#msg-fixture').selectOption('parcel-bait');
 await page.locator('#msg-consent').check();
 await page.locator('#msg-inject').click();
 await expect(page.locator('.message-entry')).toHaveCount(1);
 await expect(page.locator('button[data-message-attempt]')).toBeDisabled();
 await page.locator('button[data-message-reason]').click();
 await expect(page.locator('#msg-status')).toContainText('서버 차단 확인');
 await expect(page.locator('.message-entry a')).toHaveCount(0);
 await expect(page).toHaveURL(/\/mobile$/);
});
test('v135 legitimate parcel is review-only, no external browser navigation',async({page})=>{
 await ready(page);
 await page.locator('button[data-go="messages"]').first().click();
 await page.locator('#msg-fixture').selectOption('parcel-normal');
 await page.locator('#msg-consent').check();
 await page.locator('#msg-inject').click();
 await expect(page.locator('.message-entry')).toContainText('검토만');
 await page.locator('button[data-message-attempt]').click();
 await expect(page.locator('#msg-status')).toContainText('외부');
 await expect(page).toHaveURL(/\/mobile$/);
});
test('v135 call end enters post-call flow, self-report modifies actions without real transfer',async({page})=>{
 await ready(page);
 await page.locator('#m-scenario').selectOption('otp');
 await page.locator('button[data-go="phone"]').first().click();
 await page.locator('#btn-answer').click();
 for(let i=0;i<4;i++)await page.locator('#btn-next-utter').click();
 await page.locator('#btn-endcall').click();
 await expect(page.locator('#postcall-status')).toContainText('같은 Case ID');
 await page.locator('select[data-postcall-question="codeShared"]').selectOption('YES');
 await expect(page.locator('select[data-postcall-task="CONTACT_FINANCIAL_PROVIDER"]')).toBeVisible();
 await page.locator('select[data-postcall-task="CONTACT_FINANCIAL_PROVIDER"]').selectOption('DONE');
 await expect(page.locator('select[data-postcall-task="CONTACT_FINANCIAL_PROVIDER"]')).toHaveValue('DONE');
 await expect(page.locator('#bank-status')).not.toContainText('실제');
});
