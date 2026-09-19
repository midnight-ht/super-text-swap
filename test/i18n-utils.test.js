const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveMessage } = require('../src/content/i18n-utils.js');

test('uses the extension i18n message when the locale fetch has no data', () => {
  const chromeApi = {
    i18n: {
      getMessage(key, substitutions) {
        assert.equal(key, 'pickUseForRule');
        assert.deepEqual(substitutions, undefined);
        return 'Use as rule scope';
      },
    },
  };

  assert.equal(resolveMessage('pickUseForRule', undefined, chromeApi, {}), 'Use as rule scope');
});

test('falls back to fetched messages and substitutions when native i18n is unavailable', () => {
  const messages = { pickDone: { message: 'Selected: $SELECTOR$' } };
  assert.equal(resolveMessage('pickDone', 'network', {}, messages), 'Selected: network');
});

test('uses built-in Chinese content copy when extension resources are invalid', () => {
  assert.equal(resolveMessage('pickUseForRule', undefined, {}, {}, 'zh_CN'), '用于替换范围');
});
