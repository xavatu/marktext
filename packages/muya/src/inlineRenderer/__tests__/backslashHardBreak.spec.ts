// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type { HardLineBreakToken, StrongEmToken, Token } from '../types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { generator, tokenizer } from '../lexer';

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function typesAndRaws(src: string): [Token['type'], string][] {
    return tokenizer(src).map(token => [token.type, token.raw]);
}

function firstContent(muya: Muya): Format {
    return muya.editor.scrollPage!.firstContentInDescendant() as Format;
}

describe('backslash hard line break (CommonMark §6.7)', () => {
    it('consumes the backslash as the break marker and leaves the space before it as text', () => {
        expect(typesAndRaws('foo \\\nbar')).toEqual([
            ['text', 'foo '],
            ['hard_line_break', '\\\n'],
            ['text', 'bar'],
        ]);
    });

    it('works without a space before the backslash', () => {
        const hard = tokenizer('foo\\\nbar').find(token => token.type === 'hard_line_break') as HardLineBreakToken;

        expect(hard.marker).toBe('\\');
        expect(hard.lineBreak).toBe('\n');
        expect(hard.range).toEqual({ start: 3, end: 5 });
    });

    it('leaves an escaped backslash literal, so the newline stays a soft break', () => {
        expect(typesAndRaws('foo\\\\\nbar').map(([type]) => type)).toEqual([
            'text',
            'backlash',
            'text',
            'soft_line_break',
            'text',
        ]);
    });

    it('reads the third backslash of a run as the break', () => {
        expect(typesAndRaws('foo\\\\\\\nbar').map(([type]) => type)).toContain('hard_line_break');
    });

    it('keeps a backslash that ends the block as text', () => {
        expect(typesAndRaws('foo \\')).toEqual([['text', 'foo \\']]);
    });

    it('is not a break inside inline code', () => {
        expect(typesAndRaws('`a \\\nb`').map(([type]) => type)).toEqual(['inline_code']);
    });

    it('is found inside emphasis', () => {
        const [strong] = tokenizer('**a\\\nb**') as StrongEmToken[];

        expect(strong.children.map(token => token.type)).toEqual(['text', 'hard_line_break', 'text']);
    });

    it('still reads two trailing spaces as a break', () => {
        const hard = tokenizer('foo  \nbar').find(token => token.type === 'hard_line_break') as HardLineBreakToken;

        expect(hard.marker).toBe('  ');
    });

    it('round-trips the source through the generator', () => {
        const src = 'foo \\\nbar\\\nbaz';

        expect(generator(tokenizer(src))).toBe(src);
    });
});

describe('backslash hard line break in the editor', () => {
    it('hides the backslash, keeps it in the text, and leaves code blocks alone', () => {
        const muya = bootMuya('foo \\\nbar\n\n```bash\nls \\\n  -la\n```\n');
        const paragraph = muya.domNode.querySelector('.mu-paragraph .mu-content')!;
        const marker = paragraph.querySelector('.mu-hard-line-break-space > .mu-hide.mu-remove')!;

        expect(marker.textContent).toBe('\\');
        expect(paragraph.textContent).toBe('foo \\\nbar');
        expect(muya.getMarkdown()).toBe('foo \\\nbar\n\n```bash\nls \\\n  -la\n```\n');
        expect(muya.domNode.querySelector('.mu-code-block .mu-hard-line-break')).toBeNull();
    });

    it('shows the backslash in gray while the cursor is on it', () => {
        const muya = bootMuya('foo \\\nbar\n');
        const block = firstContent(muya);

        block.setCursor(4, 4, true);

        const marker = muya.domNode.querySelector('.mu-hard-line-break-space > .mu-gray')!;
        expect(marker.textContent).toBe('\\');
    });

    it('renders again when the cursor reaches a backslash, but not two trailing spaces', () => {
        const atBreak = { start: { offset: 4 }, end: { offset: 4 } };
        const away = { start: { offset: 0 }, end: { offset: 0 } };
        const backslash = firstContent(bootMuya('foo \\\nbar\n'));
        const spaces = firstContent(bootMuya('foo  \nbar\n'));

        expect(backslash.checkNeedRender(atBreak)).toBe(true);
        expect(backslash.checkNeedRender(away)).toBe(false);
        expect(spaces.checkNeedRender(atBreak)).toBe(false);
    });
});
