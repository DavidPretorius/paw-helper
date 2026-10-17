# PAW Workbook Chrome Extension

This extension is a plain Manifest V3 browser extension for IBM Planning Analytics Workspace.

## What it does

1. Accepts a workbook JSON file and loads it into the currently open PAW board.
2. Applies a bundled workspace theme definition across the current board spec.
3. Extracts colors and fonts from any ordinary webpage and generates a PAW theme draft you can save for later.
4. Extracts formatting from the current PAW workbook and saves it as a reusable theme draft.

## How it works

- The popup UI runs inside the extension.
- A content script injects `page-bridge.js` into the page.
- The page bridge calls `window.__getDashboardAPI()` directly on the PAW page.
- Workbook import uses `reloadFromJSONSpec(spec)` and marks the board as dirty.
- Theme application reads the current live spec, updates top-level board properties and common widget styling, then reloads the board.
- The theme engine supports both wrapper-level visual widgets and inner PAW MDV widgets.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:

```text
extension
```

## Usage

1. Open a PAW workbook / board in the browser.
2. Open the extension popup.
3. For workbook import:
   - choose a `.json` file
   - click `Replace Current Workbook`
4. For theme application:
   - choose a bundled or saved theme
   - review the preview split between backgrounds and accents, plus fonts
   - tick or untick the apply options you want
   - cube views are split into shell/generic settings, rows, columns, and data
   - click `Apply Theme`
   - status and error messages appear inline in the Connection area instead of a separate activity panel
5. For webpage theme extraction:
   - open any webpage
   - click `Extract Web Theme`
   - the generated theme is added to the theme selector as a saved theme
   - saved generated themes can be deleted from the Theme Library
   - later, open a PAW page, select that saved theme, and click `Apply Theme`
   - click the **Download theme** down-arrow icon if you also want the JSON file
6. For PAW workbook style extraction:
   - open a PAW workbook / board
   - click `Extract PAW Theme`
   - the extracted theme is added to the same Theme Library as a saved theme
   - chart palette and palette index hints are captured by chart widget id (including charts that intentionally have no explicit palette) for best round-trip fidelity on the same workbook
   - select it and click `Apply Theme` on another board when needed
7. Save the workbook normally in PAW after reviewing the result.

## Accepted JSON shapes

- raw board spec
- PA content asset envelope with a top-level `content` object

## Theme files

Themes are bundled in:

```text
themes/index.json
themes/*.json
```

Add more theme JSON files there and update `themes/index.json` to expose them in the popup.

Themes can now be authored as semantic-first source files with sections such as:

- `authoringPalette.backgrounds.primary` (background 1: tab/dashboard)
- `authoringPalette.backgrounds.secondary` (background 2: cards/surfaces)
- `authoringPalette.accents` (5-8 accent colors, ordered)
- `semantic.backgrounds`
- `semantic.neutrals`
- `semantic.accents`
- `semantic.typography`
- `semantic.radii`

`authoringPalette` is now the preferred manual-edit block. The extension normalizes this block and then compiles it (plus semantic fallbacks) into PAW-friendly runtime tokens and visual sections before previewing or applying a theme.
If you only want to hand-edit colors quickly, you can edit just `authoringPalette` and keep the rest as-is.

The current schema can theme:

- board-level properties and custom colors
- dashboard-level background and tab/page-level background
- outer `live` widgets by `visId`, including chart property arrays
- MDV grid `genericProperties` such as headers, zebra lines, borders, editability, and display mode
- cube-view themes now default `isGridEditable` to `true` during apply, so bundled, generated, and extracted themes keep PA cube viewers editable unless TM1 security or cell state blocks input
- MDV section styling for `RowHeader`, `ColumnHeader`, `DataCell`, and `Spacer`, including row and column background fills
- theme-driven cube-view conditional formatting definitions (`mdvConditionalFormatDefinitions`) with per-dimension element lists
- Single-cell widget presets (`pasinglecell`) with dedicated `mdvGridState` and `DataCell` styling, controlled by the `Single cell settings` advanced option
- Single-cell visual titles now default to off in shipped themes and generated themes (`pasinglecell.showTitle = false`)
- Bar chart defaults include left-aligned category tick labels (`itemAxis.ticks.labels.alignment = left`)
- optional row auto-alignment pass that snaps near-equal widget Y positions into aligned rows using a 20px tolerance (`Auto-align near rows (Y)` advanced option)
- optional row height equalization pass that normalizes near-equal widget heights within aligned rows using a 20px tolerance (`Equalize near row heights` advanced option)
- row and column headers default to the theme's first accent color, with an automatic contrasting text color
- chart visualizations inherit the same card border color, border width, rounding, and base surface as cube views
- tab surfaces use the first background swatch, while card-like widget surfaces use the second background swatch
- applying a theme reuses an existing PAW palette named `<Theme Name> Palette`, regardless of its colors. The saved palette's colors are never updated. If the name does not exist, the extension creates it using the theme chart colors. Older timestamped palettes are left unchanged and are not treated as the stable-name palette.
- PAW-extracted themes now include per-chart palette hints (`chartPaletteByWidgetId`); when applying back to the same workbook and all chart ids match, those original palette assignments are reused instead of forcing a new palette
- selector appearance (fill, border, text color, and optional font), preserving existing bindings, members, search controls, display mode, and multi-select behavior
- text border radius
- image object fit
- action button radius and button palette variants

The popup can also generate a new theme draft from a non-PAW webpage by sampling visible colors, accents, borders, and font families from the active tab and layering those onto a hidden extraction blueprint (`themes/workspace-theme_blueprint.json`) for consistent output. Accent candidates that are too close to the secondary background surface are now filtered out so low-contrast accents are skipped.

Conditional formatting schema (per theme):

```json
"visuals": {
  "conditionalFormatting": {
    "paletteId": "userPaletteColor",
    "rules": [
      {
        "name": "Account emphasis",
        "enabled": true,
        "dimension": "Account",
        "hierarchy": "Account",
        "elements": ["4999", "3999"],
        "comparisonOperator": "=",
        "operandType": "memberSelector",
        "style": {
          "textStyle": "font-weight: bold;"
        }
      },
      {
        "name": "Actuality emphasis",
        "enabled": true,
        "dimension": "ActualityMonthly",
        "hierarchy": "ActualityMonthly",
        "elements": ["Actual", "Budget"],
        "comparisonOperator": "=",
        "operandType": "memberSelector",
        "style": {
          "borderColor": "border-grayShade1"
        }
      }
    ]
  }
}
```

Each conditional-format rule must carry its own `style`. Multiple rule groups can live side by side in the same `rules` array.

When `Conditional formatting` is checked in advanced options, the extension creates theme-managed definitions and assigns them to `pacubeviewer` widgets on matching server/cube combinations.

The popup changes mode depending on the active tab:

- on PAW pages, it shows workbook import and theme-apply actions
- on non-PAW pages, it hides the apply actions and options, and shows the extraction workflow instead
- the theme library stays available in both modes so generated themes can be reused later
- the popup is organized into three sections only: import, theme, and extraction

The connection card also includes a manual `Refresh` button so you can re-check whether the active tab currently exposes the PAW API.

The extension intentionally preserves existing MDV row/column show-hide state.
Theme application will not overwrite `hideRowsHeader` or `hideColsHeader` on views.
Theme application preserves selector data and behavior, including bindings and display mode. Data blocks in older extracted selector themes are ignored. Selectors are excluded from automatic row alignment and height equalization.
Bundled chart presets keep axis titles hidden but preserve tick labels and axis lines so charts stay readable after theme application.

## Notes

- The extension expects `window.__getDashboardAPI()` to exist on the active page.
- The current implementation replaces the whole live workbook when importing JSON.
- Theme application covers top-level board settings plus a growing set of visual settings. It is designed to be safe and incremental rather than exhaustive, so very widget-specific HTML internals may still need further extension.

## Version 0.8.1

- Stable-name palette reuse preserves the saved palette colors.
- Turning off Chart styling also preserves chart palette assignments and skips palette creation.
- Extracted themes no longer capture selector data; applying old themes cannot overwrite selector bindings or interaction settings.
- Automatic layout adjustment leaves selectors in place and keeps their dimensions.
- Invalid HEX input can be corrected without reopening the editor.
- Refresh can retry a failed page bridge injection.

Release downloads contain this version. Extract it and use Chrome's **Load unpacked** on the extracted `paw-helper` folder. For an existing unpacked installation, update its files, reload the extension in `chrome://extensions`, and refresh the PAW page.

Run the regression suite from the repository root:

```text
node --test extension/tests/*.test.cjs
```

The tests use simulated browser/PAW APIs. Live PAW rendering, including macOS selector appearance, still requires verification. These fixes prevent future selector changes; they do not restore bindings or geometry already overwritten in a saved book.
