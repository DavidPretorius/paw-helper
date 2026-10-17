const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../page-bridge.js'), 'utf8');
const colors = ['#112233', '#223344', '#334455', '#445566', '#556677'];
const theme = { name: 'Example', tokens: { charts: { series: colors } } };

function harness(initialAssets = [], useService = false) {
  const assets = structuredClone(initialAssets);
  const writes = [];
  let spec = { layout: { items: [{ items: [{ items: [{
    id: 'chart1', features: { Models_internal: { visId: 'com.ibm.vis.bar', properties: [] } }
  }] }] }] } };
  function create(name, content) {
    const asset = { id: `asset-${assets.length + 1}`, name,
      path: `/customizations/a:t:u/${name}`, content };
    assets.push(asset);
    return asset;
  }
  const api = {
    getCurrentProfile: () => ({ accountid: 'a', tid: 't', userid: 'u' }),
    getSpec: () => spec,
    reloadFromJSONSpec: value => { spec = value; }
  };
  if (useService) api.getService = () => ({ createPalette: ({ palette }) => {
    writes.push('service');
    return create(palette.label, { content: palette });
  } });
  const window = { addEventListener() {}, __getDashboardAPI: () => api };
  const fetch = async (url, options) => {
    if (options.method !== 'GET') {
      assert.equal(options.method, 'POST', 'existing palettes must never be updated');
      writes.push('POST');
      const body = JSON.parse(options.body);
      const asset = create(body.name, body.content);
      return { ok: true, json: async () => asset };
    }
    const filter = new URL(url, 'https://example.test').searchParams.get('$filter') || '';
    let matches = assets;
    for (const key of ['name', 'path']) {
      const match = filter.match(new RegExp(key + " eq '([^']*)'"));
      if (match) matches = matches.filter(asset => asset[key] === match[1]);
    }
    return { ok: true, json: async () => ({ value: matches }) };
  };
  // Expose the real entry point in memory without changing production exports.
  vm.runInNewContext(source.replace('  window.addEventListener("message",',
    '  window.applyThemeForTest = applyTheme;\n  window.addEventListener("message",'), { window, fetch });
  return {
    assets, writes,
    apply: (definition, applyOptions) => window.applyThemeForTest({ themeDefinition: definition, applyOptions }),
    reference: () => spec.layout.items[0].items[0].items[0].features.Models_internal.properties
      .find(property => property.id === 'colorPalette')?.value
  };
}

for (const useService of [false, true]) {
  test(`repeated applies create one stable palette via ${useService ? 'service' : 'REST'}`, async () => {
    const h = harness([], useService);
    await h.apply(theme);
    const firstReference = h.reference();
    const result = await h.apply({ ...theme, tokens: { charts: { series: ['#FFFFFF'] } } });
    assert.equal(h.assets.length, 1);
    assert.equal(h.assets[0].name, 'Example Palette');
    assert.equal(h.writes.length, 1);
    assert.equal(result.reusedPalette, true);
    assert.equal(h.reference(), firstReference);
    assert.deepEqual(Array.from(h.assets[0].content.content.fills), colors);
  });
}

test('existing name wins even when theme has no colors', async () => {
  const asset = { id: 'saved', name: 'Example Palette', path: '/customizations/a:t:u/Example Palette',
    content: { content: { fills: ['#ABCDEF'] } } };
  const h = harness([asset]);
  const result = await h.apply({ name: 'Example' });
  assert.equal(result.reusedPalette, true);
  assert.equal(h.reference(), '__CM__saved');
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.assets, [asset]);
});

test('legacy timestamped palette is preserved while stable palette is created once', async () => {
  const legacy = { id: 'legacy', name: 'Example Palette 20260101-120000',
    path: '/customizations/a:t:u/Example Palette 20260101-120000', content: { content: { fills: colors } } };
  const h = harness([legacy]);
  await h.apply(theme);
  await h.apply(theme);
  assert.equal(h.assets.length, 2);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.assets[0], legacy);
  assert.equal(h.assets[1].name, 'Example Palette');
});

for (const hints of [undefined, { chart1: { colorPalette: '__CM__hint', defaultPaletteIndex: 2 } }]) {
  test(`disabled chart styling preserves palette with hints=${Boolean(hints)}`, async () => {
    const h = harness();
    await h.apply(theme);
    const original = h.reference();
    const result = await h.apply({ ...theme, name: 'Other', chartPaletteByWidgetId: hints }, { chartStyling: false });
    assert.equal(h.reference(), original);
    assert.equal(h.writes.length, 1);
    assert.equal(result.appliedChartPaletteHints, false);
  });
}
