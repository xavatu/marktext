import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { editor } from '../helpers/selectors';

/**
 * Clicking a rendered diagram opens it in the host's viewer the way clicking
 * an image does: a Ctrl/⌘-click while editing, a plain click while reading.
 * Before, only the hover toolbar's magnifier opened it, and read-only mode
 * hides every float, so a reader had no way in at all.
 */

const VALID = '```mermaid\ngraph TD\n    A-->B\n```\n';
// `mermaid.parse` rejects the dangling edge, so the preview shows an error.
const INVALID = '```mermaid\ngraph TD\n    A--->\n```\n';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

type TViewerLog = { __viewerOpens: string[] };

async function load(page: Page, markdown: string, readOnly = false): Promise<void> {
    await page.evaluate(({ markdown, readOnly }) => {
        window.__e2e!.rebuildMuya({ markdown, readOnly });
        const opens: string[] = [];
        (window as unknown as TViewerLog).__viewerOpens = opens;
        window.muya!.on('preview-diagram', ({ type }: { type: string }) => opens.push(type));
    }, { markdown, readOnly });
}

const viewerOpens = (page: Page) =>
    page.evaluate(() => (window as unknown as TViewerLog).__viewerOpens);

const preview = (page: Page) => page.locator(editor.diagramPreview).first();

async function waitForRender(page: Page): Promise<void> {
    await expect(page.locator(`${editor.diagramPreview}[role='img'] svg`).first())
        .toBeVisible({ timeout: 15_000 });
}

test.describe('diagram viewer on click', () => {
    test('a modifier-click opens the viewer without revealing the code', async ({ page }) => {
        await load(page, VALID);
        await waitForRender(page);

        await preview(page).click({ modifiers: [MODIFIER] });

        expect(await viewerOpens(page)).toEqual(['mermaid']);
        await expect(page.locator(editor.diagramBlock).first()).not.toHaveClass(/mu-active/);
    });

    test('a plain click while editing reveals the code instead', async ({ page }) => {
        await load(page, VALID);
        await waitForRender(page);

        await preview(page).click();

        expect(await viewerOpens(page)).toEqual([]);
        await expect(page.locator(editor.diagramBlock).first()).toHaveClass(/mu-active/);
    });

    test('a modifier-click on a diagram that failed to render edits it', async ({ page }) => {
        await load(page, INVALID);
        await expect(page.locator(editor.diagramError).first()).toBeVisible({ timeout: 15_000 });

        await preview(page).click({ modifiers: [MODIFIER] });

        expect(await viewerOpens(page)).toEqual([]);
        await expect(page.locator(editor.diagramBlock).first()).toHaveClass(/mu-active/);
    });

    test('a plain click opens the viewer in read-only mode', async ({ page }) => {
        await load(page, VALID, true);
        await waitForRender(page);
        await expect(preview(page)).toHaveCSS('cursor', 'zoom-in');

        await preview(page).click();

        expect(await viewerOpens(page)).toEqual(['mermaid']);
        await expect(page.locator(editor.diagramBlock).first()).not.toHaveClass(/mu-active/);
    });
});
