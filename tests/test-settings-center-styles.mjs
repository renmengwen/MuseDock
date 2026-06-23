import assert from 'assert';
import fs from 'fs';

const css = fs.readFileSync('frontend-react/src/styles.css', 'utf-8');

assert.match(css, /\.settingsCenterLayout/);
assert.match(css, /\.settingsCenterNav/);
assert.match(css, /\.settingsPanel/);
assert.match(css, /\.settingsCleanupGrid/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.doesNotMatch(css, /gradient-orb|bokeh|heroGradient/);

console.log('settings center styles tests passed');
