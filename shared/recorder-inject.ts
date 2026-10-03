/**
 * 录制注入脚本：在页面里监听点击/输入/选择/滚动/SPA 导航，
 * 通过 console.log("__RECORD__:" + JSON) 把步骤回传给宿主渲染进程。
 * 单独成文件：这段字符串近 200 行，留在视图里会淹没真正的录制逻辑。
 */
export const RECORDER_INJECT_SCRIPT = `
(function() {
  if (window.__recordInjected) return;
  window.__recordInjected = true;

  function getSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    if (el === document.body) return 'body';

    var tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\\s+/)
        .filter(function(c) { return c && !c.match(/^(hover|active|focus|visited|selected)/i); });
      if (classes.length) {
        var sel = tag + '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
        try {
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch(e) {}
      }
    }

    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
    if (siblings.length === 1) {
      var parentSel = getSelector(parent);
      return parentSel ? parentSel + ' > ' + tag : tag;
    }
    var index = siblings.indexOf(el) + 1;
    var parentSel2 = getSelector(parent);
    return parentSel2 ? parentSel2 + ' > ' + tag + ':nth-of-type(' + index + ')' : tag + ':nth-of-type(' + index + ')';
  }

  function getElementText(el) {
    if (!el) return '';
    var text = (el.textContent || '').trim().slice(0, 50);
    if (text) return text;
    if (el.placeholder) return el.placeholder.slice(0, 50);
    if (el.title) return el.title.slice(0, 50);
    if (el.alt) return el.alt.slice(0, 50);
    return '';
  }

  function record(action, el, value) {
    flushClick();
    var data = {
      __record: true,
      action: action,
      selector: el ? getSelector(el) : '',
      value: value || undefined,
      tagName: el ? el.tagName.toLowerCase() : undefined,
      elementText: el ? getElementText(el) : undefined,
      description: ''
    };

    switch (action) {
      case 'click':
        data.description = '点击 ' + (data.elementText || data.tagName || '元素');
        break;
      case 'dblclick':
        data.description = '双击 ' + (data.elementText || data.tagName || '元素');
        break;
      case 'fill':
        data.description = '输入 ' + (data.elementText || data.tagName || '') + ' = ' + (value || '').slice(0, 20);
        break;
      case 'select':
        data.description = '选择 ' + (data.elementText || data.tagName || '') + ' = ' + (value || '');
        break;
      case 'scroll':
        data.description = '页面滚动';
        break;
      case 'navigate':
        data.description = '页面导航: ' + (value || '').slice(0, 40);
        break;
      default:
        data.description = action + ' ' + (data.elementText || data.tagName || '');
    }

    console.log('__RECORD__:' + JSON.stringify(data));
  }

  // 输入防抖：用户停止输入 400ms 后立即录制，避免每键一条记录；
  // 若期间触发 change/Enter，则取消防抖以避免重复录制
  var fillDebounceTimer = null;
  var fillDebounceTarget = null;

  function scheduleFillRecord(el) {
    fillDebounceTarget = el;
    if (fillDebounceTimer) clearTimeout(fillDebounceTimer);
    fillDebounceTimer = setTimeout(function() {
      fillDebounceTimer = null;
      if (fillDebounceTarget && fillDebounceTarget.value) {
        record('fill', fillDebounceTarget, fillDebounceTarget.value);
      }
      fillDebounceTarget = null;
    }, 400);
  }

  function cancelFillDebounce() {
    if (fillDebounceTimer) {
      clearTimeout(fillDebounceTimer);
      fillDebounceTimer = null;
      fillDebounceTarget = null;
    }
  }

  // 单击延后 220ms 落账：双击是同一次动作，前一半不该单独成步（否则会录成「点击 + 双击」两条）。
  // 期间冒出别的动作就先立即落账，保证步骤顺序跟操作顺序一致。
  var pendingClick = null;

  function flushClick() {
    if (!pendingClick) return;
    var el = pendingClick.el;
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    emitClick(el);
  }

  function emitClick(el) {
    record('click', el);
  }

  document.addEventListener('mousedown', function(e) {
    if (e.detail === 2) {
      // 同一个元素的双击：撤销还没落账的那次单击
      if (pendingClick && pendingClick.el === e.target) {
        clearTimeout(pendingClick.timer);
        pendingClick = null;
      } else {
        flushClick();
      }
      record('dblclick', e.target);
      return;
    }
    if (e.detail !== 1) return;
    flushClick();
    var el = e.target;
    pendingClick = { el: el, timer: setTimeout(function() { pendingClick = null; emitClick(el); }, 220) };
  }, true);

  // 整页跳转不会留下机会给 220ms 的延时：卸载前先把待记的单击落账，
  // 否则「点个按钮跳走」这类最常见的步骤会凭空丢掉
  window.addEventListener('beforeunload', flushClick);
  window.addEventListener('pagehide', flushClick);

  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      scheduleFillRecord(el);
    }
  }, true);

  document.addEventListener('change', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      record('select', el, el.value);
    } else if ((tag === 'input' || tag === 'textarea') && el.value) {
      // change 触发时取消未决的防抖，避免重复录制
      cancelFillDebounce();
      record('fill', el, el.value);
    }
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && fillDebounceTarget) {
      var el = fillDebounceTarget;
      cancelFillDebounce();
      if (el.value) record('fill', el, el.value);
    }
  }, true);

  // blur 时若仍有未决防抖，立即落盘，避免漏录
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    if (fillDebounceTarget === el) {
      cancelFillDebounce();
      if (el.value) record('fill', el, el.value);
    }
  }, true);

  var scrollTimer = null;
  var lastScrollY = window.scrollY || window.pageYOffset;
  window.addEventListener('scroll', function() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function() {
      scrollTimer = null;
      var newY = window.scrollY || window.pageYOffset;
      var direction = newY >= lastScrollY ? 'down' : 'up';
      lastScrollY = newY;
      record('scroll', null, direction);
    }, 250);
  }, true);

  // SPA 路由变化实时监听：hook pushState/replaceState + popstate
  var lastHref = location.href;
  function emitNavigateIfChanged() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      record('navigate', null, location.href);
    }
  }

  window.addEventListener('popstate', emitNavigateIfChanged);

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() {
    var ret = origPushState.apply(this, arguments);
    emitNavigateIfChanged();
    return ret;
  };
  history.replaceState = function() {
    var ret = origReplaceState.apply(this, arguments);
    emitNavigateIfChanged();
    return ret;
  };
})();
`
