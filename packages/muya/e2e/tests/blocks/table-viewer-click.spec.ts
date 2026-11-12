import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

/**
 * A table opens in the host's viewer the way an image does: a Ctrl/⌘-click
 * while editing, a plain click while reading. The viewer gets a static copy
 * that reads like the table without a caret in it.
 */

const TABLE = [
    '| Name | Notes |',
    '| --- | --- |',
    '| **bold** | see [the site](https://example.com) |',
    '',
].join('\n');

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

interface IOpen {
    html: string;
    editable: number;
    ids: number;
    width: string;
    tableWidth: number;
}

type TViewerLog = { __tableOpens: IOpen[]; __linkClicks: number };

async function load(page: Page, readOnly = false): Promise<void> {
    await page.evaluate(({ markdown, readOnly }) => {
        window.__e2e!.rebuildMuya({ markdown, readOnly });
        const log = window as unknown as TViewerLog;
        log.__tableOpens = [];
        log.__linkClicks = 0;
        window.muya!.on('preview-table', ({ preview }: { preview: HTMLElement }) => {
            const table = preview.querySelector('table')!;
            log.__tableOpens.push({
                html: preview.innerHTML,
                editable: preview.querySelectorAll('[contenteditable]').length,
                ids: preview.querySelectorAll('[id]').length,
                width: table.style.width,
                tableWidth: document.querySelector('.mu-table-inner')!.getBoundingClientRect().width,
            });
        });
        window.muya!.on('format-click', ({ formatType }: { formatType: string }) => {
            if (formatType === 'link')
                log.__linkClicks++;
        });
    }, { markdown: TABLE, readOnly });
    await expect(page.locator(editor.table).first()).toBeVisible();
}

const opens = (page: Page) =>
    page.evaluate(() => (window as unknown as TViewerLog).__tableOpens);

const cell = (page: Page, index: number) => page.locator(editor.tableCell).nth(index);

test.describe('table viewer on click', () => {
    test('a modifier-click opens a static copy of the table', async ({ page }) => {
        await load(page);
        // The caret in the bold cell reveals its markers there.
        await cell(page, 2).click();
        await expect(cell(page, 2).locator('.mu-gray').first()).toBeAttached();

        await cell(page, 2).click({ modifiers: [MODIFIER] });

        const [open] = await opens(page);
        expect(open).toBeDefined();
        // The copy hides them, as the document does away from the caret.
        expect(open.html).not.toContain('mu-gray');
        expect(open.html).toContain('<strong');
        expect(open.editable).toBe(0);
        expect(open.ids).toBe(0);
        expect(Number.parseFloat(open.width)).toBeGreaterThanOrEqual(open.tableWidth);
    });

    test('a plain click while editing only places the caret', async ({ page }) => {
        await load(page);

        await cell(page, 0).click();

        expect(await opens(page)).toEqual([]);
    });

    test('a plain click opens the viewer in read-only mode', async ({ page }) => {
        await load(page, true);
        await expect(page.locator('.mu-table-inner')).toHaveCSS('cursor', 'zoom-in');

        await cell(page, 0).click();

        expect(await opens(page)).toHaveLength(1);
    });

    test('a click on a link in a cell follows the link instead', async ({ page }) => {
        await load(page, true);

        await page.locator(`${editor.tableCell} .mu-link`).first().click();

        expect(await opens(page)).toEqual([]);
        expect(await page.evaluate(() => (window as unknown as TViewerLog).__linkClicks)).toBe(1);
    });

    test('a drag that selects text in a cell does not open the viewer', async ({ page }) => {
        await load(page, true);
        const box = (await cell(page, 1).boundingBox())!;

        await page.mouse.move(box.x + 14, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 14, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();

        expect(await opens(page)).toEqual([]);
    });
});
