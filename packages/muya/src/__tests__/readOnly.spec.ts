// @vitest-environment happy-dom

import type { IMuyaOptions } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../config';
import { Muya } from '../muya';
import { useMuyaHarness } from './muyaHarness';

// Coverage for `readOnly` / `Muya#setReadOnly` (#3688). The DOM-level contract
// (no editing host anywhere, no source reveal) is checked here; the real
// browser behaviour of typing into the page is covered by the e2e suite.

useMuyaHarness();

const booted: Muya[] = [];

function boot(markdown: string, options: Partial<IMuyaOptions> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, ...options });
    muya.init();
    booted.push(muya);
    return muya;
}

function editableLeaves(muya: Muya): string[] {
    return Array.from(
        muya.domNode.querySelectorAll<HTMLElement>('.mu-content'),
        leaf => leaf.getAttribute('contenteditable') ?? '',
    );
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    // happy-dom's MouseEvent omits the `x` accessor that `isMouseEvent` reads.
    Object.defineProperty(event, 'x', { value: init.clientX ?? 0, configurable: true });
    target.dispatchEvent(event);
    return event;
}

function markdownOf(muya: Muya): string {
    muya.flush();
    return muya.getMarkdown();
}

describe('muya read-only mode', () => {
    it('is off by default: the root and every leaf are editable', () => {
        const muya = boot('# heading\n\nparagraph\n');

        expect(muya.options.readOnly).toBe(false);
        expect(muya.domNode.getAttribute('contenteditable')).toBe('true');
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_READ_ONLY)).toBe(false);
        expect(editableLeaves(muya)).toEqual(['true', 'true']);
    });

    it('applies at construction when readOnly: true', () => {
        const muya = boot('# heading\n\nparagraph\n', { readOnly: true });

        expect(muya.domNode.getAttribute('contenteditable')).toBe('false');
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_READ_ONLY)).toBe(true);
        expect(editableLeaves(muya)).toEqual(['false', 'false']);
    });

    it('keeps the root focusable while it is not an editing host', () => {
        const muya = boot('paragraph\n', { readOnly: true });

        expect(muya.domNode.getAttribute('tabindex')).toBe('0');
        muya.focus();
        expect(muya.hasFocus()).toBe(true);
        expect(muya.editor.activeContentBlock).toBeNull();
    });

    it('setReadOnly toggles the root and the existing leaves', () => {
        const muya = boot('one\n\ntwo\n');

        muya.setReadOnly(true);
        expect(muya.options.readOnly).toBe(true);
        expect(muya.domNode.getAttribute('contenteditable')).toBe('false');
        expect(editableLeaves(muya)).toEqual(['false', 'false']);

        muya.setReadOnly(false);
        expect(muya.options.readOnly).toBe(false);
        expect(muya.domNode.getAttribute('contenteditable')).toBe('true');
        expect(muya.domNode.classList.contains(CLASS_NAMES.MU_READ_ONLY)).toBe(false);
        expect(editableLeaves(muya)).toEqual(['true', 'true']);
    });

    it('setOptions({ readOnly }) goes through setReadOnly', () => {
        const muya = boot('one\n');

        muya.setOptions({ readOnly: true });
        expect(muya.domNode.getAttribute('contenteditable')).toBe('false');
        expect(editableLeaves(muya)).toEqual(['false']);
    });

    it('builds non-editable leaves for content loaded while read-only', () => {
        const muya = boot('one\n', { readOnly: true });

        muya.setContent('# new\n\n- item\n\nlast\n');
        expect(markdownOf(muya)).toBe('# new\n\n- item\n\nlast\n');
        expect(editableLeaves(muya).every(value => value === 'false')).toBe(true);
    });

    it('drops the caret block on entry so it renders without its markers', () => {
        const muya = boot('some **bold** text\n');
        const leaf = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(7, 7, true);
        expect(muya.editor.activeContentBlock).toBe(block);
        expect(leaf.querySelectorAll(`.${CLASS_NAMES.MU_GRAY}`).length).toBeGreaterThan(0);

        muya.setReadOnly(true);
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(leaf.querySelectorAll(`.${CLASS_NAMES.MU_GRAY}`)).toHaveLength(0);
    });

    it('never reveals markers for a caret placed while read-only', () => {
        const muya = boot('some **bold** text\n', { readOnly: true });
        const leaf = muya.domNode.querySelector<HTMLElement>('.mu-paragraph-content')!;
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;

        block.setCursor(7, 7, true);
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(leaf.querySelectorAll(`.${CLASS_NAMES.MU_GRAY}`)).toHaveLength(0);
    });

    it('turns the editing commands into no-ops', () => {
        const markdown = '# heading\n\nfirst paragraph\n\nsecond paragraph\n';
        const muya = boot(markdown);
        muya.editor.scrollPage!.lastContentInDescendant()!.setCursor(0, 6, true);
        muya.setReadOnly(true);

        muya.format('strong');
        muya.updateParagraph('heading 1');
        muya.insertParagraph('after', 'new');
        muya.deleteParagraph();
        muya.duplicate();
        muya.createTable({ rows: 2, columns: 2 });
        muya.insertImage({ src: 'a.png' });
        muya.search('paragraph');
        muya.replace('changed', { isSingle: false, isRegexp: false });

        expect(markdownOf(muya)).toBe(markdown);
    });

    it('blocks undo and redo', () => {
        const muya = boot('one\n');
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3, true);
        muya.insertParagraph('after', 'two');
        muya.flush();
        const edited = markdownOf(muya);
        expect(edited).toContain('two');

        muya.setReadOnly(true);
        muya.undo();
        expect(markdownOf(muya)).toBe(edited);

        muya.setReadOnly(false);
        muya.undo();
        expect(markdownOf(muya)).toBe('one\n');
    });

    it('ignores paste', async () => {
        const muya = boot('one\n');
        muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(3, 3, true);
        muya.setReadOnly(true);
        muya.focus();
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
            value: {
                getData: (type: string) => (type === 'text/plain' ? ' pasted' : ''),
                files: [],
                items: [],
                types: ['text/plain'],
            },
        });

        document.dispatchEvent(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(event.defaultPrevented).toBe(true);
        expect(markdownOf(muya)).toBe('one\n');
    });

    it('does not append a paragraph when the blank area below is clicked', () => {
        const muya = boot('# heading\n', { readOnly: true });
        const scrollPageDom = muya.editor.scrollPage!.domNode!;

        click(scrollPageDom, { clientY: 10_000 });

        expect(markdownOf(muya)).toBe('# heading\n');
    });

    it('keeps task checkboxes as they are', () => {
        const muya = boot('- [ ] task\n', { readOnly: true });
        const checkbox = muya.domNode.querySelector<HTMLElement>('.mu-task-list-checkbox')!;

        const event = click(checkbox);

        expect(event.defaultPrevented).toBe(true);
        expect(markdownOf(muya)).toBe('- [ ] task\n');
    });

    it('follows a link on a plain click', () => {
        const muya = boot('[hello](https://example.com)\n', { readOnly: true });
        const link = muya.domNode.querySelector<HTMLElement>(`span.${CLASS_NAMES.MU_LINK}`)!;
        const handler = vi.fn();
        muya.on('format-click', handler);

        click(link);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].formatType).toBe('link');
        expect(handler.mock.calls[0][0].data.href).toBe('https://example.com');
    });

    it('still needs the modifier to follow a link while editing', () => {
        const muya = boot('[hello](https://example.com)\n');
        const link = muya.domNode.querySelector<HTMLElement>(`span.${CLASS_NAMES.MU_LINK}`)!;
        const handler = vi.fn();
        muya.on('format-click', handler);

        click(link);

        expect(handler).not.toHaveBeenCalled();
    });

    it('opens an image on a plain click without selecting it', () => {
        const muya = boot('![alt](https://example.com/a.png)\n', { readOnly: true });
        const wrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/a.png');
        wrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)?.replaceChildren(img);
        const formatClick = vi.fn();
        const toolbar = vi.fn();
        muya.on('format-click', formatClick);
        muya.on('muya-image-toolbar', toolbar);

        click(img);

        expect(formatClick).toHaveBeenCalledTimes(1);
        expect(formatClick.mock.calls[0][0]).toMatchObject({
            formatType: 'image',
            data: 'https://example.com/a.png',
        });
        expect(toolbar).not.toHaveBeenCalled();
        expect(muya.editor.selection.image).toBeNull();
    });
});

describe('muya read-only reading block', () => {
    function topLevelDoms(muya: Muya): HTMLElement[] {
        return Array.from(muya.editor.scrollPage!.domNode!.children) as HTMLElement[];
    }

    function readingDoms(muya: Muya): Element[] {
        return Array.from(muya.domNode.querySelectorAll(`.${CLASS_NAMES.MU_READING}`));
    }

    function placeDomCaret(leaf: Element, offset: number) {
        const text = leaf.querySelector('.mu-plain-text')?.firstChild ?? leaf.firstChild!;
        document.getSelection()!.collapse(text, offset);
    }

    it('keeps the caret block lit on entry and clears it on exit', () => {
        const muya = boot('one\n\ntwo\n');
        const second = muya.editor.scrollPage!.lastContentInDescendant()!;
        second.setCursor(1, 1, true);

        muya.setReadOnly(true);
        expect(muya.editor.readingBlock).toBe(second.outMostBlock);
        expect(readingDoms(muya)).toEqual([topLevelDoms(muya)[1]]);

        muya.setReadOnly(false);
        expect(muya.editor.readingBlock).toBeNull();
        expect(readingDoms(muya)).toEqual([]);
    });

    it('follows a caret placed while read-only to its top-level block', () => {
        const muya = boot('one\n\n- item\n- other\n', { readOnly: true });
        const item = muya.editor.scrollPage!.lastContentInDescendant()!;

        item.setCursor(0, 0, true);

        expect(muya.editor.activeContentBlock).toBeNull();
        expect(muya.editor.readingBlock?.blockName).toBe('bullet-list');
        expect(readingDoms(muya)).toEqual([topLevelDoms(muya)[1]]);
    });

    it('lights the first block when focused without a caret', () => {
        const muya = boot('one\n\ntwo\n', { readOnly: true });

        muya.focus();

        expect(muya.hasFocus()).toBe(true);
        expect(readingDoms(muya)).toEqual([topLevelDoms(muya)[0]]);
    });

    it('moves the hidden caret to a clicked block, where editing resumes', () => {
        const muya = boot('one\n\ntwo\n', { readOnly: true });
        muya.focus();
        const second = muya.editor.scrollPage!.lastContentInDescendant()!;

        placeDomCaret(second.domNode!, 2);
        click(second.domNode!);
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(readingDoms(muya)).toEqual([topLevelDoms(muya)[1]]);

        muya.setReadOnly(false);
        expect(muya.editor.activeContentBlock).toBe(second);
        expect(muya.editor.selection.anchor?.offset).toBe(2);
    });

    it('lights a clicked image block without moving the caret', () => {
        const muya = boot('one\n\n![alt](https://example.com/a.png)\n', { readOnly: true });
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(1, 1, true);
        const wrapper = muya.domNode.querySelector<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`)!;
        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/a.png');
        wrapper.querySelector(`.${CLASS_NAMES.MU_IMAGE_CONTAINER}`)?.replaceChildren(img);

        click(img);

        expect(readingDoms(muya)).toEqual([topLevelDoms(muya)[1]]);
        expect(muya.editor.selection.anchorBlock).toBe(first);
    });
});
