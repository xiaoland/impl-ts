import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

test.describe('Accessibility Tests', () => {
  test('Sources page should not have accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:5199/sources')
    await page.waitForLoadState('networkidle')

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('Extensions page should not have accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:5199/extensions')
    await page.waitForLoadState('networkidle')

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('Settings page should not have accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:5199/settings')
    await page.waitForLoadState('networkidle')

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('Peers page should not have accessibility violations', async ({ page }) => {
    await page.goto('http://localhost:5199/peers')
    await page.waitForLoadState('networkidle')

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })
})
