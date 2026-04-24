const Parser = (() => {
  function tokenize(line) {
    const tokens = [];
    const state = {
      i: 0,
      cur: '',
      quote: null,
      depth: 0,
    };

    const pushToken = (raw, quoted) => tokens.push({ raw, quoted });
    const flushCur = () => {
      if (!state.cur.length) return;
      pushToken(state.cur, false);
      state.cur = '';
    };

    const handleQuoted = () => {
      const c = line[state.i];
      if (c === '\\' && state.i + 1 < line.length) {
        state.cur += (state.depth > 0 ? c : '') + line[state.i + 1];
        state.i += 2;
        return;
      }
      if (c === state.quote) {
        state.quote = null;
        if (state.depth === 0) {
          pushToken(state.cur, true);
          state.cur = '';
        } else {
          state.cur += c;
        }
        state.i++;
        return;
      }
      state.cur += c;
      state.i++;
    };

    const handleDepth = () => {
      const c = line[state.i];
      state.cur += c;
      if (c === '{' || c === '[') state.depth++;
      else if (c === '}' || c === ']') {
        state.depth--;
        if (state.depth === 0) {
          pushToken(state.cur, false);
          state.cur = '';
        }
      } else if (c === '"' || c === "'") {
        state.quote = c;
      }
      state.i++;
    };

    const handleTopLevel = () => {
      const c = line[state.i];
      if (c === '"' || c === "'") {
        flushCur();
        state.quote = c;
        state.i++;
        return;
      }
      if (c === '{' || c === '[') {
        flushCur();
        state.cur = c;
        state.depth = 1;
        state.i++;
        return;
      }
      if (/\s/.test(c)) {
        flushCur();
        state.i++;
        return;
      }
      state.cur += c;
      state.i++;
    };

    while (state.i < line.length) {
      if (state.quote) {
        handleQuoted();
        continue;
      }
      if (state.depth > 0) {
        handleDepth();
        continue;
      }
      handleTopLevel();
    }

    if (state.cur.length) pushToken(state.cur, state.quote !== null);
    return tokens;
  }

  function coerce(tok) {
    if (tok.quoted) return tok.raw;
    const s = tok.raw;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s); } catch {}
    }
    return s;
  }

  function parseCommand(line) {
    const t = tokenize(line.trim());
    if (!t.length) return null;
    return { method: t[0].raw, params: t.slice(1).map(coerce) };
  }

  return { tokenize, coerce, parseCommand };
})();

const Backend = (() => {
  async function rpc(method, params, wallet) {
    const body = { method, params };
    if (wallet) body.wallet = wallet;
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const { detail } = data;
      if (detail && typeof detail === 'object') {
        const { rpc_code, rpc_message } = detail;
        if (typeof detail.code === 'string') {
          const err = new Error(detail.code);
          err.i18n = { key: `errors.backend.${detail.code}`, vars: detail };
          throw err;
        }
        throw new Error(`RPC error ${rpc_code}: ${rpc_message}`);
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return data.result;
  }

  async function exec(command) {
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const { detail } = data;
      if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
        const err = new Error(detail.code);
        err.i18n = { key: `errors.backend.${detail.code}`, vars: detail };
        throw err;
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return data;
  }

  return { rpc, exec };
})();

const I18N_DEFAULT = 'en-GB';
const I18N_STORAGE_KEY = 'lang';
const I18N_COOKIE_KEY = 'lang';
const I18N_SUPPORTED = new Set(['en-GB', 'pt-BR']);
let i18n = null;
let currentLang = I18N_DEFAULT;

function getLangFromUrl() {
  const v = new URLSearchParams(globalThis.location?.search || '').get('lang');
  return I18N_SUPPORTED.has(v) ? v : null;
}

function getSavedLang() {
  try {
    const v = localStorage.getItem(I18N_STORAGE_KEY);
    return I18N_SUPPORTED.has(v) ? v : null;
  } catch {
    return null;
  }
}

function getCookie(name) {
  const raw = String(document.cookie || '');
  const parts = raw.split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (!k || k !== name) continue;
    return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

function getLangFromCookie() {
  const v = getCookie(I18N_COOKIE_KEY);
  return I18N_SUPPORTED.has(v) ? v : null;
}

function setSavedLang(lang) {
  try { localStorage.setItem(I18N_STORAGE_KEY, lang); } catch {}
}

function setLangCookie(lang) {
  const chosen = I18N_SUPPORTED.has(lang) ? lang : I18N_DEFAULT;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${I18N_COOKIE_KEY}=${encodeURIComponent(chosen)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

async function loadI18n(lang) {
  const chosen = I18N_SUPPORTED.has(lang) ? lang : I18N_DEFAULT;
  const r = await fetch(`/static/i18n/${chosen}.json`, { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  i18n = (r.ok && data && typeof data === 'object') ? data : {};
  currentLang = chosen;
  document.documentElement.lang = chosen;
  document.title = t('page.title');
}

function formatTemplate(s, vars) {
  return String(s).replaceAll(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''));
}

function getPath(obj, key) {
  return String(key || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, k) => (acc && Object.prototype.hasOwnProperty.call(acc, k) ? acc[k] : undefined), obj);
}

function t(key, vars) {
  const v = i18n ? getPath(i18n, key) : undefined;
  if (typeof v === 'string') return formatTemplate(v, vars);
  return String(key);
}

function tOptional(key, vars) {
  const v = i18n ? getPath(i18n, key) : undefined;
  if (typeof v === 'string') return formatTemplate(v, vars);
  return null;
}

function formatError(e) {
  const key = e?.i18n?.key;
  if (typeof key === 'string') return t(key, e?.i18n?.vars);
  if (e && typeof e === 'object' && 'message' in e) return String(e.message || '');
  return String(e);
}

const Shell = (() => {
  const BUILTINS = new Set([
    'ls','cat','cd','pwd','echo','grep','jq','curl','less','more','head','tail',
    'wc','find','sed','awk','env','which','whoami','date','sleep','clear',
    'tree','file','stat','df','du','tar','gzip','gunzip','base64','xxd','sort',
    'uniq','tr','cut','paste','tee','touch','mkdir','rmdir','rm','cp','mv',
    'chmod','chown','ln','ps','top','kill',
  ]);

  function isMetachar(c) {
    return c === '|' || c === '>' || c === '<' || c === ';' || c === '&' || c === '`';
  }

  function walkLine(line, onChar) {
    const state = { i: 0, quote: null, depth: 0, matched: false };

    const handleQuoted = () => {
      const c = line[state.i];
      if (c === '\\' && state.i + 1 < line.length) {
        state.i += 2;
        return;
      }
      if (c === state.quote) state.quote = null;
      state.i++;
    };

    const handleDepth = () => {
      const c = line[state.i];
      if (c === '{' || c === '[') state.depth++;
      else if (c === '}' || c === ']') state.depth--;
      else if (c === '"' || c === "'") state.quote = c;
      state.i++;
    };

    const handleTopLevel = () => {
      const c = line[state.i];
      if (c === '"' || c === "'") {
        state.quote = c;
        state.i++;
        return;
      }
      if (c === '{' || c === '[') {
        state.depth = 1;
        state.i++;
        return;
      }
      state.matched = onChar(c);
      state.i++;
    };

    while (state.i < line.length && !state.matched) {
      if (state.quote) {
        handleQuoted();
        continue;
      }
      if (state.depth > 0) {
        handleDepth();
        continue;
      }
      handleTopLevel();
    }

    return state.matched;
  }

  function hasMetachar(line) {
    return walkLine(line, isMetachar);
  }

  function shouldExec(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('!')) return true;
    if (hasMetachar(trimmed)) return true;
    const firstTokenMatch = trimmed.match(/^[^\s"']+/);
    if (!firstTokenMatch) return false;
    const first = firstTokenMatch[0];
    if (BUILTINS.has(first)) return true;
    return false;
  }

  return { shouldExec };
})();

// ============================================================================
// Pane: represents a single independent terminal
// ============================================================================
let nextPaneNum = 1;
let nextNodeId = 1;
const panes = new Map();   // id -> Pane
let activePaneId = null;
let layoutTree = null;     // root of the split tree

const snippetCommands = new Set();
const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

class Pane {
  constructor() {
    this.id = 'p' + nextNodeId++;
    this.num = nextPaneNum++;
    this.history = [];
    this.historyIdx = -1;
    this.vars = new Map();      // per-pane "shell" vars: NAME -> string
    this._lastWalletUsed = null; // used to show the wallet in the entry header
    this._buildDom();
  }

  _buildDom() {
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.id = this.id;

    const header = document.createElement('div');
    header.className = 'pane-header';

    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = t('terminal.title', { num: this.num });

    const dot = document.createElement('span');
    dot.className = 'wlabel';
    dot.textContent = '·';

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    const mkBtn = (action, titleText, iconText, labelText) => {
      const b = document.createElement('button');
      b.dataset.action = action;
      b.title = titleText;
      b.type = 'button';
      const icon = document.createElement('span');
      icon.className = 'item-icon';
      icon.textContent = iconText;
      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = labelText;
      b.appendChild(icon);
      b.appendChild(label);
      return b;
    };

    const splitMenu = document.createElement('details');
    splitMenu.className = 'split-menu';
    const splitMenuSummary = document.createElement('summary');
    splitMenuSummary.title = t('split.newTerminalTooltip');
    splitMenuSummary.className = 'window-btn plus';
    splitMenuSummary.textContent = '+';
    const splitMenuPop = document.createElement('div');
    splitMenuPop.className = 'split-menu-pop';
    const splitMenuTitle = document.createElement('div');
    splitMenuTitle.className = 'split-menu-title';
    splitMenuTitle.textContent = t('split.newTerminalTitle');
    splitMenuPop.appendChild(splitMenuTitle);
    splitMenuPop.appendChild(mkBtn('split-left', t('split.splitLeftTitle'), '←', t('split.splitLeftLabel')));
    splitMenuPop.appendChild(mkBtn('split-right', t('split.splitRightTitle'), '→', t('split.splitRightLabel')));
    splitMenuPop.appendChild(mkBtn('split-up', t('split.splitUpTitle'), '↑', t('split.splitUpLabel')));
    splitMenuPop.appendChild(mkBtn('split-down', t('split.splitDownTitle'), '↓', t('split.splitDownLabel')));
    splitMenu.appendChild(splitMenuSummary);
    splitMenu.appendChild(splitMenuPop);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.classList.add('window-btn');
    closeBtn.dataset.action = 'close';
    closeBtn.title = t('split.closePaneTitle');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';

    header.appendChild(title);
    header.appendChild(dot);
    header.appendChild(spacer);
    header.appendChild(splitMenu);
    header.appendChild(closeBtn);

    const output = document.createElement('div');
    output.className = 'pane-output';

    const inputRow = document.createElement('div');
    inputRow.className = 'pane-input-row';

    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.textContent = 'bitcoin-cli #';

    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;

    const inputWrap = document.createElement('div');
    inputWrap.className = 'input-wrap';

    const ghost = document.createElement('div');
    ghost.className = 'autocomplete-ghost';
    const ghostSuffix = document.createElement('span');
    ghostSuffix.className = 'ghost-suffix';
    ghost.appendChild(ghostSuffix);

    inputWrap.appendChild(ghost);
    inputWrap.appendChild(input);

    inputRow.appendChild(prompt);
    inputRow.appendChild(inputWrap);

    el.appendChild(header);
    el.appendChild(output);
    el.appendChild(inputRow);

    this.el = el;
    this.outputEl = output;
    this.inputEl = input;
    this.ghostSuffixEl = ghostSuffix;
    this.autocomplete = { active: null, list: [] };

    // Focus activates the pane
    el.addEventListener('mousedown', () => setActive(this.id));
    this.inputEl.addEventListener('focus', () => setActive(this.id));

    // Header actions
    el.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const { action } = b.dataset;
        if (action === 'close') closePane(this.id);
        else if (action.startsWith('split-')) {
          splitPane(this.id, action.slice('split-'.length));
          const m = b.closest('details.split-menu');
          if (m) m.removeAttribute('open');
        }
      });
    });

    this.applyI18n();
    this.inputEl.addEventListener('keydown', (e) => { void this._handleKeydown(e); });

    this.inputEl.addEventListener('input', () => this._updateAutocomplete());
    this.inputEl.addEventListener('scroll', () => this._updateAutocomplete());

    // Multi-line paste: paste a whole script and run it line by line
    this.inputEl.addEventListener('paste', async (e) => {
      const cd = e.clipboardData || globalThis.clipboardData;
      if (!cd) return;
      const text = cd.getData('text');
      if (!text?.includes('\n')) return;
      e.preventDefault();
      this.inputEl.value = '';
      this._setHint('', '');
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        this.history.push(line);
        await this.processLine(line);
      }
      this.historyIdx = this.history.length;
    });

    // Initial banner
    this.write(
      t('terminal.ready', { num: this.num }),
      null,
      '',
      true
    );
  }

  applyI18n() {
    const titleEl = this.el.querySelector('.pane-title');
    if (titleEl) titleEl.textContent = t('terminal.title', { num: this.num });

    const splitSummary = this.el.querySelector('details.split-menu > summary');
    if (splitSummary) splitSummary.title = t('split.newTerminalTooltip');

    const splitTitle = this.el.querySelector('.split-menu-title');
    if (splitTitle) splitTitle.textContent = t('split.newTerminalTitle');

    const setAction = (action, titleKey, labelKey) => {
      const btn = this.el.querySelector(`[data-action="${action}"]`);
      if (!btn) return;
      btn.title = t(titleKey);
      const label = btn.querySelector('.item-label');
      if (label) label.textContent = t(labelKey);
    };

    setAction('split-left', 'split.splitLeftTitle', 'split.splitLeftLabel');
    setAction('split-right', 'split.splitRightTitle', 'split.splitRightLabel');
    setAction('split-up', 'split.splitUpTitle', 'split.splitUpLabel');
    setAction('split-down', 'split.splitDownTitle', 'split.splitDownLabel');

    const closeBtn = this.el.querySelector('[data-action="close"]');
    if (closeBtn) closeBtn.title = t('split.closePaneTitle');
  }

  async _handleKeydown(e) {
    if (e.key === 'Enter') return await this._handleEnter();
    if (e.key === 'ArrowUp') return this._handleHistoryUp(e);
    if (e.key === 'ArrowDown') return this._handleHistoryDown(e);
    if (e.key === 'l' && e.ctrlKey) return this._handleCtrlL(e);
    if (e.key === 'Tab') return this._handleAutocompleteKey(e);
    if (e.key === 'ArrowRight') return this._handleAutocompleteKey(e);
  }

  async _handleEnter() {
    const line = this.inputEl.value;
    if (!line.trim()) return;
    this.history.push(line);
    this.historyIdx = this.history.length;
    this.inputEl.value = '';
    this._setHint('', '');
    await this.processLine(line);
  }

  _handleHistoryUp(e) {
    e.preventDefault();
    if (this.historyIdx <= 0) return;
    this.historyIdx--;
    this.inputEl.value = this.history[this.historyIdx];
    this._updateAutocomplete();
  }

  _handleHistoryDown(e) {
    e.preventDefault();
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.inputEl.value = this.history[this.historyIdx];
      this._updateAutocomplete();
      return;
    }
    this.historyIdx = this.history.length;
    this.inputEl.value = '';
    this._updateAutocomplete();
  }

  _handleCtrlL(e) {
    e.preventDefault();
    this.outputEl.replaceChildren();
    this._updateAutocomplete();
  }

  _handleAutocompleteKey(e) {
    const applied = this._applyAutocomplete();
    if (applied) e.preventDefault();
  }

  _setHint(prefix, suffix) {
    if (!this.ghostSuffixEl) return;
    this.ghostSuffixEl.textContent = suffix || '';
    this.ghostSuffixEl.style.left = `${this._measureOffset(prefix || '')}px`;
    this.ghostSuffixEl.style.transform = `translateX(${-this.inputEl.scrollLeft}px)`;
  }

  _measureOffset(text) {
    if (!measureCtx) return 0;
    const cs = getComputedStyle(this.inputEl);
    measureCtx.font = cs.font;
    let w = measureCtx.measureText(text).width;
    const ls = cs.letterSpacing;
    if (ls && ls !== 'normal') {
      const px = Number.parseFloat(ls);
      if (Number.isFinite(px) && text.length > 1) w += (text.length - 1) * px;
    }
    const padLeft = Number.parseFloat(cs.paddingLeft || '0');
    const base = Number.isFinite(padLeft) ? padLeft : 0;
    return Math.ceil(base + w + 0.5);
  }

  _updateAutocomplete() {
    if (!this.ghostSuffixEl) return;
    const raw = this.inputEl.value || '';
    const cursor = this.inputEl.selectionStart ?? raw.length;
    if (cursor !== raw.length) {
      this.autocomplete = { active: null, list: [] };
      this._setHint('', '');
      return;
    }
    if (!/^\s*\S*$/.test(raw)) {
      this.autocomplete = { active: null, list: [] };
      this._setHint('', '');
      return;
    }

    const leading = /^\s*/.exec(raw)?.[0] ?? '';
    const base = raw.slice(leading.length);
    if (!base) {
      this.autocomplete = { active: null, list: [] };
      this._setHint('', '');
      return;
    }

    const list = Array.from(snippetCommands)
      .filter((c) => c.startsWith(base))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    const active = list[0] || null;
    this.autocomplete = { active, list };

    if (!active || active === base) {
      this._setHint('', '');
      return;
    }
    const full = leading + active;
    const suffix = full.slice(raw.length);
    this._setHint(raw, suffix);
  }

  _applyAutocomplete() {
    const raw = this.inputEl.value || '';
    const cursor = this.inputEl.selectionStart ?? raw.length;
    if (cursor !== raw.length) return false;
    if (!/^\s*\S*$/.test(raw)) return false;

    const leading = /^\s*/.exec(raw)?.[0] ?? '';
    const base = raw.slice(leading.length);
    const { active } = this.autocomplete;
    if (!active || !base || active === base || !active.startsWith(base)) return false;

    this.inputEl.value = leading + active;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
    this._setHint('', '');
    return true;
  }

  write(line, walletUsed, result, ok) {
    const div = document.createElement('div');
    div.className = 'entry';
    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = line;
    div.appendChild(cmd);
    if (walletUsed) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `wallet=${walletUsed}`;
      div.appendChild(meta);
    }
    const out = document.createElement('div');
    out.className = 'result ' + (ok ? 'ok' : 'err');
    if (typeof result === 'string') out.textContent = result;
    else if (result === null || result === undefined) {
      out.textContent = ok ? t('result.noReturn') : t('result.noErrorDetail');
    }
    else out.textContent = JSON.stringify(result, null, 2);
    div.appendChild(out);
    this.outputEl.appendChild(div);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  // --------------------------------------------------------------------- //
  // Shell-style execution
  // --------------------------------------------------------------------- //

  /**
   * Main dispatcher: receives a raw line typed by the user.
   * Decides between comment, variable assignment, or command.
   */
  async processLine(line) {
    const trimmed = line.replaceAll('\r', '').trim();
    if (!trimmed) return;

    if (trimmed === 'clear') {
      this.outputEl.replaceChildren();
      return;
    }

    // comment
    if (trimmed.startsWith('#')) {
      this._writeComment(line);
      return;
    }

    // assignment: NAME=... (bash-style)
    const assign = trimmed.match(/^([A-Za-z_]\w*)=(.*)$/);
    if (assign) {
      await this._handleAssignment(line, assign[1], assign[2]);
      return;
    }

    // regular command
    await this._runCommand(line);
  }

  _writeComment(line) {
    const div = document.createElement('div');
    div.className = 'entry comment';
    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = line;
    div.appendChild(cmd);
    this.outputEl.appendChild(div);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  /**
   * Expands $(...) first (subshell), then $VAR and ${VAR}.
   * Returns the string with all expansions applied.
   */
  async _substituteVars(text) {
    const withSub = await this._expandSubshells(text);
    return this._expandSimpleVars(withSub);
  }

  async _expandSubshells(text) {
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '$' || text[i + 1] !== '(') {
        out += text[i++];
        continue;
      }

      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0) throw new Error(t('errors.subshellUnclosed'));

      const inner = text.slice(i + 2, j);
      const result = await this._runInner(inner);
      out += this._stringifyForSub(result);
      i = j + 1;
    }
    return out;
  }

  _expandSimpleVars(text) {
    let out = text;
    out = out.replaceAll(
      /\$\{([A-Za-z_]\w*)\}/g,
      (_, n) => this.vars.get(n) ?? ''
    );
    out = out.replaceAll(
      /\$([A-Za-z_]\w*)/g,
      (_, n) => this.vars.get(n) ?? ''
    );
    return out;
  }

  _stringifyForSub(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  async _handleAssignment(rawLine, name, rhs) {
    rhs = rhs.trim();
    let value;
    try {
      if (rhs.startsWith('$(') && rhs.endsWith(')')) {
        // NAME=$(cmd) captures the subcommand result.
        // If the subcommand goes to exec, capture stdout (trim trailing newlines).
        const inner = rhs.slice(2, -1);
        if (Shell.shouldExec(inner)) {
          const cmdLine = this._unwrapExec(inner);
          const r = await Backend.exec(cmdLine);
          value = (r.stdout || '').replace(/\n+$/, '');
          if (r.exit_code !== 0) this._writeExecEntry(cmdLine, r);
        } else {
          const result = await this._runInner(inner);
          value = this._stringifyForSub(result);
        }
      } else if (
        (rhs.startsWith('"') && rhs.endsWith('"')) ||
        (rhs.startsWith("'") && rhs.endsWith("'"))
      ) {
        value = await this._substituteVars(rhs.slice(1, -1));
      } else {
        value = await this._substituteVars(rhs);
      }
    } catch (e) {
      this._writeEntry(rawLine, null, formatError(e), false, 'cmd');
      return;
    }
    this.vars.set(name, value);
    this._writeEntry(rawLine, null, `${name}=${value}`, true, 'assign');
  }

  // Removes the "!" prefix when present (explicit exec override)
  _unwrapExec(line) {
    const t = line.trimStart();
    return t.startsWith('!') ? t.slice(1).trimStart() : t;
  }

  _formatRpcDisplay(line) {
    const t = (line || '').trim();
    if (!t) return '';
    return t.startsWith('bitcoin-cli') ? t : `bitcoin-cli -regtest ${t}`;
  }

  _stringifyCliArg(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  _formatRpcRequestDisplay(req) {
    const parts = ['bitcoin-cli', '-regtest'];
    if (req.wallet) parts.push(`-rpcwallet=${this._stringifyCliArg(req.wallet)}`);
    parts.push(req.method);
    for (const p of req.params || []) parts.push(this._stringifyCliArg(p));
    return parts.join(' ');
  }

  async _runCommand(rawLine) {
    // 1) Substitute variables
    let line;
    try {
      line = await this._substituteVars(rawLine);
    } catch (e) {
      this._writeEntry(rawLine, null, formatError(e), false, 'cmd');
      return;
    }

    // 2) Route selection
    if (Shell.shouldExec(line)) {
      try {
        const cmdLine = this._unwrapExec(line);
        const r = await Backend.exec(cmdLine);
        this._writeExecEntry(cmdLine, r);
      } catch (e) {
        this._writeEntry(this._unwrapExec(line), null, formatError(e), false, 'exec');
      }
      return;
    }

    // 3) RPC (default path)
    try {
      const tokens = this._prepareRpcTokens(line);
      const req = this._parseRpcRequest(tokens);
      this._lastWalletUsed = req.wallet;

      if (req.generateN !== null) {
        if (!req.wallet) throw new Error(t('errors.generateNeedsWallet'));
        const addr = await Backend.rpc('getnewaddress', [], req.wallet);
        const result = await Backend.rpc('generatetoaddress', [req.generateN, addr], req.wallet);
        const display = `bitcoin-cli -regtest -rpcwallet=${this._stringifyCliArg(req.wallet)} generatetoaddress ${this._stringifyCliArg(req.generateN)} ${this._stringifyCliArg(addr)}`;
        this._writeEntry(display, this._lastWalletUsed, result, true, 'cmd');
        return;
      }

      const display = this._formatRpcRequestDisplay(req);
      const result = await Backend.rpc(req.method, req.params, req.wallet);
      this._writeEntry(display, this._lastWalletUsed, result, true, 'cmd');
    } catch (e) {
      const display = this._formatRpcDisplay(line);
      this._writeEntry(display, this._lastWalletUsed, formatError(e), false, 'cmd');
    }
  }

  _writeExecEntry(cmdLine, r) {
    // r = { stdout, stderr, exit_code, truncated }
    const div = document.createElement('div');
    div.className = 'entry exec';
    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = cmdLine;
    div.appendChild(cmd);

    if (r.stdout) {
      const so = document.createElement('div');
      so.className = 'stdout';
      so.textContent = r.stdout.replace(/\n+$/, '');
      div.appendChild(so);
    }
    if (r.stderr) {
      const se = document.createElement('div');
      se.className = 'stderr';
      se.textContent = r.stderr.replace(/\n+$/, '');
      div.appendChild(se);
    }
    if (r.truncated) {
      const truncEl = document.createElement('div');
      truncEl.className = 'truncated';
      truncEl.textContent = t('exec.truncated');
      div.appendChild(truncEl);
    }
    const ex = document.createElement('div');
    ex.className = 'exit ' + (r.exit_code === 0 ? '' : 'bad');
    ex.textContent = t('exec.exit', { code: r.exit_code });
    div.appendChild(ex);

    this.outputEl.appendChild(div);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  /**
   * Runs a single command line (already with vars expanded) and returns the raw
   * RPC result. Also processes bitcoin-cli-style flags.
   * Does not write to output; the caller is responsible for that.
   */
  async _runInner(line) {
    const tokens = this._prepareRpcTokens(line);
    const req = this._parseRpcRequest(tokens);
    this._lastWalletUsed = req.wallet;
    if (req.generateN !== null) return await this._runGenerate(req.generateN, req.wallet);
    return await Backend.rpc(req.method, req.params, req.wallet);
  }

  _prepareRpcTokens(line) {
    const tokens = Parser.tokenize(line.trim());
    if (!tokens.length) throw new Error(t('errors.emptyCommand'));
    if (!tokens[0].quoted && tokens[0].raw === 'bitcoin-cli') tokens.shift();
    return tokens;
  }

  _parseRpcRequest(tokens) {
    const parsed = this._parseRpcFlags(tokens);
    const wallet = parsed.walletOverride || null;
    if (!parsed.rest.length) throw new Error(t('errors.noMethod'));
    const method = parsed.rest[0].raw;
    const params = parsed.rest.slice(1).map(Parser.coerce);
    return { wallet, method, params, generateN: parsed.generateN };
  }

  _parseGenerateFlag(tokens, i) {
    const next = tokens[i + 1];
    if (next && !next.quoted && /^\d+$/.test(next.raw)) {
      return { generateN: Number.parseInt(next.raw, 10), consumed: 1 };
    }
    return { generateN: 1, consumed: 0 };
  }

  _parseRpcFlags(tokens) {
    let walletOverride = null;
    let generateN = null;
    const rest = [];

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.quoted || !t.raw.startsWith('-')) {
        rest.push(t);
        continue;
      }
      const flag = t.raw;
      if (
        flag === '-regtest' ||
        flag === '-signet' ||
        flag === '-testnet' ||
        flag === '-testnet4' ||
        flag === '-named'
      ) {
        continue;
      }
      if (
        flag.startsWith('-rpcuser=') ||
        flag.startsWith('-rpcpassword=') ||
        flag.startsWith('-rpcconnect=') ||
        flag.startsWith('-rpcport=')
      ) {
        continue;
      }
      if (
        flag === '-rpcuser' ||
        flag === '-rpcpassword' ||
        flag === '-rpcconnect' ||
        flag === '-rpcport'
      ) {
        i++;
        continue;
      }
      if (flag.startsWith('-rpcwallet=')) {
        walletOverride = flag.slice('-rpcwallet='.length);
        continue;
      }
      if (flag === '-rpcwallet') {
        walletOverride = tokens[++i]?.raw ?? null;
        continue;
      }
      if (flag === '-generate') {
        const r = this._parseGenerateFlag(tokens, i);
        generateN = r.generateN;
        i += r.consumed;
      }
    }

    return { rest, walletOverride, generateN };
  }

  async _runGenerate(generateN, wallet) {
    if (!wallet) {
      throw new Error(t('errors.generateNeedsWallet'));
    }
    const addr = await Backend.rpc('getnewaddress', [], wallet);
    return await Backend.rpc('generatetoaddress', [generateN, addr], wallet);
  }

  _writeEntry(line, walletUsed, result, ok, kind) {
    const div = document.createElement('div');
    div.className = 'entry ' + (kind || '');
    const cmd = document.createElement('div');
    cmd.className = 'cmd';
    cmd.textContent = kind === 'cmd' ? this._formatRpcDisplay(line) : line;
    div.appendChild(cmd);
    if (walletUsed) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `wallet=${walletUsed}`;
      div.appendChild(meta);
    }
    const out = document.createElement('div');
    out.className = 'result ' + (ok ? 'ok' : 'err');
    if (typeof result === 'string') out.textContent = result;
    else if (result === null || result === undefined) {
      out.textContent = ok ? t('result.noReturn') : t('result.noErrorDetail');
    }
    else out.textContent = JSON.stringify(result, null, 2);
    div.appendChild(out);
    this.outputEl.appendChild(div);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  focus() { this.inputEl.focus(); }
}

// ============================================================================
// Layout tree
//   leaf:  { type: 'leaf',  id, paneId }
//   split: { type: 'split', id, dir: 'horizontal'|'vertical',
//            children: [node, node], sizes: [number, number] }
// ============================================================================
function newLeaf(paneId)        { return { type: 'leaf',  id: 'n' + nextNodeId++, paneId }; }
function newSplit(dir, a, b)    { return { type: 'split', id: 'n' + nextNodeId++, dir, children: [a, b], sizes: [1, 1] }; }

function findParent(node, targetId, parent = null) {
  if (!node) return null;
  if (node.id === targetId) return { parent, node };
  if (node.type === 'split') {
    for (const c of node.children) {
      const r = findParent(c, targetId, node);
      if (r) return r;
    }
  }
  return null;
}

function findLeafByPane(node, paneId) {
  if (!node) return null;
  if (node.type === 'leaf' && node.paneId === paneId) return node;
  if (node.type === 'split') {
    for (const c of node.children) {
      const r = findLeafByPane(c, paneId);
      if (r) return r;
    }
  }
  return null;
}

function firstPaneId(node) {
  if (!node) return null;
  if (node.type === 'leaf') return node.paneId;
  return firstPaneId(node.children[0]);
}

// Splits an existing pane in one of the 4 directions and creates a new pane.
function splitPane(paneId, direction) {
  const leafInfo = (() => {
    if (layoutTree.type === 'leaf' && layoutTree.paneId === paneId) {
      return { parent: null, node: layoutTree };
    }
    return findParent(layoutTree, findLeafByPane(layoutTree, paneId).id);
  })();
  if (!leafInfo) return;

  const newPane = new Pane();
  panes.set(newPane.id, newPane);
  const newLeafNode = newLeaf(newPane.id);

  // direction -> dir + position (does newLeaf come before or after?)
  // 'right' => vertical, new on the right (children: [old, new])
  // 'left'  => vertical, new on the left  (children: [new, old])
  // 'down'  => horizontal, new below      (children: [old, new])
  // 'up'    => horizontal, new above      (children: [new, old])
  const dirMap = {
    right: { dir: 'vertical',   newFirst: false },
    left:  { dir: 'vertical',   newFirst: true  },
    down:  { dir: 'horizontal', newFirst: false },
    up:    { dir: 'horizontal', newFirst: true  },
  };
  const { dir, newFirst } = dirMap[direction];

  const oldLeafNode = leafInfo.node;
  const newSplitNode = newFirst
    ? newSplit(dir, newLeafNode, oldLeafNode)
    : newSplit(dir, oldLeafNode, newLeafNode);

  if (leafInfo.parent === null) {
    layoutTree = newSplitNode;
  } else {
    const idx = leafInfo.parent.children.indexOf(oldLeafNode);
    leafInfo.parent.children[idx] = newSplitNode;
  }

  renderLayout();
  setActive(newPane.id);
}

function closePane(paneId) {
  if (panes.size <= 1) {
    // Do not allow closing the last pane (keep at least one)
    return;
  }
  const leaf = findLeafByPane(layoutTree, paneId);
  if (!leaf) return;
  const info = findParent(layoutTree, leaf.id);
  // Case 1: leaf is the root (= only pane) — blocked by the size check above
  if (!info || info.parent === null) return;

  const { parent } = info;
  const [a, b] = parent.children;
  const sibling = a === leaf ? b : a;

  // Replace the split parent with the sibling (collapse one level)
  const grand = findParent(layoutTree, parent.id);
  if (!grand || grand.parent === null) {
    // parent is the root
    layoutTree = sibling;
  } else {
    const idx = grand.parent.children.indexOf(parent);
    grand.parent.children[idx] = sibling;
  }

  panes.delete(paneId);
  renderLayout();

  // Focus goes to the first pane inside sibling (or any other)
  const next = firstPaneId(layoutTree);
  if (next) setActive(next);
}

function setActive(paneId) {
  if (activePaneId === paneId) {
    panes.get(paneId)?.focus();
    return;
  }
  if (activePaneId && panes.has(activePaneId)) {
    panes.get(activePaneId).el.classList.remove('active');
  }
  activePaneId = paneId;
  const p = panes.get(paneId);
  if (p) {
    p.el.classList.add('active');
    p.focus();
  }
}

// ============================================================================
// Render layout: rebuild the DOM tree while reusing existing pane elements
// ============================================================================
const $workspace = document.getElementById('workspace');

function renderLayout() {
  // Remove panes from the current DOM without destroying them (they will be reattached)
  panes.forEach(p => { if (p.el.parentNode) p.el.remove(); });
  $workspace.replaceChildren();
  if (!layoutTree) return;
  $workspace.appendChild(buildNodeDom(layoutTree));
}

function buildNodeDom(node) {
  if (node.type === 'leaf') {
    return panes.get(node.paneId).el;
  }
  // split
  const el = document.createElement('div');
  el.className = 'split ' + node.dir;
  el.dataset.id = node.id;

  const a = buildNodeDom(node.children[0]);
  const b = buildNodeDom(node.children[1]);
  a.style.flexGrow = node.sizes[0];
  b.style.flexGrow = node.sizes[1];
  a.style.flexBasis = '0';
  b.style.flexBasis = '0';

  const div = document.createElement('div');
  div.className = 'divider';
  attachDividerDrag(div, node, el);

  el.appendChild(a);
  el.appendChild(div);
  el.appendChild(b);
  return el;
}

// ============================================================================
// Resizable dividers
// ============================================================================
function attachDividerDrag(divider, splitNode, splitEl) {
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    divider.classList.add('dragging');
    const rect = splitEl.getBoundingClientRect();
    const isVertical = splitNode.dir === 'vertical';
    const total = isVertical ? rect.width : rect.height;
    const start = isVertical ? rect.left : rect.top;

    const onMove = (ev) => {
      const pos = (isVertical ? ev.clientX : ev.clientY) - start;
      const ratio = Math.min(0.95, Math.max(0.05, pos / total));
      splitNode.sizes = [ratio, 1 - ratio];
      const a = splitEl.children[0];
      const b = splitEl.children[2];
      a.style.flexGrow = splitNode.sizes[0];
      b.style.flexGrow = splitNode.sizes[1];
    };
    const onUp = () => {
      divider.classList.remove('dragging');
      globalThis.removeEventListener('mousemove', onMove);
      globalThis.removeEventListener('mouseup', onUp);
    };
    globalThis.addEventListener('mousemove', onMove);
    globalThis.addEventListener('mouseup', onUp);
  });
}

// ============================================================================
// Sidebar: clickable snippets are injected into the active pane
// ============================================================================
const $sidebar = document.getElementById('sidebar');
const $sidebarResizer = document.getElementById('sidebar-resizer');
const $snippetsTitle = document.getElementById('snippets-title');
const $snippetSearch = document.getElementById('snippet-search');
const $snippetList = document.getElementById('snippet-list');
const $toggleSnippets = document.getElementById('btn-toggle-snippets');
const $helpGroup = document.getElementById('help-group');
const $helpToggle = document.getElementById('help-toggle');
const $helpTitle = document.getElementById('help-title');
const $helpCards = document.getElementById('help-cards');
const $langMenu = document.getElementById('lang-menu');
const $langMenuBtn = document.getElementById('lang-menu-btn');
const $langMenuPop = document.getElementById('lang-menu-pop');
const $langFlag = document.getElementById('lang-flag');
const $langLabelEn = document.getElementById('lang-label-en');
const $langLabelPt = document.getElementById('lang-label-pt');
const $langOptions = $langMenuPop ? Array.from($langMenuPop.querySelectorAll('button.lang-option[data-lang]')) : [];
const $githubLink = document.getElementById('github-link');
const $logo = document.querySelector('.topbar .logo');
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 560;
let lastExpandedSidebarWidth = null;
const snippetGroups = new Map();
const HELP_COLLAPSE_KEY = 'helpCollapsed';

function applyI18nLangMenu() {
  if ($langMenuBtn) {
    $langMenuBtn.title = t('topbar.languageTitle');
    $langMenuBtn.setAttribute('aria-label', t('topbar.languageTitle'));
  }
  if ($langFlag) $langFlag.textContent = currentLang === 'pt-BR' ? '🇧🇷' : '🇬🇧';
  if ($langLabelEn) $langLabelEn.textContent = t('topbar.langEnTitle');
  if ($langLabelPt) $langLabelPt.textContent = t('topbar.langPtTitle');
  for (const b of $langOptions) {
    const lang = b.dataset.lang;
    b.classList.toggle('active', lang === currentLang);
    b.title = (lang === 'pt-BR') ? t('topbar.langPtTitle') : t('topbar.langEnTitle');
  }
}

function applyI18nTopbar() {
  if ($logo) $logo.textContent = t('topbar.logo');
  if ($githubLink) {
    $githubLink.title = t('topbar.githubTitle');
    $githubLink.setAttribute('aria-label', t('topbar.githubAria'));
  }
  applyI18nLangMenu();
}

function applyI18nSidebar() {
  if ($snippetsTitle) $snippetsTitle.textContent = t('sidebar.snippetsTitle');
  if ($snippetSearch) $snippetSearch.placeholder = t('sidebar.snippetsSearchPlaceholder');
  if ($toggleSnippets) $toggleSnippets.title = t('sidebar.snippetsToggleTitle');
  if ($sidebarResizer) $sidebarResizer.title = t('sidebar.resizeTitle');
  if ($helpTitle) $helpTitle.textContent = t('help.title');
}

function applyI18nStaticDom() {
  applyI18nTopbar();
  applyI18nSidebar();
}

function setLangMenuOpen(open) {
  if (!$langMenuPop) return;
  $langMenuPop.hidden = !open;
}

function isLangMenuOpen() {
  return Boolean($langMenuPop && !$langMenuPop.hidden);
}

function renderHelpCards() {
  if (!$helpCards) return;
  $helpCards.replaceChildren();
  const cards = i18n ? getPath(i18n, 'help.cards') : null;
  if (!Array.isArray(cards)) return;
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'help-card help';
    const title = document.createElement('div');
    title.className = 'help-card-title';
    title.textContent = String(c?.title ?? '');
    card.appendChild(title);
    const lines = Array.isArray(c?.lines) ? c.lines : [];
    for (const line of lines) {
      const row = document.createElement('div');
      row.innerHTML = String(line ?? '');
      card.appendChild(row);
    }
    $helpCards.appendChild(card);
  }
}

async function loadSnippetInclude() {
  if (!$snippetList) return;
  const url = ($snippetList.dataset.include || '').trim();
  if (!url) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(t('errors.snippetsLoadFailed'));
  const html = await r.text();
  $snippetList.innerHTML = html;
}

function registerSnippets() {
  const btns = Array.from($snippetList.querySelectorAll('button.snippet'));
  for (const b of btns) {
    b.addEventListener('click', () => {
      const p = panes.get(activePaneId);
      if (!p) return;
      p.inputEl.value = b.dataset.cmd;
      p._updateAutocomplete();
      p.focus();
    });
    const cmd = b.dataset.cmd || '';
    const m = cmd.trim().match(/^[^\s(]+/);
    if (m) snippetCommands.add(m[0]);
  }
}

function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    // Save the current width only if it looks usable. If the sidebar was
    // hidden/0-sized during bootstrap, keep the previous value (or fall back
    // to SIDEBAR_MIN_WIDTH) so a later expand does not open to zero width.
    const current = $sidebar.getBoundingClientRect().width;
    if (current >= SIDEBAR_MIN_WIDTH) {
      lastExpandedSidebarWidth = current;
    } else if (!lastExpandedSidebarWidth) {
      lastExpandedSidebarWidth = SIDEBAR_MIN_WIDTH;
    }
    $sidebar.style.removeProperty('width');
  } else if (lastExpandedSidebarWidth) {
    $sidebar.style.width = `${lastExpandedSidebarWidth}px`;
  }
  $sidebar.classList.toggle('collapsed', collapsed);
  $toggleSnippets.textContent = collapsed ? '⟩' : '⟨';
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch {}
}

function setSidebarWidth(px) {
  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, px));
  lastExpandedSidebarWidth = clamped;
  $sidebar.style.width = `${clamped}px`;
  try { localStorage.setItem('sidebarWidth', String(clamped)); } catch {}
}

function loadSidebarWidth() {
  let raw = null;
  try { raw = localStorage.getItem('sidebarWidth'); } catch {}
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return;
  setSidebarWidth(n);
}

function snippetGroupKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '');
}

function setSnippetGroupCollapsed(key, collapsed, persist) {
  const g = snippetGroups.get(key);
  if (!g) return;
  g.el.classList.toggle('collapsed', collapsed);
  if (!persist) return;
  try { localStorage.setItem(`snippetGroup:${key}:collapsed`, collapsed ? '1' : '0'); } catch {}
}

function buildSnippetGroups() {
  const items = Array.from($snippetList.children);
  $snippetList.replaceChildren();
  snippetGroups.clear();

  let current = null;
  for (const el of items) {
    if (el.tagName === 'H3') {
      const name = (el.textContent || '').trim();
      const key = snippetGroupKey(name);

      const groupEl = document.createElement('div');
      groupEl.className = 'snippet-group';
      groupEl.dataset.group = name;
      groupEl.dataset.key = key;

      const headerBtn = document.createElement('button');
      headerBtn.className = 'snippet-group-header';
      headerBtn.type = 'button';

      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '▾';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = name;

      headerBtn.appendChild(caret);
      headerBtn.appendChild(title);

      const body = document.createElement('div');
      body.className = 'snippet-group-body';

      groupEl.appendChild(headerBtn);
      groupEl.appendChild(body);
      $snippetList.appendChild(groupEl);

      snippetGroups.set(key, { key, name, el: groupEl, headerBtn, body });
      headerBtn.addEventListener('click', () => {
        const collapsed = !groupEl.classList.contains('collapsed');
        setSnippetGroupCollapsed(key, collapsed, true);
      });

      let persisted = null;
      try { persisted = localStorage.getItem(`snippetGroup:${key}:collapsed`); } catch {}
      setSnippetGroupCollapsed(key, persisted === null ? true : persisted === '1', false);

      current = snippetGroups.get(key);
      continue;
    }

    if (!current) {
      $snippetList.appendChild(el);
      continue;
    }
    current.body.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegex(s) {
  return String(s).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\\$&`);
}

function highlightHtml(text, needles) {
  const rawNeedles = Array.from(new Set((needles || []).map(s => String(s).trim()).filter(Boolean)));
  if (!rawNeedles.length) return escapeHtml(text);
  rawNeedles.sort((a, b) => b.length - a.length);
  const re = new RegExp(rawNeedles.map(escapeRegex).join('|'), 'gi');
  let out = '';
  let last = 0;
  let m = null;
  while ((m = re.exec(text)) !== null) {
    const i = m.index;
    const hit = m[0];
    out += escapeHtml(text.slice(last, i));
    out += `<span class="snippet-hit">${escapeHtml(hit)}</span>`;
    last = i + hit.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function parseNeedles(q) {
  const query = (q || '').trim().toLowerCase();
  return query ? query.split(/\s+/).filter(Boolean) : [];
}

function matchesNeedles(haystack, needles) {
  return needles.every((n) => haystack.includes(n));
}

function setCmdHighlight(btn, needles) {
  const cmdSpan = btn.querySelector('.snippet-cmd');
  if (!cmdSpan) return;
  const cmd = btn.dataset.cmd || '';
  if (needles.length) cmdSpan.innerHTML = highlightHtml(cmd, needles);
  else cmdSpan.textContent = cmd;
}

function updateSnippetButton(btn, needles) {
  const cmd = btn.dataset.cmd || '';
  const title = btn.textContent || '';
  const hay = `${cmd} ${title}`.toLowerCase();
  const visible = matchesNeedles(hay, needles);
  btn.style.display = visible ? '' : 'none';
  setCmdHighlight(btn, needles);
}

function updateSnippetGroups(needles) {
  const hasNeedles = needles.length > 0;
  for (const g of snippetGroups.values()) {
    const anyVisible = Array.from(g.body.querySelectorAll('button.snippet'))
      .some((b) => b.style.display !== 'none');
    g.el.style.display = anyVisible ? '' : 'none';
    if (hasNeedles && anyVisible) g.el.dataset.forceOpen = '1';
    else delete g.el.dataset.forceOpen;
  }
}

function applySnippetFilter(q) {
  const needles = parseNeedles(q);
  const snippetButtons = Array.from($snippetList.querySelectorAll('button.snippet'));
  for (const btn of snippetButtons) updateSnippetButton(btn, needles);
  updateSnippetGroups(needles);
}

function snippetMethod(cmd) {
  const m = (cmd || '').trim().match(/^[^\s(]+/);
  return m ? m[0] : '';
}

function describeSnippet(method) {
  const exact = tOptional(`snippets.known.${method}`);
  if (exact) return exact;

  const m = method.toLowerCase();
  const rules = [
    ['get', 'snippets.generic.get'],
    ['list', 'snippets.generic.list'],
    ['create', 'snippets.generic.create'],
    ['decode', 'snippets.generic.decode'],
    ['send', 'snippets.generic.send'],
    ['sign', 'snippets.generic.sign'],
    ['verify', 'snippets.generic.verify'],
    ['load', 'snippets.generic.load'],
    ['import', 'snippets.generic.import'],
    ['scan', 'snippets.generic.scan'],
  ];
  for (const [prefix, key] of rules) {
    if (!m.startsWith(prefix)) continue;
    const generic = tOptional(key, { method });
    return generic || method;
  }
  return tOptional('snippets.generic.exec', { method }) || method;
}

function decorateSnippets() {
  const btns = Array.from($snippetList.querySelectorAll('button.snippet'));
  for (const el of btns) {
    const cmd = el.dataset.cmd || '';
    const method = snippetMethod(cmd);
    const desc = describeSnippet(method);
    let small = el.querySelector('small');
    if (!small) {
      small = document.createElement('small');
    }
    let cmdSpan = el.querySelector('.snippet-cmd');
    if (!cmdSpan) {
      cmdSpan = document.createElement('span');
      cmdSpan.className = 'snippet-cmd';
    }
    cmdSpan.textContent = cmd;
    el.replaceChildren(cmdSpan, small);
    small.textContent = desc;
    el.title = desc;
  }
}

$toggleSnippets.addEventListener('click', () => {
  setSidebarCollapsed(!$sidebar.classList.contains('collapsed'));
});
$snippetSearch.addEventListener('input', () => applySnippetFilter($snippetSearch.value));

function setHelpCollapsed(collapsed) {
  if (!$helpGroup || !$helpToggle) return;
  $helpGroup.classList.toggle('collapsed', collapsed);
  const caret = $helpToggle.querySelector('.caret');
  if (caret) caret.textContent = collapsed ? '▸' : '▾';
  try { localStorage.setItem(HELP_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
}

if ($helpToggle) {
  $helpToggle.addEventListener('click', () => {
    const collapsed = !$helpGroup.classList.contains('collapsed');
    setHelpCollapsed(collapsed);
  });
}

if ($sidebarResizer) {
  $sidebarResizer.addEventListener('mousedown', (e) => {
    if ($sidebar.classList.contains('collapsed')) return;
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = $sidebar.getBoundingClientRect().width;
    $sidebar.classList.add('resizing');

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      setSidebarWidth(startWidth + delta);
    };
    const onUp = () => {
      $sidebar.classList.remove('resizing');
      globalThis.removeEventListener('mousemove', onMove);
      globalThis.removeEventListener('mouseup', onUp);
    };
    globalThis.addEventListener('mousemove', onMove);
    globalThis.addEventListener('mouseup', onUp);
  });
}

try {
  loadSidebarWidth();
  setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === '1');
} catch {
  loadSidebarWidth();
  setSidebarCollapsed(false);
}
try { setHelpCollapsed(localStorage.getItem(HELP_COLLAPSE_KEY) === '1'); } catch { setHelpCollapsed(false); }

// ============================================================================
// Node status
// ============================================================================
const $statusDot  = document.getElementById('status-dot');
const $statusText = document.getElementById('status-text');
const $appVersion = document.getElementById('app-version');
const $bitcoinMeta = document.getElementById('bitcoin-meta');
let lastMeta = null;
let lastHealth = null;

function setBadge(el, text) {
  if (!el) return;
  const trimmed = (text || '').trim();
  if (!trimmed) {
    el.style.display = 'none';
    return;
  }
  el.textContent = trimmed;
  el.style.display = 'inline-flex';
}

async function refreshMeta() {
  try {
    const r = await fetch('/api/meta');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('bad');
    lastMeta = d;
    renderMeta();
  } catch {
    lastMeta = null;
    renderMeta();
  }
}

function renderMeta() {
  const v = String(lastMeta?.version ?? '').trim();
  const brepo = String(lastMeta?.bitcoin_repo ?? '').trim();
  const bver = String(lastMeta?.bitcoin_version ?? '').trim();

  setBadge($bitcoinMeta, brepo && bver ? `${brepo}:${bver}` : brepo);
  setBadge($appVersion, v ? t('badges.version', { version: v }) : '');
}

async function refreshStatus() {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    if (r.ok) {
      lastHealth = { ok: true, chain: d.chain, blocks: d.blocks };
      renderStatus();
    } else {
      const msg = d?.detail ? JSON.stringify(d.detail) : `HTTP ${r.status}`;
      throw new Error(msg);
    }
  } catch {
    lastHealth = { ok: false };
    renderStatus();
  }
}

function renderStatus() {
  if (!$statusDot || !$statusText) return;
  if (lastHealth === null) {
    $statusDot.className = 'dot';
    $statusText.textContent = t('topbar.connecting');
    return;
  }
  if (lastHealth.ok) {
    $statusDot.className = 'dot ok';
    $statusText.textContent = t('topbar.online', {
      chain: lastHealth.chain,
      blocks: lastHealth.blocks,
    });
    return;
  }
  $statusDot.className = 'dot err';
  $statusText.textContent = t('topbar.offline');
}

// ============================================================================
// Bootstrap: create the first pane
// ============================================================================
const initialLang = getLangFromUrl() || getLangFromCookie() || getSavedLang() || I18N_DEFAULT;
await loadI18n(initialLang);
setSavedLang(currentLang);
setLangCookie(currentLang);
applyI18nStaticDom();
renderHelpCards();
const applyLanguage = async (next) => {
  if (!I18N_SUPPORTED.has(next) || next === currentLang) return;
  await loadI18n(next);
  setSavedLang(currentLang);
  setLangCookie(currentLang);
  applyI18nStaticDom();
  renderHelpCards();
  for (const p of panes.values()) p.applyI18n();
  decorateSnippets();
  applySnippetFilter($snippetSearch?.value || '');
  renderMeta();
  renderStatus();
};

if ($langMenuBtn) {
  $langMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLangMenuOpen(!isLangMenuOpen());
  });
}
for (const b of $langOptions) {
  b.addEventListener('click', async () => {
    setLangMenuOpen(false);
    await applyLanguage(b.dataset.lang);
  });
}
globalThis.addEventListener('mousedown', (e) => {
  if (!isLangMenuOpen()) return;
  if ($langMenu && e.target instanceof Node && !$langMenu.contains(e.target)) setLangMenuOpen(false);
});
globalThis.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setLangMenuOpen(false);
});

try { await loadSnippetInclude(); } catch {}
registerSnippets();
buildSnippetGroups();
decorateSnippets();
applySnippetFilter('');

lastHealth = null;
renderStatus();
await refreshMeta();
await refreshStatus();
setInterval(refreshStatus, 10_000);

const p = new Pane();
panes.set(p.id, p);
layoutTree = newLeaf(p.id);
renderLayout();
setActive(p.id);
