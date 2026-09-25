# Interface decisions

A compact collection selector keeps navigation out of the diff’s way. Collections express a curated reading order; the separate Git ancestry tab reports actual dependencies. Each review and change group leads with a human name and explanation, while branch and folder identity stay available below it.

The file outline is an index into a continuous review, not a single-file filter. Every changed block appears in its assigned group or Other changes. Whole-file and partial-file groups share the same review controls; partial selections include complete hunks with context and are labeled Selected blocks. A changed image shows each version that exists, stacked in unified view and side by side in split view, over a checkerboard that shows only through transparency.

A group receipt records the diff content and description the user reviewed. Missing selections and overlapping groups are explicit states. Reviewed does not imply approval to push or publish. Group status lives on disk; individual Viewed markers and private notes remain browser-local.

Light and dark palettes use semantic tokens for canvas, surfaces, text, borders, syntax, additions, deletions, warnings, and focus. System is the initial preference. Syntax-highlight spans have transparent backgrounds so they cannot erase a diff’s meaning. Status text and icons supplement color.

Native buttons, dialogs, and form controls provide keyboard behavior; the custom pickers implement listbox keyboard navigation. Focus remains visible. Reduced-motion disables animation. Narrow screens keep collection navigation and continuous diffs while hiding the optional file outline. Errors, loading, empty comparisons, missing files, and unavailable previews are explicit.

Verify real comparisons, addition/deletion backgrounds in both themes and layouts, image previews, 3-digit line numbers, continuous scrolling, deep links, collection switching, modal keyboard behavior, and review persistence/invalidation with disposable fixtures.
