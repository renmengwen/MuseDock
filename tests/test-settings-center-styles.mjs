import assert from 'assert';
import fs from 'fs';

// The settings center layout migrated from styles.css classes to inline Tailwind
// in SettingsPage.jsx, so assert the layout there instead of in the stylesheet.
const page = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');

assert.match(page, /grid grid-cols-\[180px_minmax\(0,1fr\)\] items-start/, 'Settings center should use a two-column Tailwind layout');
assert.match(page, /<nav className="sticky top-4 grid[^"]*" aria-label="设置中心导航">/, 'Settings center should render a sticky Tailwind nav');
assert.match(page, /min-w-0 rounded-lg border border-\[#e7e9ee\] bg-white p-5/, 'Settings center should render a bordered content panel');
assert.match(page, /max-\[900px\]:grid-cols-1/, 'Settings center should collapse to one column on narrow viewports');
assert.doesNotMatch(page, /gradient-orb|bokeh|heroGradient/, 'Settings center should not add decorative gradient junk');

console.log('settings center styles tests passed');
