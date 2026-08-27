import type { ExportLayout, TitleBlock } from '@buildflow/spatial'

/**
 * How the export control asks for a sheet.
 *
 * A plain module rather than a type exported from a `.vue` file: only the
 * canvas owns a Konva stage, so the renderer has to be passed in, and a type
 * that lives in an SFC is one neither the linter nor a plain `.ts` consumer
 * can follow.
 */
export type SheetRenderer = (layout: ExportLayout, block: TitleBlock) => string | null
