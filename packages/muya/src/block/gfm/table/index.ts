import type { Muya } from '../../../muya';
import type { ITableRowState, ITableState } from '../../../state/types';
import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type TableCellContent from '../../content/tableCell';
import type { TBlockPath } from '../../types';
import type TableBodyCell from './cell';
import type TableRow from './row';
import type TableInner from './table';
import diff from 'fast-diff';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES } from '../../../config';
import { LINK_SELECTOR } from '../../../editor/linkMouseEvents';
import { diffToTextOp, isMouseEvent } from '../../../utils';
import logger from '../../../utils/logger';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const debug = logger('table:');

/** The `preview-table` event payload a host opens its table viewer from. */
export interface IPreviewTablePayload {
    /**
     * A static copy of the table, outside the document. Its cells read as they
     * do without a caret, nothing in it is editable, and it keeps the table's
     * width and the editor's type, so the host can show it as is.
     */
    preview: HTMLElement;
}

// What a click acts on by itself inside a cell: a link is followed, an image
// opens in its own viewer.
const OWN_CLICK_TARGETS = `a, ${LINK_SELECTOR}, .${CLASS_NAMES.MU_INLINE_IMAGE}`;

// The caret and a cell selection mark the live table; a preview shows neither.
const EDITING_CLASSES = [
    CLASS_NAMES.MU_ACTIVE,
    CLASS_NAMES.MU_TABLE_CELL_SELECTED,
    CLASS_NAMES.MU_TABLE_CELL_BORDER_TOP,
    CLASS_NAMES.MU_TABLE_CELL_BORDER_RIGHT,
    CLASS_NAMES.MU_TABLE_CELL_BORDER_BOTTOM,
    CLASS_NAMES.MU_TABLE_CELL_BORDER_LEFT,
];

class Table extends Parent {
    override children: LinkedList<TableInner> = new LinkedList();

    static override blockName = 'table';

    static create(muya: Muya, state: ITableState) {
        const table = new Table(muya);

        table.append(ScrollPage.loadBlock('table.inner').create(muya, state));

        return table;
    }

    // static createWithRowAndColumn(muya, row, column) {
    //   // TODO
    // }

    static createWithHeader(muya: Muya, header: string[]) {
        const state: ITableState = {
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: header.map(c => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: c,
                    })),
                },
                {
                    name: 'table.row',
                    children: header.map(() => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: '',
                    })),
                },
            ],
        };

        return this.create(muya, state);
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    get rowCount() {
        return (this.firstChild as TableInner).length();
    }

    get columnCount() {
        return ((this.firstChild as TableInner).firstChild as TableRow).length();
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'figure';

        this.classList = ['mu-table'];
        this.createDomNode();
        this._listenDomEvent();
    }

    isEmpty() {
        const state = this.getState();

        return state.children.every(row =>
            row.children.every(cell => cell.text === ''),
        );
    }

    private _listenDomEvent() {
        const { domNode } = this;

        // Fix: prevent cursor present at the end of table.
        const mousedownHandler = (event: Event) => {
            if (event.target !== domNode)
                return;

            // A table too wide for its figure scrolls, and pressing the
            // scrollbar targets the figure too.
            if (isMouseEvent(event) && event.offsetY >= domNode!.clientHeight)
                return;

            event.preventDefault();
            const cursorBlock = this.lastContentInDescendant()!;
            const offset = cursorBlock.text.length;
            cursorBlock.setCursor(offset, offset, true);
        };

        const mousedownObservable = fromEvent(domNode!, 'mousedown');
        mousedownObservable.subscribe(mousedownHandler);

        fromEvent(domNode!, 'click').subscribe(this._clickHandler.bind(this));
    }

    // A table opens in the host's viewer the way an image does: on a plain
    // click while reading, on a Ctrl/⌘-click while editing. A click on a link
    // or an image in a cell, or one that ends a text selection, keeps its
    // usual meaning, and so does one on the scrollbar.
    private _clickHandler(event: Event) {
        const { target } = event;
        if (!isMouseEvent(event) || !(target instanceof Element))
            return;

        const opens = this.muya.options.readOnly || event.ctrlKey || event.metaKey;
        if (
            !opens
            || !this.firstChild?.domNode?.contains(target)
            || target.closest(OWN_CLICK_TARGETS)
            || document.getSelection()?.isCollapsed === false
        ) {
            return;
        }

        this.openViewer();
    }

    /** Emit `preview-table` so the host shows a static copy of this table. */
    openViewer() {
        const inner = this.firstChild as TableInner;
        const live = inner.domNode as HTMLTableElement;
        const table = live.cloneNode(true) as HTMLTableElement;

        // The caret reveals the markdown around it, and search marks its
        // matches; render every cell afresh without either.
        const { inlineRenderer } = this.muya.editor;
        inner.forEach((row, rowOffset) => {
            (row as TableRow).forEach((cell, columnOffset) => {
                const content = table.rows[rowOffset]?.cells[columnOffset]?.firstElementChild;
                if (content)
                    content.innerHTML = inlineRenderer.renderPreview((cell as TableBodyCell).firstChild as TableCellContent);
            });
        });

        for (const element of [table, ...table.querySelectorAll('*')]) {
            // Ids would repeat the live table's.
            element.removeAttribute('id');
            element.removeAttribute('contenteditable');
            element.classList.remove(...EDITING_CLASSES);
        }

        // At its width in the document the table wraps its cells the same
        // way. Rounding down could wrap one more line.
        table.style.width = `${Math.ceil(live.getBoundingClientRect().width)}px`;

        const preview = document.createElement('div');
        preview.className = 'mu-table-preview';
        preview.dir = getComputedStyle(live).direction;
        // The editor's font options are `--mu-*` properties on its root
        // (`applyAppearance`).
        const { style } = this.muya.domNode;
        for (const name of Array.from(style)) {
            if (name.startsWith('--mu-'))
                preview.style.setProperty(name, style.getPropertyValue(name));
        }
        preview.appendChild(table);

        this.muya.eventCenter.emit('preview-table', { preview } satisfies IPreviewTablePayload);
    }

    queryBlock(path: TBlockPath) {
        // Table's only child at runtime is `TableInner` (the body wrapper),
        // which extends the queryBlock mixin and is always present.
        return (this.firstChild as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined }).queryBlock(path);
    }

    protected override empty() {
        if (this.isEmpty())
            return;

        const table = this.children.head;
        if (table == null)
            return;

        table.forEach((row) => {
            (row as TableRow).forEach((cell) => {
                ((cell as TableBodyCell).firstChild as TableCellContent).text = '';
            });
        });
    }

    insertRow(offset: number) {
        const { columnCount } = this;
        const firstRowState = this.getState().children[0];
        const currentRow
            = offset > 0
                ? (this.firstChild as TableInner).find(offset - 1)
                : (this.firstChild as TableInner).find(offset);
        const state = {
            name: 'table.row',
            // eslint-disable-next-line unicorn/no-new-array
            children: [...new Array(columnCount)].map((_, i) => {
                return {
                    name: 'table.cell',
                    meta: {
                        align: firstRowState.children[i].meta.align,
                    },
                    text: '',
                };
            }),
        };

        const rowBlock = ScrollPage.loadBlock('table.row').create(this.muya, state);

        if (offset > 0)
            (this.firstChild as TableInner).insertAfter(rowBlock, currentRow as TableRow);
        else
            (this.firstChild as TableInner).insertBefore(rowBlock, currentRow as TableRow);

        return rowBlock.firstContentInDescendant();
    }

    insertColumn(offset: number, align = 'none') {
        const tableInner = this.firstChild as TableInner;
        let firstCellInNewColumn: Nullable<TableBodyCell> = null;

        tableInner.forEach((row) => {
            const state = {
                name: 'table.cell',
                meta: { align },
                text: '',
            };
            const cell = ScrollPage.loadBlock('table.cell').create(this.muya, state);
            const ref = (row as TableRow).find(offset);

            (row as TableRow).insertBefore(cell, ref as TableBodyCell);
            if (!firstCellInNewColumn)
                firstCellInNewColumn = cell;
        });

        return firstCellInNewColumn!.firstChild as TableCellContent;
    }

    removeRow(offset: number): Nullable<Content> {
        const inner = this.firstChild as TableInner;
        const row = inner.find(offset);
        if (row == null)
            return;

        // Capture a surviving neighbour
        // BEFORE the detach so the caller can place the caret on a cell that
        // is still attached to the DOM. Prefer the next row, fall back to the
        // previous; if no rows remain after this delete, capture a content
        // block OUTSIDE the table so the caret never lands inside the
        // about-to-be-detached table itself.
        const survivor = (row.next as TableRow | null) ?? (row.prev as TableRow | null);
        // Always grab the outside-of-table fallback as well, in case the
        // whole table is going away. `nextContentInContext` / `prev` walk
        // out of the table by design.
        const outsideContent
            = this.nextContentInContext() ?? this.previousContentInContext();

        row.remove();

        if (survivor == null) {
            this.remove();
            return outsideContent ?? null;
        }

        return (survivor.firstChild as TableBodyCell).firstChild as TableCellContent;
    }

    removeColumn(offset: number): Nullable<Content> {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        if (this.columnCount === 1) {
            // Same outside-of-table fallback as removeRow when the whole
            // table is removed — never leave the caret inside a detached
            // subtree.
            const outsideContent
                = this.nextContentInContext() ?? this.previousContentInContext();
            this.remove();
            return outsideContent ?? null;
        }

        // Capture the first row's surviving neighbour cell before mutation so
        // the caller can setCursor on a still-attached cell after the column
        // detach. Applied per column since the new architecture removes one
        // cell per row in a loop.
        const firstRow = table.firstChild as TableRow;
        const targetCellInFirstRow = firstRow.find(offset) as TableBodyCell | null;
        const neighbourCell
            = (targetCellInFirstRow?.next as TableBodyCell | null)
                ?? (targetCellInFirstRow?.prev as TableBodyCell | null);

        table.forEach((row) => {
            const cell = (row as TableRow).find(offset);
            if (cell)
                cell.remove();
        });

        return (neighbourCell?.firstChild as TableCellContent | undefined) ?? null;
    }

    alignColumn(offset: number, value: string) {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`Column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        table.forEach((row) => {
            const cell = (row as TableRow).find(offset) as TableBodyCell;
            if (cell) {
                const { align: oldValue } = cell;
                cell.align = oldValue === value ? 'none' : value;
                // dispatch change to modify json state
                const diffs = diff(oldValue, cell.align);
                const { path } = cell;
                path.push('meta', 'align');

                this.jsonState.editOperation(path, diffToTextOp(diffs));
            }
        });
    }

    /**
     * Resolve a body cell by its (row, column) offsets, both zero-based. Returns
     * `null` when either index is out of range. Used by the cross-cell selection
     * controller to walk the rectangle between an anchor and focus cell.
     */
    cellAt(row: number, column: number): Nullable<TableBodyCell> {
        const rowBlock = (this.firstChild as TableInner).find(row) as TableRow | undefined;
        if (rowBlock == null)
            return null;

        return (rowBlock.find(column) as TableBodyCell | undefined) ?? null;
    }

    /**
     * Build an `ITableState` for the rectangular block of cells bounded by
     * (`startRow`, `startColumn`) and (`endRow`, `endColumn`) inclusive. The
     * bounds may be passed in any order — they are normalised — and are clamped
     * to the table's dimensions, so a copied cell rectangle round-trips to GFM
     * table markdown via `StateToMarkdown`. The first selected row becomes the
     * header
     * row of the resulting sub-table, preserving each cell's alignment.
     */
    getSubTableState(
        startRow: number,
        startColumn: number,
        endRow: number,
        endColumn: number,
    ): ITableState {
        const { rowCount, columnCount } = this;
        const minRow = Math.max(0, Math.min(startRow, endRow));
        const maxRow = Math.min(rowCount - 1, Math.max(startRow, endRow));
        const minColumn = Math.max(0, Math.min(startColumn, endColumn));
        const maxColumn = Math.min(columnCount - 1, Math.max(startColumn, endColumn));

        const children: ITableState['children'] = [];
        for (let r = minRow; r <= maxRow; r++) {
            const cells: ITableRowState['children'] = [];
            for (let c = minColumn; c <= maxColumn; c++) {
                const cell = this.cellAt(r, c);
                if (cell)
                    cells.push(cell.getState());
            }
            children.push({ name: 'table.row', children: cells });
        }

        return { name: 'table', children };
    }

    override getState(): ITableState {
        return (this.firstChild as TableInner).getState();
    }
}

export default Table;
