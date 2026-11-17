import { test, expect } from '@playwright/test';

// Runs without any Firebase config: proves the core flow works with no cloud and no
// on-device model (PHI structuring is blocked, local rules still structure vitals).
test('incident → offline capture → protocol → handoff → audit verify', async ({ page, context }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  // Let the service worker install so the app keeps working offline.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });

  await page.getByTestId('start-incident').click();
  await context.setOffline(true);
  await expect(page.getByTestId('net-status')).toHaveText(/Offline/);

  const input = page.getByTestId('entry-input');
  await input.fill('Hiker, about 50, fell 3 metres. Left forearm deformity and bleeding.');
  await input.press('Enter');
  await input.fill('Pulse 112, BP 130 over 85, sats 95');
  await page.getByTestId('entry-add').click();
  await page.getByRole('button', { name: 'Direct pressure' }).click();

  const timeline = page.getByTestId('timeline');
  await expect(timeline.locator('li')).toHaveCount(3);

  // Local, no-AI rules structured the vitals + intervention.
  await expect(page.getByTestId('list-vitals')).toContainText('HR 112');
  await expect(page.getByTestId('list-vitals')).toContainText('BP 130/85');
  await expect(page.getByTestId('list-interventions')).toContainText('Direct pressure');
  // No on-device model in CI → patient data is NOT sent anywhere; user is told why.
  await page.getByTestId('structure-now').click();
  await expect(page.getByTestId('privacy-blocked')).toBeVisible();

  // Confirm a draft vitals item.
  await page.getByTestId('list-vitals').getByRole('button', { name: 'Confirm' }).first().click();
  await expect(page.getByTestId('list-vitals')).toContainText('Confirmed');

  // Edit a scalar field.
  await page.getByRole('button', { name: 'Edit Mechanism of injury' }).click();
  await page.getByLabel('Mechanism of injury').fill('Fall ~3 m from ledge');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('field-mechanismOfInjury')).toContainText('Fall ~3 m from ledge');

  // Protocol walkthrough from the static library (served by the SW while offline).
  await page.getByTestId('tab-protocols').click();
  await page.getByTestId('protocol-severe-bleeding').click();
  await expect(page.getByTestId('protocol-walkthrough')).toContainText('Severe bleeding');
  await page.getByTestId('step-0').click();
  await expect(page.getByTestId('step-0')).toHaveText('✓');

  // Handoff.
  await page.getByTestId('tab-handoff').click();
  const mist = page.getByTestId('mist-preview');
  await expect(mist).toContainText('M — Mechanism of injury');
  await expect(mist).toContainText('Fall ~3 m from ledge');
  await expect(mist).toContainText('HR 112');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-both').click();
  expect((await download).suggestedFilename()).toMatch(/MIST\.pdf$/);
  await page.getByRole('tab', { name: 'OSHA 301 draft' }).click();
  await expect(page.getByTestId('osha-preview')).toContainText('DRAFT for employer review');

  // Audit chain verifies, then detects tampering.
  await page.getByTestId('tab-audit').click();
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('verify-result')).toContainText('Integrity verified');
  await page.getByRole('button', { name: 'Simulate tampering' }).click();
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('verify-result')).toContainText('FAILED');

  await context.setOffline(false);
});
