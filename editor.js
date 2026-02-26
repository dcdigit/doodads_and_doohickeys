// ══════════════════════════════════════════════════════
// Inline Editor — toggle with Ctrl+E
// Adds contenteditable to text elements, saves changes
// to localStorage, and can export a patch summary.
// Drop <script src="editor.js"></script> before </body>.
// ══════════════════════════════════════════════════════
(function() {
  'use strict';

  const STORAGE_KEY = 'portfolio-editor-edits';
  let active = false;
  let bar = null;

  // ── Editable selectors per page ──
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const isShop = PAGE === 'shop.html';

  const isIndex = PAGE === 'index.html' || PAGE === '';
  const isSubpage = !isIndex && !isShop;

  // ── Detect which elements are editable ──
  function getEditables() {
    if (isShop) {
      return document.querySelectorAll(
        '.shop-hero h1, .shop-hero p, .product-title, .product-price, .sold-badge, .product-link'
      );
    }
    if (isSubpage) {
      return document.querySelectorAll(
        '.content h1, .content h2, .content .tag, .content .meta, .content .description'
      );
    }
    return document.querySelectorAll(
      '.hero-subtitle, .row-title, .row-desc, .row-tag, .section-label'
    );
  }

  // ── Build a unique key for an element ──
  function elKey(el) {
    const tag = el.tagName.toLowerCase();
    const cls = el.className.split(' ').filter(c => c && c !== 'editable-active').join('.');
    // Walk up to find a parent with an identifiable attribute
    const row = el.closest('.project-row, .product-card');
    let prefix = PAGE;
    if (row) {
      const idx = [...row.parentElement.children].filter(
        c => c.classList.contains(row.classList[0])
      ).indexOf(row);
      prefix += ':' + row.classList[0] + '[' + idx + ']';
    }
    return prefix + ':' + cls + ':' + tag;
  }

  // ── Load saved edits from localStorage ──
  function loadEdits() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveEdits(edits) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  }

  // ── Apply saved edits to the page ──
  function applyEdits() {
    const edits = loadEdits();
    getEditables().forEach(el => {
      const key = elKey(el);
      if (edits[key] !== undefined) {
        el.textContent = edits[key];
        // Sync data-text for scramble effect on titles
        if (el.dataset.text !== undefined) {
          el.dataset.text = edits[key];
        }
      }
    });
  }

  // ── Block link navigation while editing ──
  function blockNav(e) {
    // Allow clicks on editor bar buttons
    if (e.target.closest('#editor-bar')) return;
    const link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ── Activate editor ──
  function activate() {
    active = true;
    document.body.classList.add('editor-on');
    document.addEventListener('click', blockNav, true);
    getEditables().forEach(el => {
      el.setAttribute('contenteditable', 'true');
      el.classList.add('editable-active');
      el.addEventListener('input', onEdit);
      el.addEventListener('keydown', onKey);
    });
    showBar();
  }

  // ── Deactivate editor ──
  function deactivate() {
    active = false;
    document.body.classList.remove('editor-on');
    document.removeEventListener('click', blockNav, true);
    getEditables().forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('editable-active');
      el.removeEventListener('input', onEdit);
      el.removeEventListener('keydown', onKey);
    });
    hideBar();
  }

  // ── Handle edits ──
  function onEdit(e) {
    const el = e.target;
    const edits = loadEdits();
    edits[elKey(el)] = el.textContent;
    saveEdits(edits);
    updateCounter();
    // Sync data-text
    if (el.dataset.text !== undefined) {
      el.dataset.text = el.textContent;
    }
  }

  function onKey(e) {
    // Prevent newlines in single-line elements
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.target.blur();
    }
  }

  // ── Toolbar ──
  function showBar() {
    if (bar) { bar.style.display = 'flex'; updateCounter(); return; }

    bar = document.createElement('div');
    bar.id = 'editor-bar';
    bar.innerHTML = `
      <style>
        #editor-bar {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: #111;
          border: 1px solid #444;
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 99999;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.72rem;
          color: #ccc;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          user-select: none;
        }
        #editor-bar .ed-label {
          color: #00ff88;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 0.65rem;
        }
        #editor-bar .ed-count {
          color: #888;
          font-size: 0.65rem;
        }
        #editor-bar button {
          background: #222;
          border: 1px solid #444;
          color: #ccc;
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 0.68rem;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        #editor-bar button:hover { border-color: #888; color: #fff; }
        #editor-bar button.ed-primary {
          background: #00ff88;
          color: #000;
          border-color: #00ff88;
          font-weight: 700;
        }
        #editor-bar button.ed-primary:hover {
          background: #00cc6a;
          border-color: #00cc6a;
        }
        #editor-bar .ed-sep {
          width: 1px;
          height: 20px;
          background: #333;
        }

        .editable-active {
          outline: 1px dashed rgba(0, 255, 136, 0.35) !important;
          outline-offset: 3px;
          cursor: text !important;
          border-radius: 2px;
        }
        .editable-active:focus {
          outline: 2px solid #00ff88 !important;
          background: rgba(0, 255, 136, 0.05);
        }

        .editor-on .project-row {
          pointer-events: auto !important;
        }
        .editor-on .project-row * {
          pointer-events: auto !important;
        }

        #editor-toast {
          position: fixed;
          bottom: 70px;
          left: 50%;
          transform: translateX(-50%);
          background: #1a1a1a;
          border: 1px solid #00ff88;
          color: #00ff88;
          padding: 8px 16px;
          border-radius: 6px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.72rem;
          z-index: 100000;
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
        }
        #editor-toast.show { opacity: 1; }
      </style>
      <span class="ed-label">Editor</span>
      <span class="ed-count" id="edCount"></span>
      <div class="ed-sep"></div>
      <button id="edExport" title="Copy all edits to clipboard as JSON">Copy Edits</button>
      <button id="edReset" title="Clear all saved edits">Reset</button>
      <button id="edClose" class="ed-primary" title="Ctrl+E to toggle">Done</button>
    `;
    document.body.appendChild(bar);

    // Toast element
    const toast = document.createElement('div');
    toast.id = 'editor-toast';
    document.body.appendChild(toast);

    document.getElementById('edExport').addEventListener('click', exportEdits);
    document.getElementById('edReset').addEventListener('click', resetEdits);
    document.getElementById('edClose').addEventListener('click', () => deactivate());
    updateCounter();
  }

  function hideBar() {
    if (bar) bar.style.display = 'none';
  }

  function updateCounter() {
    const el = document.getElementById('edCount');
    if (!el) return;
    const count = Object.keys(loadEdits()).length;
    el.textContent = count ? count + ' edit' + (count > 1 ? 's' : '') : 'no edits';
  }

  function showToast(msg) {
    const t = document.getElementById('editor-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  // ── Export edits as JSON to clipboard ──
  function exportEdits() {
    const edits = loadEdits();
    const keys = Object.keys(edits);
    if (keys.length === 0) {
      showToast('No edits to export');
      return;
    }
    // Format as readable summary
    const lines = keys.map(k => {
      const parts = k.split(':');
      const page = parts[0];
      const rest = parts.slice(1).join(' > ');
      return `[${page}] ${rest}\n  → "${edits[k]}"`;
    });
    const text = '=== Portfolio Edits ===\n\n' + lines.join('\n\n') +
      '\n\n=== Raw JSON ===\n' + JSON.stringify(edits, null, 2);

    navigator.clipboard.writeText(text).then(() => {
      showToast('Edits copied to clipboard');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Edits copied to clipboard');
    });
  }

  // ── Reset all edits ──
  function resetEdits() {
    if (!confirm('Clear all saved edits? This will reload the page with original content.')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // ── Keyboard shortcut: Ctrl+E ──
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      if (active) deactivate();
      else activate();
    }
  });

  // ── Apply any saved edits on load ──
  // Delay slightly to let shop.html render its products first
  if (isShop) {
    const observer = new MutationObserver(() => {
      if (document.querySelector('.product-card')) {
        observer.disconnect();
        applyEdits();
      }
    });
    observer.observe(document.getElementById('productGrid') || document.body, { childList: true });
  } else {
    applyEdits();
  }
})();
