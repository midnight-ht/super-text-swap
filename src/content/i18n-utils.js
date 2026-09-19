(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SuperTextSwapI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BUILT_IN_MESSAGES = {
    zh_CN: {
      pickMultiCount: '已选 $N$ 个',
      pickDoneBtn: '完成',
      pickCancelBtn: '取消',
      pickSelectedTitle: '已选择元素',
      pickUseForRule: '用于替换范围',
      pickPromptMulti: '依次点击多个来源元素  ·  完成后点上方「完成」  ·  Esc 取消',
      pickPrompt: '请点击目标元素  ·  Esc 取消',
      pickDone: '已选择：$SELECTOR$  ·  请重新打开插件',
      pickCancel: '已取消',
      pickMultiDone: '已选择 $N$ 个来源  ·  请重新打开插件',
    },
    en: {
      pickMultiCount: '$N$ selected',
      pickDoneBtn: 'Done',
      pickCancelBtn: 'Cancel',
      pickSelectedTitle: 'Element selected',
      pickUseForRule: 'Use as rule scope',
      pickPromptMulti: 'Click each source element  ·  click "Done" above when finished  ·  Esc to cancel',
      pickPrompt: 'Click target element  ·  Esc to cancel',
      pickDone: 'Selected: $SELECTOR$  ·  Reopen the extension popup',
      pickCancel: 'Cancelled',
      pickMultiDone: 'Selected $N$ sources  ·  Reopen the extension popup',
    },
  };

  function substitute(value, substitution) {
    return substitution === undefined
      ? value
      : value.replace(/\$[A-Z_]+\$/g, String(substitution));
  }

  function resolveMessage(key, substitution, chromeApi, messages, locale) {
    const explicitMessage = messages?.[key]?.message;
    if (explicitMessage) return substitute(explicitMessage, substitution);

    const builtInLocale = String(locale || '').toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
    const builtInMessage = BUILT_IN_MESSAGES[builtInLocale][key];
    if (builtInMessage) return substitute(builtInMessage, substitution);

    try {
      const nativeMessage = chromeApi?.i18n?.getMessage?.(
        key,
        substitution === undefined ? undefined : substitution,
      );
      if (nativeMessage) return nativeMessage;
    } catch {
      // Fall through to the explicitly loaded locale file.
    }

    return substitute(key, substitution);
  }

  return { resolveMessage };
});
