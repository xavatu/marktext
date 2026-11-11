import { describe, it, expect, vi } from 'vitest'
import { type Menu, type MenuItemConstructorOptions } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { on: () => {}, emit: () => {}, handle: () => {} },
  BrowserWindow: { fromWebContents: () => undefined, getAllWindows: () => [] }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import viewTemplate from 'main_renderer/menu/templates/view'
import editTemplate from 'main_renderer/menu/templates/edit'
import { viewLayoutChanged } from 'main_renderer/menu/actions/view'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'

// #3688: View → Read-Only Mode reflects the active tab, and the editing
// commands are greyed out while it is on.

interface IFakeItem {
  id: string
  enabled: boolean
  checked: boolean
  submenu?: { items: IFakeItem[] }
}

const item = (id: string, submenu?: string[]): IFakeItem => ({
  id,
  enabled: true,
  checked: false,
  submenu: submenu ? { items: submenu.map((child) => item(child)) } : undefined
})

const EDITING_IDS = [
  'pasteAsPlainTextEditMenuItem',
  'duplicateMenuItem',
  'createParagraphMenuItem',
  'deleteParagraphMenuItem',
  'replaceMenuItem',
  'screenshot'
]

const makeMenu = () => {
  const items = [
    item('readOnlyModeMenuItem'),
    ...EDITING_IDS.map((id) => item(id)),
    item('paragraphMenuEntry', ['heading1MenuItem', 'tableMenuItem']),
    item('formatMenuItem', ['strongMenuItem', 'imageMenuItem'])
  ]
  const byId = new Map(items.map((i) => [i.id, i]))
  const menu = { getMenuItemById: (id: string) => byId.get(id) ?? null } as unknown as Menu
  return { menu, byId }
}

const submenuIds = (template: MenuItemConstructorOptions): string[] =>
  (template.submenu as MenuItemConstructorOptions[]).map((i) => i.id ?? '')

describe('read-only mode menu', () => {
  it('adds a checkbox next to the other view modes', () => {
    const template = viewTemplate({ getAccelerator: () => null } as never)
    const ids = submenuIds(template)

    expect(ids.indexOf('readOnlyModeMenuItem')).toBe(ids.indexOf('focusModeMenuItem') + 1)
    const entry = (template.submenu as MenuItemConstructorOptions[]).find(
      (i) => i.id === 'readOnlyModeMenuItem'
    )
    expect(entry?.type).toBe('checkbox')
  })

  it('ships without a default shortcut on every platform', () => {
    for (const map of [keybindingsWindows, keybindingsLinux, keybindingsDarwin]) {
      expect(map.get('view.read-only-mode')).toBe('')
    }
  })

  it('names every editing Edit item it disables', () => {
    const ids = submenuIds(editTemplate({ getAccelerator: () => null } as never))
    for (const id of EDITING_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('checks the item and disables the editing commands while read-only', () => {
    const { menu, byId } = makeMenu()

    viewLayoutChanged(menu, { readOnly: true })

    expect(byId.get('readOnlyModeMenuItem')?.checked).toBe(true)
    for (const id of EDITING_IDS) {
      expect(byId.get(id)?.enabled).toBe(false)
    }
    for (const id of ['paragraphMenuEntry', 'formatMenuItem']) {
      expect(byId.get(id)?.submenu?.items.every((i) => !i.enabled)).toBe(true)
    }
  })

  it('re-enables the Edit commands and leaves Paragraph and Format to the renderer', () => {
    const { menu, byId } = makeMenu()
    viewLayoutChanged(menu, { readOnly: true })

    viewLayoutChanged(menu, { readOnly: false })

    expect(byId.get('readOnlyModeMenuItem')?.checked).toBe(false)
    for (const id of EDITING_IDS) {
      expect(byId.get(id)?.enabled).toBe(true)
    }
    expect(byId.get('formatMenuItem')?.submenu?.items.every((i) => !i.enabled)).toBe(true)
  })
})
