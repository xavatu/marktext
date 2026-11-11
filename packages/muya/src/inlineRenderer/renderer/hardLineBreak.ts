import type { HardLineBreakToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

export default function hardLineBreak(
    this: Renderer,
    { h, cursor, block, token, outerClass }: ISyntaxRenderOptions & { token: HardLineBreakToken },
) {
    const { marker, lineBreak, isAtEnd } = token;
    const bands = this.lineBreakHighlights(
        h,
        token,
        token.range.end - lineBreak.length,
        token.range.end,
    );
    const className = CLASS_NAMES.MU_HARD_LINE_BREAK;
    const spaceClass = CLASS_NAMES.MU_HARD_LINE_BREAK_SPACE;
    // Hidden on the inner span: `font-size: 0` on the outer one would also hide
    // its `↩` glyph, which both spellings of the break share.
    const markerContent = marker === '\\'
        ? h(
                `span.${this.getClassName(outerClass, block, token, cursor)}.${CLASS_NAMES.MU_REMOVE}`,
                this.highlight(h, block, token.range.start, token.range.start + marker.length, token),
            )
        : marker;

    if (isAtEnd) {
        return [
            h(`span.${className}`, h(`span.${spaceClass}`, markerContent)),
            h(`span.${CLASS_NAMES.MU_LINE_END}`, bands.length ? [...bands, lineBreak] : lineBreak),
        ];
    }
    else {
        return [
            h(`span.${className}`, bands.length
                ? [...bands, h(`span.${spaceClass}`, markerContent), lineBreak]
                : [h(`span.${spaceClass}`, markerContent), lineBreak]),
        ];
    }
}
