import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'fs'
import path from 'path'
import { clickMenuById, enterSourceMode, exitSourceMode, launchWithMarkdown } from './helpers'

// #3688 — read-only mode. A read-only tab takes no edits, shows a lock, never
// turns unsaved, and reloads silently when another editor rewrites the file
// (MarkText as a viewer beside Vim).

const MARKDOWN = 'Some **bold** text.\n'

const editorText = (page: Page) =>
  page.evaluate(() => document.querySelector('.editor-component')?.textContent ?? '')

const isDirty = (page: Page) =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

const hasLock = (page: Page) =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.read-only .read-only-icon'))

const menuItem = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    return item ? { checked: item.checked, enabled: item.enabled } : null
  }, id)

const typeAtEnd = async(page: Page, text: string) => {
  await page.locator('.mu-paragraph').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

test.describe('Issue #3688 — read-only mode', () => {
  test('the View menu toggles a tab between reading and editing', async() => {
    const { app, page } = await launchWithMarkdown(MARKDOWN)
    try {
      await clickMenuById(app, 'readOnlyModeMenuItem')
      await expect.poll(() => hasLock(page)).toBe(true)
      await expect.poll(() => menuItem(app, 'readOnlyModeMenuItem')).toMatchObject({ checked: true })
      expect(await menuItem(app, 'duplicateMenuItem')).toMatchObject({ enabled: false })

      const before = await editorText(page)
      await typeAtEnd(page, ' typed')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      expect(await editorText(page)).toBe(before)
      expect(await isDirty(page)).toBe(false)

      await clickMenuById(app, 'readOnlyModeMenuItem')
      await expect.poll(() => hasLock(page)).toBe(false)
      expect(await menuItem(app, 'duplicateMenuItem')).toMatchObject({ enabled: true })

      await typeAtEnd(page, ' typed')
      await expect.poll(() => editorText(page)).toContain('typed')
      await expect.poll(() => isDirty(page)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('a file opened read-only reloads silently when changed on disk', async() => {
    const { app, page, filePath } = await launchWithMarkdown(MARKDOWN, {
      preferences: { openFilesInReadOnlyMode: true }
    })
    try {
      await expect.poll(() => hasLock(page)).toBe(true)
      await page.waitForTimeout(500)

      fs.writeFileSync(filePath, 'from vim\n', 'utf-8')
      await expect.poll(() => editorText(page), { timeout: 8000 }).toContain('from vim')

      expect(await isDirty(page)).toBe(false)
      expect(await hasLock(page)).toBe(true)
      const banner = await page.evaluate(
        () => document.querySelector('.editor-notifications .msg')?.textContent ?? ''
      )
      expect(banner).toBe('')
    } finally {
      await app.close()
    }
  })

  test('a plain click follows a link', async() => {
    const { app, page, filePath } = await launchWithMarkdown('See [the other file](other.md).\n', {
      preferences: { openFilesInReadOnlyMode: true }
    })
    try {
      fs.writeFileSync(path.join(path.dirname(filePath), 'other.md'), '# Other\n', 'utf-8')

      await page.locator('.mu-link').first().click()

      await expect(page.locator('.editor-tabs li')).toHaveCount(2)
      await expect(page.locator('.editor-tabs li.active')).toContainText('other.md')
      // The linked file opens under the same preference.
      await expect(page.locator('.editor-tabs li.active.read-only')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('the source view of a read-only tab is read-only too', async() => {
    const { app, page } = await launchWithMarkdown(MARKDOWN, {
      preferences: { openFilesInReadOnlyMode: true }
    })
    try {
      await enterSourceMode(page, app)
      await page.locator('.source-code .CodeMirror').click()
      await page.keyboard.type('typed')

      const value = await page.evaluate(() => {
        const cm = document.querySelector('.source-code .CodeMirror') as
          | (Element & { CodeMirror?: { getValue(): string } })
          | null
        return cm?.CodeMirror?.getValue() ?? ''
      })
      expect(value).not.toContain('typed')
      await exitSourceMode(page, app)
      expect(await isDirty(page)).toBe(false)
    } finally {
      await app.close()
    }
  })
})
