import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

// Headless Chromium hides scrollbars, and the scrollbar a wide table gains is
// part of what is under test.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/**
 * Table cells wrap between words and never split one. `overflow-wrap:
 * anywhere` on the cells (#5606) let the table squeeze a column below its
 * longest word, so headers and values broke mid-word ("Парам|етр"). A column
 * is now at least as wide as its longest word, and a table too wide for the
 * room it has scrolls sideways inside its figure (how much room a table has
 * is in `table-breakout.spec.ts`). Only a token longer than the whole column,
 * such as a long URL, still breaks.
 */

const COMPETING_COLUMNS = [
    '| Параметр | Описание | Значение по умолчанию | Ограничения |',
    '| --- | --- | --- | --- |',
    '| Технологический | Длинное описание параметра, которое занимает несколько строк и должно переноситься по словам. Ещё немного текста для объёма. | Неопределённый | Максимальная продолжительность |',
    '| Конфигурация | Короткое описание | 42 | Нет |',
    '',
].join('\n');

const TOO_WIDE = [
    '| Первый | Второй | Третий | Четвёртый | Пятый |',
    '| --- | --- | --- | --- | --- |',
    '| Технологический | Конфигурационный | Административный | Продолжительность | Неопределённость |',
    '',
].join('\n');

const PROSE = [
    '| Term | Meaning |',
    '| --- | --- |',
    `| word | ${'Plain prose that wraps across several lines of the cell. '.repeat(6)}|`,
    '',
].join('\n');

const LONG_URL = `https://example.com/${'segment/'.repeat(30)}end.html`;

async function load(page: Page, markdown: string): Promise<void> {
    await page.setViewportSize({ width: 820, height: 700 });
    await page.evaluate(md => window.muya!.setContent(md), markdown);
    await expect(page.locator(editor.table).first()).toBeVisible();
}

const figureOverflow = (page: Page) =>
    page.locator('figure.mu-table').first().evaluate(figure => ({
        scrollWidth: figure.scrollWidth,
        clientWidth: figure.clientWidth,
        scrollHeight: figure.scrollHeight,
        clientHeight: figure.clientHeight,
    }));

test.describe('table cell word wrap', () => {
    test('cells wrap between words, never inside one', async ({ page }) => {
        await load(page, COMPETING_COLUMNS);

        const brokenWords = await page.evaluate(() => {
            const broken: string[] = [];
            for (const cell of document.querySelectorAll('.mu-table-cell-content')) {
                const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
                        const range = document.createRange();
                        range.setStart(node, match.index);
                        range.setEnd(node, match.index + match[0].length);
                        const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
                        if (lines.size > 1)
                            broken.push(match[0]);
                    }
                }
            }
            return broken;
        });

        expect(brokenWords).toEqual([]);
    });

    test('a table wider than the text column scrolls inside its figure', async ({ page }) => {
        await load(page, TOO_WIDE);

        const { clientWidth, scrollHeight, clientHeight } = await figureOverflow(page);
        const tableWidth = await page.locator(editor.table).first()
            .evaluate(table => table.getBoundingClientRect().width);
        expect(tableWidth).toBeGreaterThan(clientWidth);
        expect(scrollHeight).toBe(clientHeight);
        // The page itself does not scroll sideways.
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth))
            .toBeLessThanOrEqual(820);
    });

    test('a table that fits the text column shows no scrollbar', async ({ page }) => {
        await load(page, PROSE);

        const { scrollWidth, clientWidth, scrollHeight, clientHeight } = await figureOverflow(page);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        expect(scrollHeight).toBe(clientHeight);
    });

    test('a token longer than the text column breaks at the column width', async ({ page }) => {
        await load(page, `| Link |\n| --- |\n| ${LONG_URL} |\n`);

        const { cell, column } = await page.evaluate(() => {
            const container = document.querySelector('.mu-container')!;
            const style = getComputedStyle(container);
            const column = container.clientWidth
                - Number.parseFloat(style.paddingLeft)
                - Number.parseFloat(style.paddingRight);
            const content = document.querySelectorAll('.mu-table-cell-content')[1];
            return { cell: content.getBoundingClientRect().width, column };
        });

        expect(cell).toBeLessThanOrEqual(column);
    });

    test('pressing the table scrollbar leaves the caret where it was', async ({ page }) => {
        await load(page, TOO_WIDE);
        const firstCell = page.locator(editor.tableCell).first();
        await firstCell.click();

        const figure = page.locator('figure.mu-table').first();
        const box = (await figure.boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + box.height - 2);
        await page.mouse.down();
        await page.mouse.up();

        const caretCell = await page.evaluate(() =>
            window.getSelection()?.anchorNode?.parentElement?.closest('th, td')?.textContent ?? null,
        );
        expect(caretCell).toBe('Первый');
    });
});
