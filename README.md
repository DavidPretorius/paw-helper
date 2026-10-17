# PAW Helper

A Chrome extension for styling IBM Planning Analytics Workspace books: apply themes, edit colors and logos, extract reusable themes, and inspect or replace a book's JSON specification.

## Install

1. Download `paw-helper-0.8.1.zip` from [Releases](https://github.com/DavidPretorius/paw-helper/releases/latest).
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted `paw-helper` folder containing `manifest.json`.
5. Open or refresh your PAW book, then open PAW Helper from Chrome's extensions menu.

Alternatively, clone this repository and load the `extension` folder. No build step is required. Keep the extracted folder: Chrome loads the extension from it.

## Use

- Choose a theme and review its colors and fonts.
- Select the styling options you want, then click **Apply Theme**.
- Review the book and save it normally in PAW.
- Use **Extract From Current PAW Book** to make a reusable theme, or generate one from an ordinary webpage.
- Use **Board Spec** to inspect, copy, or apply workbook JSON.

Work on a copy of your book when trying a new theme. Full board-spec replacement can overwrite book content.

A palette named `<Theme Name> Palette` is reused by name. Its saved colors are never updated, even when the theme's colors differ. A missing palette is created once under that stable name. Extracted themes can also preserve existing per-chart palette assignments when widget IDs match.

Selector bindings, selected members and interaction settings are preserved. Selectors are excluded from automatic row alignment and height equalization.

See [theme authoring and detailed behavior](docs/THEMES.md).

## Compatibility

This is a Manifest V3 Chrome extension using PAW's internal browser APIs, including `window.__getDashboardAPI()`. IBM can change these APIs between releases. It is an independent helper, not an IBM-supported product.

The regression suite uses simulated PAW/browser APIs. Live rendering on macOS has not been verified. Fonts must be available in the target environment for matching typography.

## Privacy and permissions

The extension requests `activeTab`, `scripting`, `storage`, and access to all websites. PAW can be hosted on different domains, and webpage theme extraction operates on arbitrary sites. Its content script is installed on matching pages.

Saved themes are stored in Chrome's local extension storage. Workbook actions use your existing PAW session; the helper does not request your PAW password. Custom palette creation writes an asset to PAW. The extension code contains no analytics or telemetry service.

Theme extraction reads page styles and may fetch a chosen logo URL. Remote logos are loaded from their hosts. Review extracted themes and workbook JSON before sharing them: they can include source URLs, branding, chart references, or workbook information.

## Development

No npm dependencies are required. Run the tests with Node.js 24:

```sh
node --test extension/tests/*.test.cjs
```

Build and verify a distributable ZIP with Python 3:

```sh
python scripts/package.py
```

The archive is written to `dist/` and excludes tests and development files.

When reporting a bug, include the helper version, Chrome/macOS or Windows version, PAW version, and steps to reproduce. Use sanitized examples; do not post real workbook data or credentials.

## License

No license is provided at this time.
