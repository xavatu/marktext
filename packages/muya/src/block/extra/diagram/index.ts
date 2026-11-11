import type { Muya } from '../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import logger from '../../../utils/logger';
import { loadLanguage } from '../../../utils/prism';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const debug = logger('diagram:');

/** The `preview-diagram` event payload a host opens its diagram viewer from. */
export interface IPreviewDiagramPayload {
    type: string;
    code: string;
    /** The rendered preview; the viewer clones it rather than re-rendering. */
    preview: HTMLElement;
    label: string | null;
}

class DiagramBlock extends Parent {
    public meta: IDiagramMeta;
    static override blockName = 'diagram';

    static create(muya: Muya, state: IDiagramState) {
        const diagramBlock = new DiagramBlock(muya, state);
        const { lang } = state.meta;
        const diagramPreview = ScrollPage.loadBlock('diagram-preview').create(
            muya,
            state,
        );
        const diagramContainer = ScrollPage.loadBlock('diagram-container').create(
            muya,
            state,
        );

        diagramBlock.appendAttachment(diagramPreview);
        diagramBlock.append(diagramContainer);

        !!lang
        && loadLanguage(lang)
            .then((infoList) => {
                if (!Array.isArray(infoList))
                    return;
                // There are three status `loaded`, `noexist` and `cached`.
                // if the status is `loaded`, indicated that it's a new loaded language
                const needRender = infoList.some(
                    ({ status }) => status === 'loaded' || status === 'cached',
                );
                if (needRender)
                    diagramBlock.lastContentInDescendant()?.update();
            })
            .catch((err) => {
                // if no parameter provided, will cause error.
                debug.warn(err);
            });

        return diagramBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, { meta }: IDiagramState) {
        super(muya);
        this.tagName = 'figure';
        this.meta = meta;
        this.classList = ['mu-diagram-block'];
        this.createDomNode();
    }

    /**
     * Emit `preview-diagram` so the host shows this diagram in its viewer.
     *
     * @returns False, without emitting, while there is no rendered diagram to
     * show: the code is empty or invalid, or the render has not landed yet.
     */
    openViewer(): boolean {
        const preview = this.attachments.head?.domNode as HTMLElement | undefined;
        if (!preview?.querySelector('svg, img'))
            return false;

        this.muya.eventCenter.emit('preview-diagram', {
            type: this.meta.type,
            code: this.firstContentInDescendant()?.text ?? '',
            preview,
            label: preview.getAttribute('aria-label'),
        } satisfies IPreviewDiagramPayload);

        return true;
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    override getState(): IDiagramState {
        const { meta } = this;
        const text = this.firstContentInDescendant()?.text;

        if (text == null)
            throw new Error('text is null when getState in diagram block.');

        return {
            name: 'diagram',
            text,
            meta,
        };
    }
}

export default DiagramBlock;
