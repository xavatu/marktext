import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: Mock; on: Mock }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: vi.fn(), on: vi.fn() }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({ debouncedSendBufferedState: vi.fn() }))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import bus from '@/bus'
import type { IFileState } from '@shared/types/files'

// #3688: a per-tab read-only mode. The engine-side contract (no input, no
// source reveal) is covered by muya's readOnly spec; these specs pin the
// desktop bookkeeping around it.

type Store = ReturnType<typeof useEditorStore>

const makeTab = (store: Store, overrides: Partial<IFileState> = {}): IFileState => {
  const tab = {
    id: 'tab-1',
    filename: 'a.md',
    pathname: '/x/a.md',
    markdown: 'hello',
    trimTrailingNewline: 0,
    isSaved: true,
    isReadOnly: true,
    lastSavedHistoryId: 0,
    scrollTop: 120,
    notifications: [],
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    history: { stack: [], index: -1 },
    ...overrides
  } as unknown as IFileState
  store.tabs = [tab]
  store.tabIdToIndex = { [tab.id]: 0 }
  store.currentFile = tab
  return tab
}

const ipcHandler = (channel: string) => {
  const call = (window.electron.ipcRenderer.on as Mock).mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No listener for ${channel}`)
  return call[1] as (e: unknown, payload?: unknown) => void
}

const diskChange = (type: 'add' | 'change' | 'unlink', markdown = '') => ({
  type,
  change: {
    pathname: '/x/a.md',
    data: {
      markdown,
      filename: 'a.md',
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 0,
      isMixedLineEndings: false
    }
  }
})

const sentChannels = () => (window.electron.ipcRenderer.send as Mock).mock.calls.map((c) => c[0])

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ;(window.electron.ipcRenderer.on as Mock).mockReset()
  ;(window.electron.ipcRenderer.send as Mock).mockReset()
})

describe('read-only tabs: opening files', () => {
  const open = (store: Store, markdownDocument: Record<string, unknown>) =>
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: {
        markdown: '# a',
        filename: 'a.md',
        encoding: { encoding: 'utf8', isBom: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 0,
        ...markdownDocument
      } as never
    })

  it('opens files editable by default', () => {
    const store = useEditorStore()

    open(store, { pathname: '/x/a.md' })

    expect(store.currentFile?.isReadOnly).toBe(false)
  })

  it('opens files read-only when the preference is on', () => {
    const store = useEditorStore()
    usePreferencesStore().openFilesInReadOnlyMode = true

    open(store, { pathname: '/x/a.md' })

    expect(store.currentFile?.isReadOnly).toBe(true)
  })

  it('keeps a buffer for a file that does not exist yet editable', () => {
    const store = useEditorStore()
    usePreferencesStore().openFilesInReadOnlyMode = true

    open(store, { pathname: '/x/new.md', isPendingCreation: true })

    expect(store.currentFile?.isReadOnly).toBeFalsy()
  })
})

describe('read-only tabs: unsaved state', () => {
  it('stays saved when the engine changes the content', () => {
    const store = useEditorStore()
    usePreferencesStore().autoSave = true
    const tab = makeTab(store)
    const autoSave = vi.spyOn(store, 'HANDLE_AUTO_SAVE').mockImplementation(() => {})

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'hello world' })

    expect(tab.markdown).toBe('hello world')
    expect(tab.isSaved).toBe(true)
    expect(autoSave).not.toHaveBeenCalled()
  })

  it('keeps edits made before the tab turned read-only unsaved', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isSaved: false })

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'hello again' })

    expect(tab.isSaved).toBe(false)
  })

  it('marks an editable tab unsaved as before', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isReadOnly: false })

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'hello again' })

    expect(tab.isSaved).toBe(false)
  })

  it('does not save a clean read-only tab', () => {
    const store = useEditorStore()
    makeTab(store)

    store.FILE_SAVE()

    expect(sentChannels()).not.toContain('mt::response-file-save')
  })

  it('still saves edits made before the tab turned read-only', () => {
    const store = useEditorStore()
    makeTab(store, { isSaved: false })

    store.FILE_SAVE()

    expect(sentChannels()).toContain('mt::response-file-save')
  })
})

describe('read-only tabs: changes on disk', () => {
  it('reloads without asking and stays read-only', () => {
    const store = useEditorStore()
    const tab = makeTab(store)
    const notify = vi.spyOn(store, 'pushTabNotification')
    store.LISTEN_FOR_FILE_CHANGE()

    ipcHandler('mt::update-file')(null, diskChange('change', 'hello world'))

    expect(notify).not.toHaveBeenCalled()
    expect(tab.markdown).toBe('hello world')
    expect(tab.isReadOnly).toBe(true)
    expect(tab.isSaved).toBe(true)
    expect(tab.scrollTop).toBe(120)
  })

  it('stays saved when the file is removed, then reloads it silently', () => {
    const store = useEditorStore()
    const tab = makeTab(store)
    store.LISTEN_FOR_FILE_CHANGE()
    const handler = ipcHandler('mt::update-file')

    handler(null, diskChange('unlink'))
    expect(tab.isSaved).toBe(true)
    expect(tab.notifications.map((n) => n.exclusiveType)).toEqual(['file_changed'])

    handler(null, diskChange('add', 'replaced'))
    expect(tab.markdown).toBe('replaced')
    expect(tab.notifications).toEqual([])
  })

  it('still marks a removed editable tab unsaved', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isReadOnly: false })
    store.LISTEN_FOR_FILE_CHANGE()

    ipcHandler('mt::update-file')(null, diskChange('unlink'))

    expect(tab.isSaved).toBe(false)
  })
})

describe('read-only tabs: toggling', () => {
  it('toggles the current tab from the menu', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isReadOnly: false })
    store.LISTEN_FOR_TOGGLE_READ_ONLY()
    const toggle = ipcHandler('mt::toggle-read-only-mode')

    toggle(null)
    expect(tab.isReadOnly).toBe(true)

    toggle(null)
    expect(tab.isReadOnly).toBe(false)
  })

  it('toggles from the command palette', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isReadOnly: false })
    store.LISTEN_FOR_TOGGLE_READ_ONLY()

    bus.emit('view:toggle-read-only-mode')

    expect(tab.isReadOnly).toBe(true)
  })

  it('commits a pending keystroke before the current tab turns read-only', () => {
    const store = useEditorStore()
    makeTab(store, { isReadOnly: false })
    const flush = vi.spyOn(store, 'flushActiveEditor')

    store.SET_READ_ONLY(null, true)

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved edits when the tab turns read-only', () => {
    const store = useEditorStore()
    const tab = makeTab(store, { isReadOnly: false, isSaved: false })

    store.SET_READ_ONLY(tab, true)

    expect(tab.isReadOnly).toBe(true)
    expect(tab.isSaved).toBe(false)
  })

  it('leaves the Paragraph and Format menus alone on a selection change', () => {
    const store = useEditorStore()
    makeTab(store)

    store.SELECTION_CHANGE({
      start: { key: 'a', offset: 0, block: { text: 'hello' } },
      end: { key: 'a', offset: 5 }
    } as never)

    expect(sentChannels()).not.toContain('mt::editor-selection-changed')
    expect(store.currentFile?.searchMatches?.value).toBe('hello')
  })
})

describe('read-only tabs: session restore', () => {
  it('keeps the flag across a buffered state round trip', () => {
    const store = useEditorStore()
    makeTab(store)

    const buffered = store.CREATE_BUFFERED_STATE()
    expect(buffered?.tabs[0]?.isReadOnly).toBe(true)

    setActivePinia(createPinia())
    const restored = useEditorStore()
    restored.RESTORE_BUFFERED_STATE(JSON.parse(JSON.stringify(buffered)))

    expect(restored.tabs[0]?.isReadOnly).toBe(true)
  })
})
