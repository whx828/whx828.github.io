/* =============================================================================
 * search.js —— 纯前端全文搜索（原生 JS，零依赖，中文友好）
 * 工作原理：
 *   1. 首次聚焦搜索框时，fetch 加载构建期生成的 /search-index.json
 *      （由 templates/search-index.json.html 生成，含标题/标签/摘要/全文）
 *   2. 对关键词做【不区分大小写的子串匹配】——中文没有分词问题，
 *      任意连续汉字都能命中，简单可靠
 *   3. 相关度排序：标题命中 > 标签命中 > 摘要命中 > 正文命中
 *   4. 结果实时渲染到下拉面板，关键词以 <mark> 高亮
 *   5. 键盘支持：↑/↓ 选择、Enter 跳转、Esc 关闭
 * 安全：所有插入 HTML 的文本都先经过转义，杜绝 XSS。
 * ========================================================================== */
(function () {
  'use strict';

  var input = document.getElementById('search-input');
  var panel = document.getElementById('search-results');
  if (!input || !panel) return; // 页面无搜索框时直接退出

  /* 索引数据缓存：Promise 缓存可保证多次聚焦只发一次请求 */
  var indexPromise = null;
  /* 当前展示的结果列表与键盘选中的下标 */
  var currentResults = [];
  var activeIndex = -1;

  /* ==========================================================================
   * 工具函数
   * ====================================================================== */

  /** HTML 转义：把特殊字符替换为实体，防止 XSS（渲染前必须调用） */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 正则特殊字符转义：关键词中的 . * + ? 等按字面量处理 */
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * HTML 实体解码：索引 JSON 的正文来自渲染后的 HTML（striptags 只去标签、
   * 不解码实体），其中含有 &quot; &amp; &#39; 等实体。利用 <textarea>
   * 的 RCDATA 特性安全解码（标签不会被当作 HTML 执行），把实体还原为
   * 原始字符，后续再做匹配与转义输出，避免"双重转义"显示 &quot; 字样。
   */
  var decodeArea = document.createElement('textarea');
  function decodeEntities(str) {
    if (!str || str.indexOf('&') === -1) return str;
    decodeArea.innerHTML = str;
    return decodeArea.value;
  }

  /** 对索引中的文本字段统一做实体解码（加载后执行一次） */
  function decodeIndex(index) {
    index.forEach(function (page) {
      page.title = decodeEntities(page.title);
      page.summary = decodeEntities(page.summary);
      page.content = decodeEntities(page.content);
      page.tags = (page.tags || []).map(decodeEntities);
    });
    return index;
  }

  /**
   * 高亮关键词：先转义文本，再把转义后的关键词包上 <mark>。
   * 不区分大小写；关键词为空时原样返回。
   */
  function highlight(escapedText, escapedKeyword) {
    if (!escapedKeyword) return escapedText;
    var re = new RegExp('(' + escapeRegExp(escapedKeyword) + ')', 'gi');
    return escapedText.replace(re, '<mark>$1</mark>');
  }

  /** 加载搜索索引（只请求一次，之后复用缓存） */
  function loadIndex() {
    if (!indexPromise) {
      var url = (window.SITE_CONFIG && window.SITE_CONFIG.searchIndexUrl) || '/search-index.json';
      indexPromise = fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('索引加载失败：HTTP ' + res.status);
          return res.json();
        })
        .then(decodeIndex) // 解码 HTML 实体（&quot; 等），见上方说明
        .catch(function (err) {
          // 失败时清空缓存，允许下次重试
          indexPromise = null;
          throw err;
        });
    }
    return indexPromise;
  }

  /* ==========================================================================
   * 搜索核心：返回按相关度排序的结果数组
   * 计分规则（命中即加分，多处命中累加）：
   *   标题 +10 / 标签 +6 / 摘要 +3 / 正文 +1
   * ====================================================================== */
  function search(index, keyword) {
    var kw = keyword.toLowerCase();
    var results = [];

    index.forEach(function (page) {
      var score = 0;
      var title = page.title || '';
      var summary = page.summary || '';
      var content = page.content || '';
      var tags = page.tags || [];

      if (title.toLowerCase().indexOf(kw) !== -1) score += 10;
      var matchedTags = tags.filter(function (t) {
        return t.toLowerCase().indexOf(kw) !== -1;
      });
      if (matchedTags.length > 0) score += 6 * matchedTags.length;
      if (summary.toLowerCase().indexOf(kw) !== -1) score += 3;
      if (content.toLowerCase().indexOf(kw) !== -1) score += 1;

      if (score > 0) {
        results.push({
          title: title,
          permalink: page.permalink,
          date: page.date || '',
          tags: tags,
          summary: summary,
          content: content,
          score: score
        });
      }
    });

    // 分数高者优先；同分按日期新者优先
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.date < b.date ? 1 : -1;
    });
    return results;
  }

  /**
   * 生成结果摘要片段：优先从正文命中位置截取前后各 ~45 字；
   * 正文未命中则退回使用文章摘要开头。
   */
  function makeSnippet(item, keyword) {
    var text = item.content || item.summary || '';
    var pos = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (pos === -1) {
      return item.summary.slice(0, 90);
    }
    var start = Math.max(0, pos - 45);
    var end = Math.min(text.length, pos + keyword.length + 45);
    var snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    return snippet;
  }

  /* ==========================================================================
   * 渲染
   * ====================================================================== */
  function render(results, keyword) {
    var escapedKw = escapeHtml(keyword);
    activeIndex = -1;
    currentResults = results;

    if (results.length === 0) {
      panel.innerHTML = '<div class="search-empty">没有找到与「' + escapedKw + '」相关的文章</div>';
      panel.hidden = false;
      return;
    }

    // 最多展示 8 条，避免面板过长
    var html = results.slice(0, 8).map(function (item, i) {
      var snippet = makeSnippet(item, keyword);
      return (
        '<a class="search-result-item" role="option" data-index="' + i + '" href="' + escapeHtml(item.permalink) + '">' +
          '<div class="search-result-title">' + highlight(escapeHtml(item.title), escapedKw) + '</div>' +
          '<div class="search-result-meta">' + escapeHtml(item.date) +
            (item.tags.length ? ' · ' + item.tags.map(function (t) { return '#' + escapeHtml(t); }).join(' ') : '') +
          '</div>' +
          '<div class="search-result-snippet">' + highlight(escapeHtml(snippet), escapedKw) + '</div>' +
        '</a>'
      );
    }).join('');

    panel.innerHTML = html;
    panel.hidden = false;
  }

  function closePanel() {
    panel.hidden = true;
    activeIndex = -1;
  }

  /* ==========================================================================
   * 事件绑定
   * ====================================================================== */

  // 输入事件：简单防抖 120ms，避免每次按键都全量搜索
  var debounceTimer = null;
  input.addEventListener('input', function () {
    var keyword = input.value.trim();
    clearTimeout(debounceTimer);
    if (!keyword) {
      closePanel();
      return;
    }
    debounceTimer = setTimeout(function () {
      loadIndex()
        .then(function (index) { render(search(index, keyword), keyword); })
        .catch(function () {
          panel.innerHTML = '<div class="search-empty">搜索索引加载失败，请检查网络后重试</div>';
          panel.hidden = false;
        });
    }, 120);
  });

  // 键盘导航：↓/↑ 移动选中项，Enter 跳转，Esc 关闭
  input.addEventListener('keydown', function (event) {
    if (panel.hidden) return;
    var items = panel.querySelectorAll('.search-result-item');
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault();
        window.location.href = items[activeIndex].getAttribute('href');
      }
      return;
    } else if (event.key === 'Escape') {
      closePanel();
      input.blur();
      return;
    } else {
      return;
    }
    // 更新选中态样式并滚动到可见位置
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
    if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
  });

  // 聚焦时若已有输入内容，重新打开面板
  input.addEventListener('focus', function () {
    if (input.value.trim() && currentResults.length > 0) {
      panel.hidden = false;
    }
  });

  // 点击页面其他位置时关闭面板
  document.addEventListener('click', function (event) {
    if (!panel.contains(event.target) && event.target !== input) {
      closePanel();
    }
  });
})();
