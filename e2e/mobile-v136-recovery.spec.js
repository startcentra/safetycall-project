/** Runnable only on an unrestricted Playwright host with npm dependencies installed.
 * A blocked or absent browser is NOT a pass; no OS interception is tested here.
 */
import {test,expect} from '@playwright/test';
async function ready(page){
 await page.goto('/mobile');await expect(page.locator('#mobile-skeleton')).toBeHidden();
 await expect(page.locator('#home-case')).not.toHaveText('—');
}
test('v136 contextual false-positive review is explicit, temporary, revocable and never follows URL',async({page})=>{
 await ready(page);
 await page.locator('#m-scenario').selectOption('otp');
 await page.locator('button[data-go="messages"]').first().click();
 await page.locator('#msg-fixture').selectOption('unknown-link');await page.locator('#msg-consent').check();
 await page.locator('#msg-inject').click();
 await page.locator('button[data-go="phone"]').first().click();
 await page.locator('#btn-answer').click();
 for(let i=0;i<3;i++)await page.locator('#btn-next-utter').click();
 await page.locator('button[data-go="messages"]').first().click();
 await expect(page.locator('button[data-message-attempt]')).toBeDisabled();
 await page.locator('button[data-message-review]').click();
 await expect(page.locator('button[data-message-attempt]')).toBeDisabled();
 await page.locator('#msg-review-consent').check();await page.locator('button[data-message-review]').click();
 await expect(page.locator('button[data-message-attempt]')).toBeEnabled();
 await expect(page.locator('button[data-message-revoke]')).toBeVisible();
 await page.locator('button[data-message-revoke]').click();
 await expect(page.locator('button[data-message-attempt]')).toBeDisabled();
 await expect(page.locator('.message-entry a')).toHaveCount(0);
 await expect(page).toHaveURL(/\/mobile$/);
});
test('v136 encrypted user capsule is opt-in and can restore self-report after new mock case',async({page})=>{
 await ready(page);
 await page.locator('button[data-go="phone"]').first().click();await page.locator('#btn-answer').click();
 await page.locator('#btn-endcall').click();
 await page.locator('select[data-postcall-question="codeShared"]').selectOption('YES');
 await page.locator('#postcall-passphrase').fill('local demo passphrase 20 characters');
 await page.locator('#postcall-vault-consent').check();await page.locator('#postcall-export').click();
 await expect(page.locator('#postcall-capsule')).not.toBeEmpty();
 const capsule=await page.locator('#postcall-capsule').inputValue();
 await page.locator('#btn-newcase').click(); // new, isolated case
 await page.locator('button[data-go="phone"]').first().click();await page.locator('#btn-answer').click();
 await page.locator('#btn-endcall').click();
 await page.locator('#postcall-passphrase').fill('local demo passphrase 20 characters');
 await page.locator('#postcall-capsule').fill(capsule);
 await page.locator('#postcall-vault-consent').check();await page.locator('#postcall-import').click();
 await expect(page.locator('select[data-postcall-question="codeShared"]')).toHaveValue('YES');
 await page.locator('#postcall-delete-confirm').check();await page.locator('#postcall-delete').click();
 await expect(page.locator('select[data-postcall-question="codeShared"]')).toHaveValue('');
});
