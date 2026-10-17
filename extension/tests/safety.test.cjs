const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function bridge() {
  const window = { addEventListener() {} };
  vm.runInNewContext(read('page-bridge.js').replace('  window.addEventListener("message",',
    '  window.test = { applySyncTileTheme, applyThemeDefinition };\n  window.addEventListener("message",'), { window });
  return window.test;
}

function selector(data = {}) {
  return { type: 'widget', id: 'selector', style: { top: '100px', height: '48px' },
    features: { Models_internal: { type: 'live', visId: 'paselector' } },
    items: [{ features: { Models_internal: { type: 'tm1mdvSyncTile', data } } }] };
}
const specFor = items => ({ layout: { items: [{ items: [{ items }] }] } });

function popup() {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: '', validityMessage: '',
      setCustomValidity(message) { this.validityMessage = message; }, reportValidity() {}, close() { this.closed = true; } });
    return elements.get(id);
  } };
  const context = vm.createContext({ document, window: { matchMedia: () => ({}) }, structuredClone, URL });
  // Load real function declarations without popup startup/network/event registration.
  vm.runInContext(read('popup.js').split('themeSelectEl.addEventListener("change",')[0], context);
  return { context, elements };
}

test('legacy theme data cannot overwrite selector bindings, behavior or grid state', () => {
  const data = { hierarchyID: '[Region].[Region]', memberID: 'Europe', serverName: 'target', cube: 'Sales',
    alias: 'Caption', memberSet: 'Regions', multipleSelection: true, hasSearchBar: true, showAsList: true,
    mdvGridState: { genericProperties: { unrelated: { value: 123 } } } };
  const inner = selector(structuredClone(data)).items[0].features.Models_internal;
  bridge().applySyncTileTheme({}, inner, { visuals: { syncTile: { fillColor: 'transparent', data: {
    hierarchyID: '[Version].[Version]', memberID: 'Actual', serverName: 'source', cube: 'Other',
    alias: 'MEMBER_NAME', memberSet: 'Versions', multipleSelection: false, hasSearchBar: false,
    showAsList: false, mdvGridState: { genericProperties: {} }
  } } } }, {});
  assert.deepEqual(plain(inner.data), data);
  assert.equal(inner.fillColor, 'transparent');
});

test('all bundled themes preserve selector behavior', () => {
  for (const name of fs.readdirSync(path.join(__dirname, '../themes')).filter(n => n.startsWith('workspace-theme_'))) {
    const data = { multipleSelection: true, hasSearchBar: false, showAsList: true, showHeader: true, showIcon: true, isShowOverflowMenu: true };
    const inner = selector(structuredClone(data)).items[0].features.Models_internal;
    bridge().applySyncTileTheme({}, inner, JSON.parse(read(`themes/${name}`)), {});
    for (const [key, value] of Object.entries(data)) assert.equal(inner.data[key], value, `${name}: ${key}`);
  }
});

test('layout normalization preserves selectors but still adjusts ordinary widgets', () => {
  const item = selector();
  const neighbors = [32, 40].map((height, i) => ({ type: 'widget', id: `shape${i}`,
    style: { top: `${100 + i * 10}px`, height: `${height}px` }, features: { Models_internal: { type: 'shape' } } }));
  bridge().applyThemeDefinition(specFor([item, ...neighbors]), {}, { syncTiles: false, widgets: false });
  assert.deepEqual(item.style, { top: '100px', height: '48px' });
  assert.equal(neighbors[0].style.height, '36px');
  assert.equal(neighbors[1].style.top, '105px');
});

test('extracted themes omit selector data', () => {
  const { context } = popup();
  context.inputSpec = specFor([selector({ hierarchyID: 'PrivateHierarchy', memberID: 'PrivateMember', multipleSelection: true })]);
  const theme = vm.runInContext('buildThemeFromPawSpec(inputSpec, {}, { colors: {}, fonts: {} })', context);
  assert.ok(theme.visuals.syncTile);
  assert.equal(theme.visuals.syncTile.data, undefined);
  assert.equal(JSON.stringify(theme).includes('PrivateHierarchy'), false);
});

test('invalid HEX stays editable and corrected HEX applies', async () => {
  const { context, elements } = popup();
  vm.runInContext(`themeDraftState = {themeId: 'test', originalThemeSource: {}};
    pendingSwatchEdit = {themeId: 'test', group: 'accents', index: 0};
    updateSelectedThemeUi = async () => {};`, context);
  const input = elements.get('theme-color-hex-input');
  input.value = '#GGGGGG';
  await vm.runInContext('applyThemeSwatchEdit()', context);
  assert.ok(input.validityMessage);
  assert.equal(elements.get('theme-color-dialog').closed, undefined);
  input.value = '#123456';
  await vm.runInContext('applyThemeSwatchEdit()', context);
  assert.equal(input.validityMessage, '');
  assert.equal(vm.runInContext('themeDraftState.paletteOverrides.accents[0]', context), '#123456');
  assert.equal(elements.get('theme-color-dialog').closed, true);
});

test('failed bridge injection retries once and shares a successful load', async () => {
  let injections = 0;
  const window = {};
  const document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild(script) {
    injections++;
    queueMicrotask(() => injections === 1 ? script.onerror() : script.onload());
  } } };
  const source = read('content-script.js').replace('  injectPageBridge().catch(() => {});',
    '  window.injectForTest = injectPageBridge;');
  vm.runInNewContext(source, { window, document, chrome: { runtime: { getURL: x => x, onMessage: { addListener() {} } } } });
  await assert.rejects(window.injectForTest(), /Failed to inject/);
  await Promise.all([window.injectForTest(), window.injectForTest()]);
  await window.injectForTest();
  assert.equal(injections, 2);
});
