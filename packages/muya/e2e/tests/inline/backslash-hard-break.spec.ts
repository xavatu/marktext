import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

const MARKER = `${editor.hardLineBreakSpace} > span`;

test.describe('a hard line break written with a backslash', () => {
    test.beforeEach(async ({ page }) => {
        await page.evaluate(markdown => window.muya!.setContent(markdown), 'first line \\\nsecond line\n\nplain\n');
        await expect(page.locator(editor.hardLineBreakSpace)).toHaveCount(1);
    });

    test('takes no width on the line and keeps the break glyph', async ({ page }) => {
        const marker = page.locator(MARKER);

        await expect(marker).toHaveCSS('font-size', '0px');
        expect(await marker.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
        expect(await page.locator(editor.hardLineBreakSpace).evaluate(
            element => getComputedStyle(element, '::before').content,
        )).toBe('"↩"');
    });

    test('appears while the cursor is on the line end and hides again after it leaves', async ({ page }) => {
        const marker = page.locator(MARKER);

        await page.getByText('first line').click();
        await page.keyboard.press('End');
        await expect(marker).toHaveClass(/mu-gray/);
        expect(await marker.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);

        await page.getByText('plain').click();
        await expect(marker).toHaveClass(/mu-hide/);
    });
});
