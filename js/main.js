/* =============================================================================
 * main.js —— 站点通用脚本（原生 JS，零依赖）
 * 功能清单：
 *   1. 昼/夜主题切换（写入 localStorage，与 <head> 内联脚本配合防闪烁）
 *   2. 移动端导航折叠/展开
 *   3. 顶部滚动阅读进度条
 *   4. IntersectionObserver 入场动画（.reveal → .visible）
 *   5. 文章页目录（TOC）自动生成：扫描正文 h2/h3
 *   6. 返回顶部按钮
 * 说明：所有功能都做了"元素不存在就跳过"的防御，任意页面缺失某些
 *       组件都不会报错；文件在 base.html 中以 defer 加载，DOM 已就绪。
 * ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
   * 1. 主题切换
   * 点击按钮在 light / dark 之间切换，并把选择写入 localStorage，
   * 下次访问时由 <head> 中的内联脚本在绘制前恢复，避免闪烁。
   * ====================================================================== */
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) {
        // localStorage 不可用时仅本次生效，静默忽略
      }
    });
  }

  /* ==========================================================================
   * 2. 移动端导航折叠
   * ====================================================================== */
  var navToggle = document.getElementById('nav-toggle');
  var siteNav = document.getElementById('site-nav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      navToggle.setAttribute('aria-label', expanded ? '打开导航菜单' : '关闭导航菜单');
      siteNav.classList.toggle('open', !expanded);
    });
    // 点击导航链接后自动收起（窄屏体验更好）
    siteNav.addEventListener('click', function (event) {
      if (event.target.tagName === 'A') {
        siteNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ==========================================================================
   * 3. 顶部滚动进度条 + 6. 返回顶部按钮（共用一个 scroll 监听，减少开销）
   * ====================================================================== */
  var progressBar = document.getElementById('scroll-progress');
  var backToTop = document.getElementById('back-to-top');

  function onScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;

    if (progressBar) {
      // 可滚动高度为 0 时（内容不足一屏）进度条置 0，避免除以 0
      var percent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      progressBar.style.width = percent + '%';
    }
    if (backToTop) {
      // 滚动超过约两屏后显示按钮
      var show = scrollTop > window.innerHeight * 1.5;
      backToTop.classList.toggle('show', show);
      backToTop.hidden = false; // 初始 hidden 属性在首次滚动后移除
    }
  }

  if (progressBar || backToTop) {
    // passive: true 告诉浏览器不会调用 preventDefault，滚动更流畅
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // 页面加载时先执行一次，刷新时进度条位置正确
  }

  if (backToTop) {
    backToTop.addEventListener('click', function () {
      // prefers-reduced-motion 用户使用瞬时滚动
      var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ==========================================================================
   * 4. 入场动画：IntersectionObserver 监测 .reveal 元素进入视口
   * ====================================================================== */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length > 0) {
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target); // 只播放一次
          }
        });
      }, {
        threshold: 0.12,        // 元素露出 12% 即触发
        rootMargin: '0px 0px -40px 0px' // 视口底部留一点提前量，更自然
      });
      revealEls.forEach(function (el) { observer.observe(el); });
    } else {
      // 老旧浏览器不支持 IntersectionObserver：直接全部显示
      revealEls.forEach(function (el) { el.classList.add('visible'); });
    }
  }

  /* ==========================================================================
   * 5. 文章目录（TOC）：扫描正文中的 h2 / h3，生成可点击的目录
   * 仅在文章页（存在 #post-content 与 #toc）时执行。
   * ====================================================================== */
  var postContent = document.getElementById('post-content');
  var toc = document.getElementById('toc');
  var tocList = document.getElementById('toc-list');
  if (postContent && toc && tocList) {
    var headings = postContent.querySelectorAll('h2, h3');
    if (headings.length >= 2) { // 至少两个标题才显示目录，避免鸡肋
      headings.forEach(function (heading, index) {
        // 标题没有 id 时自动生成一个（中文标题直接用序号最稳妥）
        if (!heading.id) {
          heading.id = 'heading-' + index;
        }
        var li = document.createElement('li');
        li.className = heading.tagName === 'H3' ? 'toc-h3' : 'toc-h2';
        var a = document.createElement('a');
        a.href = '#' + heading.id;
        a.textContent = heading.textContent;
        li.appendChild(a);
        tocList.appendChild(li);
      });
      toc.hidden = false; // 有内容后再显示目录容器
    }
  }
})();
