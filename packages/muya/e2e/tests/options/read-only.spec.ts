import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { metaKey } from '../helpers/keyboard';
import { editor, floats } from '../helpers/selectors';

/**
 * `readOnly` option + `Muya#setReadOnly` (#3688).
 *
 * In a real browser no keystroke, paste or click may change a read-only
 * document, and a click must not reveal the markdown source behind the
 * rendering. Selection, copy and links keep working.
 */

const MARKDOWN = [
    'Some **bold** and <mark>marked</mark> text with a [link](https://example.com).',
    '',
    '- [ ] open task',
    '',
].join('\n');

async function bootReadOnly(page: Page): Promise<void> {
    await page.evaluate((markdown) => {
        window.__e2e!.rebuildMuya({ readOnly: true, markdown });
    }, MARKDOWN);
}

test.describe('options / read-only', () => {
    test('typing, Enter and Backspace leave the document unchanged', async ({ page }) => {
        await bootReadOnly(page);

        await page.locator(editor.paragraph).first().click();
        await page.keyboard.type('xyz');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Delete');

        expect(await getMarkdown(page)).toBe(MARKDOWN);
    });

    test('paste and cut leave the document unchanged', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only in headless Playwright.');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await bootReadOnly(page);
        await page.evaluate(() => navigator.clipboard.writeText('pasted'));

        await page.locator(editor.paragraph).first().click();
        await page.keyboard.press(`${metaKey()}+a`);
        await page.keyboard.press(`${metaKey()}+v`);
        await page.keyboard.press(`${metaKey()}+x`);

        expect(await getMarkdown(page)).toBe(MARKDOWN);
    });

    test('copy still works', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only in headless Playwright.');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await bootReadOnly(page);

        const bold = page.locator('strong').first();
        await bold.dblclick();
        await page.keyboard.press(`${metaKey()}+c`);

        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('bold');
    });

    test('a click shows no markdown or HTML source', async ({ page }) => {
        await bootReadOnly(page);
        const paragraph = page.locator(editor.paragraph).first();
        const rendered = await paragraph.innerHTML();

        await page.locator('strong').first().click();
        await page.locator('mark').first().click();
        // A revealing re-render happens on the next animation frame.
        await page.evaluate(() => new Promise(requestAnimationFrame));

        expect(await paragraph.innerHTML()).toBe(rendered);
        // Revealed markers turn from `mu-hide` into `mu-gray`.
        await expect(paragraph.locator('.mu-gray')).toHaveCount(0);
    });

    test('a plain click follows a link', async ({ page }) => {
        await bootReadOnly(page);
        await page.evaluate(() => {
            const hrefs: string[] = [];
            (window as unknown as { __hrefs: string[] }).__hrefs = hrefs;
            window.muya!.on('format-click', ({ data }: { data: { href: string } }) => hrefs.push(data.href));
        });

        await page.locator('.mu-link').first().click();

        expect(await page.evaluate(() => (window as unknown as { __hrefs: string[] }).__hrefs))
            .toEqual(['https://example.com']);
    });

    test('a task checkbox does not toggle', async ({ page }) => {
        await bootReadOnly(page);
        const checkbox = page.locator(editor.taskListItem).first().locator('.mu-task-list-checkbox');

        await checkbox.click();

        await expect(checkbox).not.toBeChecked();
        expect(await getMarkdown(page)).toBe(MARKDOWN);
    });

    test('no floating tool opens on hover or selection', async ({ page }) => {
        await bootReadOnly(page);

        const box = (await page.locator(editor.paragraph).first().boundingBox())!;
        await page.mouse.move(box.x + 10, box.y + box.height / 2);
        await page.mouse.move(box.x + 12, box.y + box.height / 2);
        await page.locator('strong').first().dblclick();

        expect(await page.evaluate(() => window.muya!.ui.shownFloat.size)).toBe(0);
        const frontButtonOpacity = await page.locator(floats.paragraphFrontButton)
            .evaluate(el => (el as HTMLElement).style.opacity || '0');
        expect(Number.parseFloat(frontButtonOpacity)).toBe(0);
    });

    test('focus mode lights the block the reader clicked', async ({ page }) => {
        await page.evaluate((markdown) => {
            window.__e2e!.rebuildMuya({ readOnly: true, focusMode: true, markdown });
        }, MARKDOWN);
        const paragraph = page.locator('.mu-container > *').first();
        const taskList = page.locator('.mu-container > *').nth(1);

        await page.getByText('open task').click();
        await expect(taskList).toHaveCSS('opacity', '1');
        await expect(paragraph).toHaveCSS('opacity', '0.25');

        await page.locator('strong').first().click();
        await expect(paragraph).toHaveCSS('opacity', '1');
        await expect(taskList).toHaveCSS('opacity', '0.25');
    });

    test('editing resumes in the block clicked while read-only', async ({ page }) => {
        await bootReadOnly(page);
        await page.evaluate(() => window.muya!.focus());

        await page.getByText('open task').click();
        await page.evaluate(() => window.muya!.setReadOnly(false));
        await page.keyboard.press('End');
        await page.keyboard.type('!');

        await expect.poll(() => getMarkdown(page)).toContain('open task!');
    });

    test('setReadOnly(false) gives editing back', async ({ page }) => {
        await bootReadOnly(page);
        await page.evaluate(() => window.muya!.setReadOnly(false));

        await page.locator(editor.paragraph).first().click();
        await page.keyboard.press('End');
        await page.keyboard.type('!');

        await expect.poll(() => getMarkdown(page)).toContain('example.com).!');
    });

    test('a focused editor takes typing right after setReadOnly(false)', async ({ page }) => {
        await bootReadOnly(page);
        await page.evaluate(() => {
            window.muya!.focus();
            window.muya!.setReadOnly(false);
        });

        await page.keyboard.type('x');

        await expect.poll(() => getMarkdown(page)).toBe(`x${MARKDOWN}`);
    });
});
