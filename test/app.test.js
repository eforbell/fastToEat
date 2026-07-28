'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const context = vm.createContext({
  document: { addEventListener() {} },
});
new vm.Script(source, { filename: 'public/app.js' }).runInContext(context);

test('elapsed fast duration always increases positively and includes days after 24 hours', () => {
  assert.equal(context.formatElapsedDuration(5 * 60 * 60 * 1000 + 16 * 60 * 1000 + 48 * 1000), '05:16:48');
  assert.equal(context.formatElapsedDuration(29 * 60 * 60 * 1000 + 16 * 60 * 1000 + 48 * 1000), '1d 05:16:48');
  assert.equal(context.formatElapsedDuration(-1), '00:00:00');
});
