/* Reasonix × Wallpaper Engine —— 注入式壁纸面板
 *
 * 由 wallpaper 插件注入，纯 DOM 实现，不依赖 React、不改动原有逻辑。
 * 出错只会在控制台打一行 warn，绝不影响 Reasonix 本身。
 *
 * 依赖：同目录的 rx-wallpaper-data.js（由 apply.ps1 扫描 WE 库生成）
 *
 * 开关：面板里「关闭壁纸引擎」→ 按 Ctrl+Alt+W 重新唤出
 */
(function () {
  'use strict';

  try {
    if (window.__RXWP_LOADED__) return;
    window.__RXWP_LOADED__ = true;

    var DATA = window.__RXWP_DATA__ || [];
    if (!DATA.length) {
      console.warn('[rxwp] 没有读到壁纸数据（rx-wallpaper-data.js 未生成？）');
      return;
    }

    var STORE_KEY = 'rxwp.active.v1';
    var ENABLED_KEY = 'rxwp.enabled.v1';
    var PANEL_ID = 'rxwp-panel';
    var BG_ID = 'rxwp-bg';
    var BTN_ID = 'rxwp-btn';

    var TYPE_LABEL = { scene: '场景', video: '视频', web: '网页', application: '程序' };
    var byId = {};
    DATA.forEach(function (it) { byId[it.id] = it; });

    // 各面板底色的 RGB。不透明度由用户在面板里的滑块控制（默认 0.94）。
    // 必须用内联样式 + important，否则被 Reasonix 运行时注入的样式表盖掉。
    var COLOR = {
      '--bg': '7, 8, 11',
      '--bg-soft': '13, 17, 23',
      '--bg-elev': '20, 25, 34',
      '--bg-elev-2': '34, 38, 49',
      '--sidebar-bg': '10, 13, 18',
      '--chat-bg': '7, 8, 11',
      '--surface': '20, 25, 34',
      '--panel': '20, 25, 34'
    };
    // 各变量相对基准值的偏移：聊天区最透（壁纸直接露出），浮层稍实
    var DELTA = {
      '--bg': 0, '--bg-soft': 0.04, '--bg-elev': 0.10, '--bg-elev-2': 0.14,
      // 侧边栏压得比大背景更透，才能透过毛玻璃看见壁纸的色块
      '--sidebar-bg': -0.22, '--chat-bg': -0.34, '--surface': 0.10, '--panel': 0.10
    };
    // v5：再换 key，让旧的偏高数值失效
    var OPACITY_KEY = 'rxwp.opacity.v5';
    // 0.32：壁纸当主角。觉得看不清字就往右拖滑块。
    var OPACITY_DEFAULT = 0.32;

    function baseOpacity() {
      var v = parseFloat(localStorage.getItem(OPACITY_KEY));
      if (isNaN(v)) v = OPACITY_DEFAULT;
      return Math.min(1, Math.max(0.2, v));
    }

    function setThemeVars(on) {
      var root = document.documentElement;
      var keys = Object.keys(COLOR);
      if (!on) {
        keys.forEach(function (k) { try { root.style.removeProperty(k); } catch (_) {} });
        return;
      }
      var base = baseOpacity();
      keys.forEach(function (k) {
        var a = base + (DELTA[k] || 0);
        a = Math.min(1, Math.max(0.05, a));
        a = Math.round(a * 100) / 100;
        try { root.style.setProperty(k, 'rgba(' + COLOR[k] + ', ' + a + ')', 'important'); } catch (_) {}
      });
    }

    function linkEl() {
      return document.querySelector('link[data-rx-wallpaper]');
    }

    function setCssEnabled(on) {
      var l = linkEl();
      if (l) { try { l.disabled = !on; } catch (_) {} }
    }

    // ---------- 开关状态 ----------
    function isEnabled() {
      try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch (_) { return true; }
    }

    function setEnabled(on) {
      try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch (_) {}
      setCssEnabled(on);
      setThemeVars(on);
      if (on) {
        ensureBg();
        buildButton();
        restore();
      } else {
        ['rxwp-bg', 'rxwp-btn', 'rxwp-panel', 'rxwp-toast'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.remove();
        });
        panelEl = null;
        try { document.documentElement.removeAttribute('data-rxwp-active'); } catch (_) {}
      }
    }

    // ---------- 背景层 ----------
    function ensureBg() {
      var bg = document.getElementById(BG_ID);
      if (bg) return bg;
      bg = document.createElement('div');
      bg.id = BG_ID;
      var v = document.createElement('video');
      v.id = 'rxwp-video';
      v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      v.addEventListener('error', function () {
        toast('视频加载失败，可能被 file:// 限制拦截', true);
        console.warn('[rxwp] video error', v.getAttribute('src'));
      });
      var im = document.createElement('img');
      im.id = 'rxwp-image';
      im.alt = '';
      im.addEventListener('error', function () {
        toast('图片加载失败，可能被 file:// 限制拦截', true);
        console.warn('[rxwp] image error', im.getAttribute('src'));
      });
      bg.appendChild(v);
      bg.appendChild(im);
      document.body.appendChild(bg);
      return bg;
    }

    function getEls() {
      ensureBg();
      return {
        video: document.getElementById('rxwp-video'),
        image: document.getElementById('rxwp-image')
      };
    }

    function applyWallpaper(item, silent) {
      if (!item) return;
      var e = getEls();
      if (item.mediaKind === 'video') {
        e.image.style.display = 'none';
        e.image.removeAttribute('src');
        if (e.video.getAttribute('src') !== item.media) {
          e.video.setAttribute('src', item.media);
          e.video.load();
        }
        e.video.style.display = 'block';
        var p = e.video.play();
        if (p && p.catch) p.catch(function (err) {
          console.warn('[rxwp] play 被拒:', err && err.message);
        });
      } else {
        try { e.video.pause(); } catch (_) {}
        e.video.style.display = 'none';
        e.video.removeAttribute('src');
        e.image.style.display = 'block';
        e.image.src = item.media;
      }
      try { localStorage.setItem(STORE_KEY, item.id); } catch (_) {}
      document.documentElement.setAttribute('data-rxwp-active', item.id);
      if (!silent) toast('已换成「' + item.title + '」');
    }

    function restore() {
      var id = null;
      try { id = localStorage.getItem(STORE_KEY); } catch (_) {}
      if (id && byId[id]) applyWallpaper(byId[id], true);
    }

    // ---------- toast ----------
    var toastTimer = null;
    function toast(msg, isErr) {
      var t = document.getElementById('rxwp-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'rxwp-toast';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      // 内联兜底，避免样式表被禁用时完全看不见
      t.style.cssText = 'position:fixed;left:50%;bottom:74px;transform:translateX(-50%);' +
        'z-index:2147483600;padding:9px 16px;border-radius:10px;' +
        'background:rgba(16,34,42,.96);border:1px solid ' + (isErr ? 'rgba(224,105,106,.7)' : 'rgba(77,214,232,.5)') + ';' +
        'color:' + (isErr ? '#ffd7d9' : '#cdf6fd') + ';' +
        'font:12.5px/1.4 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.55);';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { if (t && t.parentNode) t.remove(); }, 3200);
    }

    // ---------- 面板 ----------
    var panelEl = null;
    var keyword = '';
    var typeFilter = '';

    function buildPanel() {
      if (panelEl) return panelEl;

      panelEl = document.createElement('div');
      panelEl.id = PANEL_ID;

      var head = document.createElement('div');
      head.className = 'rxwp-head';

      var title = document.createElement('div');
      title.className = 'rxwp-title';
      title.textContent = '壁纸引擎';
      var count = document.createElement('span');
      count.className = 'rxwp-count';
      count.textContent = DATA.length + ' 张';
      title.appendChild(count);

      var spacer = document.createElement('div');
      spacer.style.flex = '1';

      var tools = document.createElement('div');
      tools.className = 'rxwp-tools';

      var search = document.createElement('input');
      search.type = 'search';
      search.className = 'rxwp-search';
      search.placeholder = '搜索壁纸…';
      search.addEventListener('input', function () {
        keyword = search.value.trim().toLowerCase();
        renderGrid();
      });

      var sel = document.createElement('select');
      sel.className = 'rxwp-select';
      [['', '全部类型'], ['scene', '场景'], ['video', '视频']].forEach(function (p) {
        var o = document.createElement('option');
        o.value = p[0]; o.textContent = p[1];
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        typeFilter = sel.value;
        renderGrid();
      });

      var close = document.createElement('button');
      close.className = 'rxwp-close';
      close.type = 'button';
      close.textContent = '×';
      close.title = '关闭面板（Esc）';
      close.addEventListener('click', togglePanel);

      tools.appendChild(search);
      tools.appendChild(sel);
      tools.appendChild(close);
      head.appendChild(title);
      head.appendChild(spacer);
      head.appendChild(tools);

      var grid = document.createElement('div');
      grid.className = 'rxwp-grid';
      grid.id = 'rxwp-grid';

      var foot = document.createElement('div');
      foot.className = 'rxwp-foot';

      var hint = document.createElement('span');
      hint.style.flex = '1';
      hint.textContent = '点卡片即应用 · 视频直接播原片';

      // 不透明度滑块：壁纸太抢眼就往上拉
      var opacityWrap = document.createElement('label');
      opacityWrap.className = 'rxwp-opacity';
      var opacityText = document.createElement('span');
      opacityText.textContent = '不透明度';
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '20';
      slider.max = '100';
      slider.step = '1';
      slider.value = String(Math.round(baseOpacity() * 100));
      slider.title = '拖动调节面板不透明度，越大越实';
      var opacityValue = document.createElement('b');
      opacityValue.textContent = slider.value + '%';
      slider.addEventListener('input', function () {
        var v = Number(slider.value) / 100;
        try { localStorage.setItem(OPACITY_KEY, String(v)); } catch (_) {}
        opacityValue.textContent = slider.value + '%';
        setThemeVars(true);
      });
      opacityWrap.appendChild(opacityText);
      opacityWrap.appendChild(slider);
      opacityWrap.appendChild(opacityValue);

      var offBtn = document.createElement('button');
      offBtn.className = 'rxwp-off';
      offBtn.type = 'button';
      offBtn.textContent = '关闭壁纸引擎';
      offBtn.addEventListener('click', function () {
        setEnabled(false);
        toast('已关闭。按 Ctrl+Alt+W 可重新打开');
      });

      foot.appendChild(hint);
      foot.appendChild(opacityWrap);
      foot.appendChild(offBtn);

      panelEl.appendChild(head);
      panelEl.appendChild(grid);
      panelEl.appendChild(foot);
      document.body.appendChild(panelEl);
      return panelEl;
    }

    function currentId() {
      try { return localStorage.getItem(STORE_KEY); } catch (_) { return null; }
    }

    function renderGrid() {
      var grid = document.getElementById('rxwp-grid');
      if (!grid) return;
      var active = currentId();

      var rows = DATA.filter(function (it) {
        if (typeFilter && it.type !== typeFilter) return false;
        if (!keyword) return true;
        return (it.title || '').toLowerCase().indexOf(keyword) >= 0 ||
               it.id.indexOf(keyword) >= 0 ||
               (it.tags || []).join(',').toLowerCase().indexOf(keyword) >= 0;
      });

      grid.innerHTML = '';
      if (!rows.length) {
        var empty = document.createElement('div');
        empty.className = 'rxwp-empty';
        empty.textContent = '没有匹配的壁纸';
        grid.appendChild(empty);
        return;
      }

      var frag = document.createDocumentFragment();
      rows.forEach(function (it) {
        var card = document.createElement('div');
        card.className = 'rxwp-card' + (it.id === active ? ' rxwp-card--active' : '');
        card.setAttribute('data-id', it.id);
        card.title = (it.title || '') + '\n' + it.id + ' · ' + (TYPE_LABEL[it.type] || it.type);

        var thumbWrap = document.createElement('div');
        thumbWrap.className = 'rxwp-thumb';

        var img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = it.title || '';
        img.addEventListener('error', function () {
          img.style.display = 'none';
          var fb = document.createElement('div');
          fb.className = 'rxwp-nothumb';
          fb.textContent = '无法预览';
          thumbWrap.appendChild(fb);
        });
        img.src = it.thumb;
        thumbWrap.appendChild(img);

        var badge = document.createElement('span');
        badge.className = 'rxwp-badge rxwp-badge--' + it.type;
        badge.textContent = TYPE_LABEL[it.type] || it.type;
        thumbWrap.appendChild(badge);

        if (it.id === active) {
          var now = document.createElement('span');
          now.className = 'rxwp-now';
          now.textContent = '使用中';
          thumbWrap.appendChild(now);
        }

        var name = document.createElement('div');
        name.className = 'rxwp-name';
        name.textContent = it.title || it.id;

        card.appendChild(thumbWrap);
        card.appendChild(name);
        card.addEventListener('click', function () {
          applyWallpaper(it);
          renderGrid();
        });
        frag.appendChild(card);
      });
      grid.appendChild(frag);
    }

    // ---------- 入口：只有快捷键 ----------
    // 悬浮按钮已移除，改用 Ctrl+Alt+W 召唤。
    // 想恢复按钮的话，把下面 SHOW_BUTTON 改成 true 即可。
    var SHOW_BUTTON = false;
    var HINT_KEY = 'rxwp.hint.v1';

    function buildButton() {
      if (!SHOW_BUTTON) return;
      if (document.getElementById(BTN_ID)) return;
      var b = document.createElement('button');
      b.id = BTN_ID;
      b.type = 'button';
      b.title = '壁纸引擎（Ctrl+Alt+W）';
      b.setAttribute('aria-label', '壁纸引擎');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
        '<path fill="currentColor" d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Zm-1 14H4v-5.6l4.5-4.5 4 4 3-3L20 15v3Zm-3.5-8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';
      b.addEventListener('click', togglePanel);
      document.body.appendChild(b);
    }

    // 没有按钮了，第一次装完提示一次快捷键，否则用户不知道入口在哪
    function maybeShowHint() {
      if (SHOW_BUTTON) return;
      try {
        if (localStorage.getItem(HINT_KEY)) return;
        localStorage.setItem(HINT_KEY, '1');
      } catch (_) { return; }
      setTimeout(function () {
        toast('壁纸已就绪 · 按 Ctrl + Alt + W 打开面板');
      }, 1800);
    }

    function togglePanel() {
      if (!isEnabled()) setEnabled(true);
      buildPanel();
      var open = panelEl.classList.toggle('rxwp-panel--open');
      if (open) {
        renderGrid();
        var s = panelEl.querySelector('.rxwp-search');
        if (s) setTimeout(function () { s.focus(); }, 30);
      }
    }

    // ---------- 快捷键 ----------
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && panelEl && panelEl.classList.contains('rxwp-panel--open')) {
        panelEl.classList.remove('rxwp-panel--open');
        return;
      }
      if (ev.ctrlKey && ev.altKey && (ev.key === 'w' || ev.key === 'W' || ev.code === 'KeyW')) {
        ev.preventDefault();
        if (!isEnabled()) setEnabled(true);
        else if (panelEl && panelEl.classList.contains('rxwp-panel--open')) {
          panelEl.classList.remove('rxwp-panel--open');
          return;
        }
        buildButton();
        togglePanel();
      }
    });

    // ---------- 启动 ----------
    function boot() {
      setThemeVars(true);
      if (!isEnabled()) {
        setCssEnabled(false);
        setThemeVars(false);
        console.log('[rxwp] 已关闭（按 Ctrl+Alt+W 开启）');
        return;
      }
      ensureBg();
      buildButton();
      restore();
      maybeShowHint();
      console.log('[rxwp] 就绪，壁纸 ' + DATA.length + ' 张；Ctrl+Alt+W 打开面板');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
    } else {
      setTimeout(boot, 300);
    }
  } catch (err) {
    console.warn('[rxwp] 初始化失败（不影响 Reasonix）:', err);
  }
})();
