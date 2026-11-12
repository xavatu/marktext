import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

// Headless Chromium hides scrollbars, and whether a table gains one is what
// is under test.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/**
 * A table whose longest words do not fit the text column grows past it, up to
 * one and a half columns, centered on the column; only a wider one scrolls
 * inside its figure. The breakout never reaches into the editor's side
 * gutters, so a narrow window scrolls the table sooner.
 */

// Five columns of long words: a little wider than the column, well under
// 1.5×.
const SLIGHTLY_WIDE = [
    '| Технологический | Конфигурация | Административный | Ограничение | Параметр |',
    '| --- | --- | --- | --- | --- |',
    '| Неопределённость | Продолжительность | Значение | Параметр | Конфигурационный |',
    '',
].join('\n');

// Nine such columns outgrow even 1.5×.
const TOO_WIDE = [
    '| Первый | Второй | Третий | Четвёртый | Пятый | Шестой | Седьмой | Восьмой | Девятый |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${['Технологический', 'Конфигурационный', 'Административный', 'Продолжительность', 'Неопределённость', 'Технологический', 'Конфигурационный', 'Административный', 'Продолжительность'].join(' | ')} |`,
    '',
].join('\n');

const NARROW = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

interface ILayout {
    column: { left: number; right: number };
    editor: { left: number; right: number };
    figure: { left: number; right: number; scrollWidth: number; clientWidth: number };
    table: { left: number; width: number };
}

async function layout(page: Page, markdown: string, width: number): Promise<ILayout> {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(md => window.muya!.setContent(md), markdown);
    await expect(page.locator(editor.table).first()).toBeVisible();

    return page.evaluate(() => {
        const container = document.querySelector<HTMLElement>('.mu-container')!;
        const style = getComputedStyle(container);
        const box = container.getBoundingClientRect();
        const editorBox = document.querySelector('.mu-editor')!.getBoundingClientRect();
        const figure = document.querySelector<HTMLElement>('figure.mu-table')!;
        const figureBox = figure.getBoundingClientRect();
        const tableBox = figure.querySelector('table')!.getBoundingClientRect();
        return {
            column: {
                left: box.left + Number.parseFloat(style.paddingLeft),
                right: box.right - Number.parseFloat(style.paddingRight),
            },
            editor: { left: editorBox.left, right: editorBox.right },
            figure: {
                left: figureBox.left,
                right: figureBox.right,
                scrollWidth: figure.scrollWidth,
                clientWidth: figure.clientWidth,
            },
            table: { left: tableBox.left, width: tableBox.width },
        };
    });
}

const width = (box: { left: number; right: number }) => box.right - box.left;
const center = (box: { left: number; right: number }) => (box.left + box.right) / 2;

test.describe('table breakout', () => {
    test('a table a little wider than the column spills into the margins without a scrollbar', async ({ page }) => {
        const { column, figure, table } = await layout(page, SLIGHTLY_WIDE, 1400);

        expect(table.width).toBeGreaterThan(width(column));
        expect(table.width).toBeLessThan(width(column) * 1.5);
        expect(figure.scrollWidth).toBeLessThanOrEqual(figure.clientWidth);
        expect(Math.abs(center(figure) - center(column))).toBeLessThanOrEqual(1);
    });

    test('a table wider than one and a half columns scrolls', async ({ page }) => {
        const { column, figure } = await layout(page, TOO_WIDE, 1400);

        expect(figure.scrollWidth).toBeGreaterThan(figure.clientWidth);
        expect(width(figure)).toBeCloseTo(width(column) * 1.5, 0);
        expect(Math.abs(center(figure) - center(column))).toBeLessThanOrEqual(1);
    });

    test('a table that fits stays on the column', async ({ page }) => {
        const { column, figure, table } = await layout(page, NARROW, 1400);

        expect(figure.left).toBeCloseTo(column.left, 0);
        expect(figure.right).toBeCloseTo(column.right, 0);
        expect(table.left).toBeCloseTo(column.left, 0);
    });

    test('in a narrow window the breakout stops at the editor gutters', async ({ page }) => {
        const { editor: editorBox, figure } = await layout(page, SLIGHTLY_WIDE, 900);

        expect(figure.left).toBeGreaterThanOrEqual(editorBox.left + 74 - 1);
        expect(figure.right).toBeLessThanOrEqual(editorBox.right - 50 + 1);
        expect(figure.scrollWidth).toBeGreaterThan(figure.clientWidth);
        // The page itself does not scroll sideways.
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(900);
    });

    test('right to left, the breakout is centered on the column too', async ({ page }) => {
        await page.evaluate(() => document.querySelector('.mu-editor')!.setAttribute('dir', 'rtl'));
        const { column, figure } = await layout(page, SLIGHTLY_WIDE, 1400);

        expect(width(figure)).toBeGreaterThan(width(column));
        expect(Math.abs(center(figure) - center(column))).toBeLessThanOrEqual(1);
    });
});
