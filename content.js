function inject() {
  const url = chrome.runtime.getURL('inject.js');
  const s = document.createElement('script');
  s.src = url;
  s.type = 'text/javascript';
  s.dataset.src = 'busuu-helper';
  document.documentElement.appendChild(s);
}

function norm(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function normLower(t) {
  const s = String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return norm(s.replace(/["'`.,;:!?]/g, '')).toLowerCase();
}

const state = {
  enabled: false,
  consent: false,
  semiAuto: false,
  delayMode: false,
  debug: false,
  delayMs: 20000,
  delayPending: false,
  delayTimer: null,
  delayKey: '',
  delayAction: null,
  delayRunner: null,
  delayBypass: false,
  delayScheduledAt: 0,
  questionKey: '',
  lessonNavCooldownUntil: 0,
  awaitingLetsGoUntil: 0,
  quizCtaBurstUntil: 0,
  menuFollowUpUntil: 0,
  menuFollowUpTimer: null,
  answers: new Set(),
  idAnswers: new Set(),
  dict: {},
  pairs: [],
  pairingInProgress: false,
  continuePending: false,
  clicked: false,
  observer: null,
  overlay: null,
  highlightEl: null,
  wsConnected: false,
  framesCount: 0,
  processedPasses: new Set(),
  lastClickTime: 0,
  lastActionTime: 0
};

function extractAnswers(obj) {
  const out = [];
  const pairOut = [];
  const idOut = [];
  function walk(o) {
    if (!o) return;
    if (Array.isArray(o)) {
      for (const v of o) walk(v);
      return;
    }
    if (typeof o !== 'object') return;
    const keys = Object.keys(o);
    // Extended keys for answer detection
    const ck = keys.find(k => /correctAnswer|solution|rightAnswer|expected|reference|model/i.test(k));
    if (ck) {
      const v = o[ck];
      if (typeof v === 'string') out.push(normLower(v));
      else if (typeof v === 'boolean') out.push(v ? 'true' : 'false');
      else if (Array.isArray(v)) {
        for (const it of v) {
          if (typeof it === 'string') out.push(normLower(it));
          else walk(it);
        }
      }
      else walk(v);
    }
    for (const k of keys) {
      if (!/correct.*(option)?ids?$|right.*ids?$|expected.*ids?$|solution.*ids?$|answer.*ids?$/i.test(k)) continue;
      const v = o[k];
      if (typeof v === 'string' || typeof v === 'number') idOut.push(String(v));
      else if (Array.isArray(v)) {
        for (const it of v) {
          if (typeof it === 'string' || typeof it === 'number') idOut.push(String(it));
          else walk(it);
        }
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    }
    for (const k of keys) {
      if (!/correct(options|choices|answers)$|right(options|choices|answers)$|expected(options|choices|answers)$|solution(options|choices|answers)$|correct(options|choices|answers)List$/i.test(k)) continue;
      const v = o[k];
      if (!Array.isArray(v)) continue;
      for (const it of v) {
        if (typeof it === 'string') out.push(normLower(it));
        else if (typeof it === 'number') idOut.push(String(it));
        else if (it && typeof it === 'object') {
          const tk = ['text', 'label', 'value', 'answer', 'content', 'html'].find(x => typeof it[x] === 'string');
          if (tk) out.push(normLower(it[tk]));
          const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid', 'key'].find(x => typeof it[x] === 'string' || typeof it[x] === 'number');
          if (idKey) idOut.push(String(it[idKey]));
          walk(it);
        }
      }
    }
    const flagKey = keys.find(k => /^(isCorrect|correct|is_right)$/i.test(k));
    if (flagKey && o[flagKey] === true) {
      const textKey = ['text', 'label', 'value', 'answer', 'content', 'html'].find(k => typeof o[k] === 'string');
      if (textKey) out.push(normLower(o[textKey]));
      const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid'].find(k => typeof o[k] === 'string' || typeof o[k] === 'number');
      if (idKey) idOut.push(String(o[idKey]));
    }
    if (o.choices && Array.isArray(o.choices)) {
      for (const it of o.choices) {
        if (it && (it.isCorrect === true || it.correct === true)) {
          const tk = ['text', 'label', 'value', 'content', 'html'].find(k => typeof it[k] === 'string');
          if (tk) out.push(normLower(it[tk]));
          const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid'].find(k => typeof it[k] === 'string' || typeof it[k] === 'number');
          if (idKey) idOut.push(String(it[idKey]));
        }
      }
    }
    if (o.options && Array.isArray(o.options)) {
      for (const it of o.options) {
        if (it && (it.isCorrect === true || it.correct === true)) {
          const tk = ['text', 'label', 'value', 'content', 'html'].find(k => typeof it[k] === 'string');
          if (tk) out.push(normLower(it[tk]));
          const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid'].find(k => typeof it[k] === 'string' || typeof it[k] === 'number');
          if (idKey) idOut.push(String(it[idKey]));
        }
      }
    }
    if (typeof o.correctIndex === 'number' && Array.isArray(o.choices)) {
      const it = o.choices[o.correctIndex];
      if (it) {
        const tk = ['text', 'label', 'value', 'content', 'html'].find(k => typeof it[k] === 'string');
        if (tk) out.push(normLower(it[tk]));
        const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid'].find(k => typeof it[k] === 'string' || typeof it[k] === 'number');
        if (idKey) idOut.push(String(it[idKey]));
      }
    }
    if (typeof o.correctOptionId !== 'undefined' && Array.isArray(o.options)) {
      const it = o.options.find(x => String(x.id) === String(o.correctOptionId));
      if (it) {
        const tk = ['text', 'label', 'value', 'content', 'html'].find(k => typeof it[k] === 'string');
        if (tk) out.push(normLower(it[tk]));
        const idKey = ['id', 'optionId', 'option_id', 'answerId', 'answer_id', 'choiceId', 'choice_id', 'entityId', 'entity_id', 'uuid'].find(k => typeof it[k] === 'string' || typeof it[k] === 'number');
        if (idKey) idOut.push(String(it[idKey]));
      }
    }
    const lk = ['left','source','question','prompt','a','from'].find(k => typeof o[k] === 'string');
    const rk = ['right','target','answer','response','b','to'].find(k => typeof o[k] === 'string');
    if (lk && rk) {
      pairOut.push([normLower(o[lk]), normLower(o[rk])]);
    }
    const pk = keys.find(k => /pairs|pairings|matches|mapping|links/i.test(k));
    if (pk && Array.isArray(o[pk])) {
      for (const it of o[pk]) {
        if (it && typeof it === 'object') {
          const l2 = ['left','source','question','prompt','a','from'].find(k => typeof it[k] === 'string');
          const r2 = ['right','target','answer','response','b','to'].find(k => typeof it[k] === 'string');
          if (l2 && r2) pairOut.push([normLower(it[l2]), normLower(it[r2])]);
        }
      }
    }
    for (const k of keys) walk(o[k]);
  }
  walk(obj);
  const beforeText = state.answers.size;
  const beforeId = state.idAnswers.size;
  for (const a of out) if (a) addAnswer(a);
  for (const id of idOut) {
    const t = normLower(id);
    if (!t || t.length <= 1) continue;
    state.idAnswers.add(t);
    const resolved = resolveId(t);
    if (resolved && resolved.length > 1) state.answers.add(resolved);
  }
  if (state.debug && state.answers.size === beforeText && state.idAnswers.size === beforeId) dbg('Aucune réponse trouvée');
  if (pairOut.length) {
    const set = new Set(pairOut.map(p => p.join('||')));
    state.pairs = Array.from(set).map(s => s.split('||'));
    if (state.semiAuto) showOverlay('Paires: ' + state.pairs.length);
  }
  if (state.semiAuto && out.length) showOverlay('Réponse: ' + out[0]);
}

function allNodes(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    out.push(n);
    if (n.shadowRoot) out.push(...allNodes(n.shadowRoot));
    n = walker.nextNode();
  }
  return out;
}

function candidates() {
  const roots = [document];
  const nodes = [];
  for (const r of roots) nodes.push(...allNodes(r));
  const list = nodes.filter(el => (
    el.matches && (
      el.matches('button, [role="button"], [role="radio"], [role="option"], input[type="radio"], label[for], [data-option], [data-answer], [data-qa-exercise-true], [data-qa-exercise-false]') ||
      (el.getAttribute('data-testid') || '').includes('option') ||
      (el.className || '').toString().includes('option') || (el.className || '').toString().includes('choice') ||
      el.tagName === 'LI'
    )
  ));
  return list.filter(el => el && isVisible(el) && !isForbiddenControl(el) && !isInTopBar(el) && isExerciseCandidate(el));
}

function scanStaticData() {
  try {
    const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!txt) continue;
      try { const obj = JSON.parse(txt); extractAnswers(obj); } catch {}
    }
    const inline = Array.from(document.querySelectorAll('script:not([src])'));
    for (const s of inline) {
      const txt = s.textContent || '';
      if (!txt) continue;
      const re = /["'](str_[a-z0-9\-]+)["']\s*:\s*["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(txt))) {
        state.dict[m[1]] = m[2];
      }
    }
    const els = Array.from(document.querySelectorAll('[data-correct],[data-correct-id],[data-answer],[data-solution]'));
    for (const el of els) {
      const t = el.getAttribute('data-correct') || el.getAttribute('data-answer') || el.getAttribute('data-solution');
      if (t) addAnswer(t);
      const id = el.getAttribute('data-correct-id');
      if (id) addAnswer(id);
    }
  } catch {}
}

function collectDict(obj) {
  try {
    const stack = [obj];
    while (stack.length) {
      const o = stack.pop();
      if (!o) continue;
      if (Array.isArray(o)) { for (const v of o) stack.push(v); continue; }
      if (typeof o !== 'object') continue;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && /^str_[a-z0-9-]+$/i.test(k)) {
          state.dict[k] = v;
        } else if (typeof v === 'object') {
          stack.push(v);
        }
      }
    }
  } catch {}
}

function scanTranslations() {
  try {
    const tags = Array.from(document.querySelectorAll('link[href*=".json"], script[src*=".json"]'));
    const urls = [];
    for (const t of tags) {
      const u = t.getAttribute('href') || t.getAttribute('src') || '';
      if (!u) continue;
      if (/\b(en|fr|es|de)\.json\b/i.test(u) || /translations|locale|i18n/i.test(u)) urls.push(u);
    }
    urls.slice(0, 3).forEach(u => {
      fetch(u).then(r => r.json()).then(j => collectDict(j)).catch(() => {});
    });
  } catch {}
}

function resolveId(id) {
  const k = id.startsWith('entity_') ? id.replace(/^entity_/, 'str_') : id;
  const v = state.dict[k];
  return v ? normLower(v) : '';
}

function matchText(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 4 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function showOverlay(text) {
  if (!state.overlay) {
    const d = document.createElement('div');
    d.style.position = 'fixed';
    d.style.top = '10px';
    d.style.right = '10px';
    d.style.zIndex = '999999';
    d.style.background = '#fff8c4';
    d.style.border = '1px solid #e6d26b';
    d.style.borderRadius = '6px';
    d.style.padding = '8px 10px';
    d.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
    d.style.fontSize = '13px';
    d.style.color = '#333';
    d.style.pointerEvents = 'none';
    (document.body || document.documentElement).appendChild(d);
    state.overlay = d;
  }
  state.overlay.textContent = text || '';
}


function dbg(text) {
  if (!state.debug) return;
  showOverlay(String(text || ''));
}

function computeQuestionKey() {
  try {
    const parts = [];
    parts.push(String(location && location.pathname || ''));
    const cands = candidates();
    parts.push('c' + cands.length);
    const texts = [];
    for (const el of cands.slice(0, 12)) {
      const t = normLower(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      if (t) texts.push(t.slice(0, 40));
      if (texts.length >= 8) break;
    }
    if (texts.length) {
      parts.push('t:' + texts.join('|'));
    } else {
      const passes = [];
      for (const el of cands.slice(0, 20)) {
        const p = el.getAttribute && el.getAttribute('data-qa-pass');
        if (p != null) passes.push(String(p));
        if (passes.length >= 10) break;
      }
      if (passes.length) parts.push('p:' + passes.join(','));
    }
    const root = document.querySelector('main') || document.body || document.documentElement;
    if (root) {
      let sample = '';
      try { sample = String(root.innerText || '').slice(0, 500); } catch {}
      try {
        const overlayText = state.overlay && state.overlay.textContent ? String(state.overlay.textContent) : '';
        if (overlayText) sample = sample.replace(overlayText, '');
      } catch {}
      const normSample = normLower(sample).slice(0, 220);
      if (normSample) parts.push('s:' + normSample);
    }
    return parts.join('||');
  } catch {
    return '';
  }
}

function clearDelayedAction() {
  if (state.delayTimer) {
    try { clearTimeout(state.delayTimer); } catch {}
  }
  state.delayTimer = null;
  state.delayPending = false;
  state.delayKey = '';
  state.delayAction = null;
  state.delayRunner = null;
  state.delayScheduledAt = 0;
}

function findDelayedTarget(action) {
  if (!action) return null;
  if (action.kind === 'pass') return findPassCandidate();
  if (action.kind === 'bool') return findBoolCandidate(action.value);
  const cands = candidates();
  if (!cands.length) return null;
  if (action.kind === 'text') {
    for (const el of cands) {
      const t = normLower(el.innerText || el.textContent);
      if (matchText(t, action.value)) return el;
    }
    return null;
  }
  if (action.kind === 'id') {
    const id = action.value;
    for (const el of cands) {
      const ids = getCandidateIds(el);
      for (const v of ids) {
        if (v === id || v === ('entity_' + id)) return el;
      }
      const txt = resolveId(id);
      if (txt) {
        const t = normLower(el.innerText || el.textContent);
        if (matchText(t, txt)) return el;
      }
    }
    return null;
  }
  return null;
}

function scheduleDelayedAnswer(action) {
  if (!state.delayMode || state.semiAuto || state.delayBypass) return false;
  const qKey = state.questionKey || computeQuestionKey();
  const value = action && typeof action.value === 'string' ? normLower(action.value) : action && action.value;
  const key = `${qKey}||${action.kind}:${String(value)}`;
  if (state.delayPending && state.delayKey === key) return true;
  clearDelayedAction();
  state.delayPending = true;
  state.delayKey = key;
  state.delayAction = { type: 'answer', kind: action.kind, value };
  state.delayScheduledAt = Date.now();
  const el = findDelayedTarget(state.delayAction);
  if (el) highlight(el);
  showOverlay('Attente: 20s');
  state.delayTimer = setTimeout(() => {
    const act = state.delayAction;
    clearDelayedAction();
    if (!state.enabled || !state.consent || !state.delayMode || state.semiAuto) return;
    const target = findDelayedTarget(act);
    if (!target) return;
    highlight(target);
    state.clicked = true;
    state.lastClickTime = Date.now();
    setTimeout(() => {
      clickEl(target);
      setTimeout(() => { state.clicked = false; }, 1200);
    }, 50);
    scheduleClickContinue();
  }, state.delayMs);
  return true;
}

function scheduleDelayedHandler(name, runner) {
  if (!state.delayMode || state.semiAuto || state.delayBypass) return false;
  const qKey = state.questionKey || computeQuestionKey();
  const key = `${qKey}||handler:${String(name)}`;
  if (state.delayPending && state.delayKey === key) return true;
  clearDelayedAction();
  state.delayPending = true;
  state.delayKey = key;
  state.delayAction = { type: 'handler', name: String(name), qKey };
  state.delayRunner = typeof runner === 'function' ? runner : null;
  state.delayScheduledAt = Date.now();
  showOverlay('Attente: 20s');
  state.delayTimer = setTimeout(() => {
    const act = state.delayAction;
    const fn = state.delayRunner;
    clearDelayedAction();
    if (!state.enabled || !state.consent || !state.delayMode || state.semiAuto) return;
    const currentQ = computeQuestionKey();
    if (act && act.qKey && currentQ && act.qKey !== currentQ) return;
    if (typeof fn !== 'function') return;
    state.delayBypass = true;
    try { fn(); } catch {}
    setTimeout(() => { state.delayBypass = false; }, 2500);
    scheduleSelect();
  }, state.delayMs);
  return true;
}

function addAnswer(v) {
  const t = normLower(v);
  if (!t) return;
  if (/^str_[a-z0-9_-]+$/i.test(t)) {
    state.idAnswers.add(t);
    const resolved = resolveId(t);
    if (resolved && resolved.length > 1) state.answers.add(resolved);
    return;
  }
  if (/^(entity_|option_|answer_|id_)?[a-f0-9-]{8,}$/i.test(t)) { state.idAnswers.add(t); return; }
  if (t.length <= 1) return;
  state.answers.add(t);
}

let selectScheduled = false;
function scheduleSelect() {
  if (selectScheduled) return;
  selectScheduled = true;
  (window.requestAnimationFrame || setTimeout)(() => {
    selectScheduled = false;
    trySelect();
  }, 50);
}

function startMenuFollowUp(ms) {
  try {
    const now = Date.now();
    state.menuFollowUpUntil = Math.max(state.menuFollowUpUntil || 0, now + (ms || 0));
    if (state.menuFollowUpTimer) return;
    const tick = () => {
      state.menuFollowUpTimer = null;
      const t = Date.now();
      if (!state.enabled || !state.consent || state.semiAuto) return;
      if (!state.menuFollowUpUntil || t > state.menuFollowUpUntil) return;
      scheduleSelect();
      state.menuFollowUpTimer = setTimeout(tick, 250);
    };
    state.menuFollowUpTimer = setTimeout(tick, 0);
  } catch {}
}

function highlight(el) {
  if (state.highlightEl && state.highlightEl !== el) {
    state.highlightEl.style.outline = '';
  }
  state.highlightEl = el;
  if (el) {
    el.style.outline = '3px solid #ffd54f';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return (rect.width > 0 || rect.height > 0);
}

function isVisibleNoPointer(el) {
  if (!el) return false;
  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return (rect.width > 0 || rect.height > 0);
  } catch { return false; }
}

function isForbiddenControl(el) {
  try {
    const txt = normLower((el.innerText || el.textContent || '').slice(0, 40));
    const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || ''));
    const title = normLower(el.getAttribute && (el.getAttribute('title') || ''));
    const testid = normLower(el.getAttribute && (el.getAttribute('data-testid') || ''));
    const cls = normLower((el.className || '').toString());
    const href = normLower(el.getAttribute && (el.getAttribute('href') || ''));
    const dataTitle = normLower(el.getAttribute && (el.getAttribute('data-original-title') || ''));
    const forbid = ['download','télécharger','descargar','herunterladen','scaricare','baixar','share','partager','compartir','teilen','condividi','compartilhar','settings','paramètres','ajustes','configura','close','fermer','retour','back'];
    const hit = (s) => forbid.some(w => s.includes(w));
    if (hit(txt) || hit(aria) || hit(title) || hit(testid) || hit(cls) || hit(href) || hit(dataTitle)) return true;
    // In header/topbar region: avoid small icon buttons near the top
    const header = el.closest && (el.closest('header, .header, .topbar, [data-testid*="header"]'));
    const rect = el.getBoundingClientRect();
    if (header || (rect.top < 90 && rect.height < 80)) {
      // If it's obviously not an exercise control, skip
      if (el.tagName === 'A' || cls.includes('icon') || aria || title) return true;
    }
    // Explicit icon hints
    const qa = normLower(el.getAttribute && (el.getAttribute('data-qa') || el.getAttribute('data-qa-action') || ''));
    if (qa.includes('download') || qa.includes('share')) return true;
    if (/icon[-_]?download|download[-_]?icon/.test(cls)) return true;
    // Ancestor-based denylist: data-original-title on tooltip containers
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      const ancTitle = normLower(n.getAttribute && (n.getAttribute('data-original-title') || n.getAttribute('title') || ''));
      if (ancTitle && hit(ancTitle)) return true;
      const ancCls = normLower((n.className || '').toString());
      if (ancCls.includes('circle-icon') && (ancTitle.includes('download') || hit(ancTitle))) return true;
      n = n.parentElement;
    }
  } catch {}
  return false;
}

function isAllowedExerciseControl(el) {
  try {
    const ok = ['continue','suivant','next','check','valider','submit','quiz','start quiz','pop-up-card-cta'];
    const txt = normLower(el.innerText || el.textContent || '');
    const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || ''));
    const testid = normLower(el.getAttribute && (el.getAttribute('data-testid') || ''));
    const hit = (s) => ok.some(w => s.includes(w));
    return hit(txt) || hit(aria) || hit(testid);
  } catch { return false; }
}

function isInTopBar(el) {
  try {
    const header = el.closest && (el.closest('header, .header, .topbar, [data-testid*="header"]'));
    if (header) return true;
    const rect = el.getBoundingClientRect();
    return rect.top < 120;
  } catch { return false; }
}

function isExerciseCandidate(el) {
  try {
    const txt = (el.innerText || el.textContent || '').trim();
    const aria = el.getAttribute && (el.getAttribute('aria-label') || '');
    const hasText = txt.length >= 2 || (aria && aria.length >= 2);
    const roles = ['button','radio','option'];
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const testid = (el.getAttribute && el.getAttribute('data-testid')) || '';
    const qaChoice = el.hasAttribute && (el.hasAttribute('data-qa-choice') || el.hasAttribute('data-qa-exercise-true') || el.hasAttribute('data-qa-exercise-false'));
    const looksOption = roles.includes(role) || (testid && testid.includes('option')) || el.tagName === 'LI';
    return hasText || qaChoice || looksOption;
  } catch { return false; }
}

function clickable(el) {
  let n = el;
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 6 && n; i++) {
    try {
      const style = window.getComputedStyle(n);
      const disabled = n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true';
      if (!disabled) {
        const role = n.getAttribute && n.getAttribute('role');
        const isButton = n.tagName === 'BUTTON';
        const isRoleButton = role === 'button' || role === 'option';
        const hasOnclick = typeof n.onclick === 'function';
        const hasTabindex = n.getAttribute && n.getAttribute('tabindex') !== null;
        let score = 0;
        if (isButton) score = 4;
        else if (isRoleButton || hasOnclick) score = 3;
        else if (hasTabindex) score = 1;
        if (style.pointerEvents === 'none') score -= 2;
        if (score > bestScore) { best = n; bestScore = score; }
        if (bestScore >= 4) return best;
      }
    } catch {}
    n = n.parentElement;
  }
  return best || el;
}

function clickEl(el) {
  let target = clickable(el);
  try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  try { target.focus && target.focus(); } catch {}
  const rect = target.getBoundingClientRect();
  const baseOpts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
  if (isForbiddenControl(target) && !isAllowedExerciseControl(target)) return;
  state.lastActionTime = Date.now();
  try {
    const top = document.elementFromPoint(baseOpts.clientX, baseOpts.clientY);
    const role = (target.getAttribute && target.getAttribute('role')) || '';
    const isButtonLike = target.tagName === 'BUTTON' || role === 'button' || typeof target.onclick === 'function';
    if (top && top !== target && isVisibleNoPointer(top) && !isInTopBar(top) && !isForbiddenControl(top)) {
      if (target.contains(top) || top.contains(target) || !isButtonLike) target = clickable(top);
    }
  } catch {}
  const fire = (type, o) => {
    try {
      if (type.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
        target.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o)));
        return;
      }
    } catch {}
    try { target.dispatchEvent(new MouseEvent(type, o)); } catch {}
  };
  fire('pointerover', Object.assign({ buttons: 0 }, baseOpts));
  fire('mouseover', Object.assign({ buttons: 0 }, baseOpts));
  fire('pointerenter', Object.assign({ buttons: 0 }, baseOpts));
  fire('mouseenter', Object.assign({ buttons: 0 }, baseOpts));
  fire('pointerdown', Object.assign({ buttons: 1, button: 0 }, baseOpts));
  fire('mousedown', Object.assign({ buttons: 1, button: 0 }, baseOpts));
  fire('pointerup', Object.assign({ buttons: 0, button: 0 }, baseOpts));
  fire('mouseup', Object.assign({ buttons: 0, button: 0 }, baseOpts));
  fire('click', Object.assign({ buttons: 0, button: 0 }, baseOpts));
}

function clickElHard(el) {
  let target = clickable(el);
  try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  try { target.focus && target.focus(); } catch {}
  const rect = target.getBoundingClientRect();
  const baseOpts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  if (isForbiddenControl(target) && !isAllowedExerciseControl(target)) return;
  state.lastActionTime = Date.now();
  try {
    const top = document.elementFromPoint(baseOpts.clientX, baseOpts.clientY);
    const role = (target.getAttribute && target.getAttribute('role')) || '';
    const isButtonLike = target.tagName === 'BUTTON' || role === 'button' || typeof target.onclick === 'function';
    if (top && top !== target && isVisibleNoPointer(top) && !isInTopBar(top) && !isForbiddenControl(top)) {
      if (target.contains(top) || top.contains(target) || !isButtonLike) target = clickable(top);
    }
  } catch {}
  const fire = (type, o) => {
    try {
      if (type.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
        target.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o)));
        return;
      }
    } catch {}
    try { target.dispatchEvent(new MouseEvent(type, o)); } catch {}
  };
  fire('pointerover', Object.assign({ buttons: 0 }, baseOpts));
  fire('mouseover', Object.assign({ buttons: 0 }, baseOpts));
  fire('pointerenter', Object.assign({ buttons: 0 }, baseOpts));
  fire('mouseenter', Object.assign({ buttons: 0 }, baseOpts));
  fire('pointerdown', Object.assign({ buttons: 1, button: 0 }, baseOpts));
  fire('mousedown', Object.assign({ buttons: 1, button: 0 }, baseOpts));
  fire('pointerup', Object.assign({ buttons: 0, button: 0 }, baseOpts));
  fire('mouseup', Object.assign({ buttons: 0, button: 0 }, baseOpts));
  const role = (target.getAttribute && target.getAttribute('role')) || '';
  const buttonLike = target.tagName === 'BUTTON' || role === 'button' || typeof target.onclick === 'function';
  let didClick = false;
  if (buttonLike) {
    try { target.click(); didClick = true; } catch {}
  }
  if (!didClick) {
    fire('click', Object.assign({ buttons: 0, button: 0 }, baseOpts));
    try { target.click(); } catch {}
  }
}

function getCandidateIds(el) {
  const ids = new Set();
  let n = el;
  for (let i = 0; i < 3 && n; i++) {
    const attrs = ['data-id','data-option-id','data-answer-id','data-entity-id','data-key','data-i18n-key','data-translation-id','data-testid','data-qa-choice','data-qa-pass','id','name','value','aria-label'];
    for (const a of attrs) {
      const v = n.getAttribute && n.getAttribute(a);
      if (v) ids.add(normLower(v));
    }
    n = n.parentElement;
  }
  const descendants = el.querySelectorAll ? Array.from(el.querySelectorAll('*')) : [];
  for (const d of descendants.slice(0, 20)) {
    const attrs = d.getAttributeNames ? d.getAttributeNames() : [];
    for (const a of attrs) {
      const v = d.getAttribute(a);
      if (!v) continue;
      const nv = normLower(v);
      if (/str_[a-z0-9-]+/i.test(v) || /[a-f0-9-]{8,}/i.test(v) || a.includes('id') || a.includes('key') || a.includes('i18n') || a.includes('translation')) {
        ids.add(nv);
      }
    }
  }
  return ids;
}

function findPassCandidate() {
  try {
    const cands = candidates();
    for (const el of cands) {
      const v = el.getAttribute && el.getAttribute('data-qa-pass');
      if (v && String(v).toLowerCase() === 'true') return el;
    }
  } catch {}
  return null;
}

function findPassCandidates() {
  try {
    const list = [];
    const seen = new Set();
    const nodes = allNodes(document);
    for (const el of nodes) {
      if (!el || !el.getAttribute || !el.getBoundingClientRect) continue;
      const v = el.getAttribute('data-qa-pass');
      if (!v || String(v).toLowerCase() !== 'true') continue;
      if (!isVisibleNoPointer(el)) continue;
      if (isForbiddenControl(el) || isInTopBar(el)) continue;
      const clickTarget = clickable(el);
      if (!clickTarget || seen.has(clickTarget)) continue;
      const r = clickTarget.getBoundingClientRect();
      if (r.width < 24 || r.width > 260 || r.height < 18 || r.height > 140) continue;
      seen.add(clickTarget);
      list.push(clickTarget);
    }
    list.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const dt = ar.top - br.top;
      if (Math.abs(dt) > 3) return dt;
      return ar.left - br.left;
    });
    return list;
  } catch {}
  return [];
}

function isPassSelected(el) {
  try {
    const ariaPressed = el.getAttribute && el.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    const ariaSelected = el.getAttribute && el.getAttribute('aria-selected');
    if (ariaSelected === 'true') return true;
    const cls = normLower((el.className || '').toString());
    if (cls.includes('selected') || cls.includes('is-selected')) return true;
  } catch {}
  return false;
}

function isPhrasalVerbPickPage() {
  try {
    const t = normLower(((document.body && document.body.innerText) || '').slice(0, 500));
    if (!t) return false;
    return t.includes('phrasal verb') || t.includes('verbe a particule') || t.includes('verbe à particule');
  } catch { return false; }
}

function findNearestRightWordTile(anchorEl) {
  try {
    if (!anchorEl || !anchorEl.getBoundingClientRect) return null;
    const ar = anchorEl.getBoundingClientRect();
    const nodes = allNodes(document);
    let best = null;
    let bestLeft = Infinity;
    for (const n of nodes) {
      if (!n || !n.getBoundingClientRect || !n.matches) continue;
      if (!n.matches('button,[role="button"],[role="option"],[tabindex],li')) continue;
      if (!isVisible(n)) continue;
      if (isForbiddenControl(n) || isInTopBar(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 24 || r.width > 260 || r.height < 18 || r.height > 140) continue;
      if (Math.abs(r.top - ar.top) > 26) continue;
      if (r.left <= ar.right + 2) continue;
      if (r.left > ar.right + 260) continue;
      const raw = String((n.innerText || n.textContent || '')).replace(/\r/g, '');
      const lines = raw.split('\n').map(s => String(s || '').trim()).filter(Boolean);
      const nonNums = lines.filter(s => !/^\d+$/.test(s));
      const main = (nonNums.length ? nonNums : lines).join(' ').trim();
      if (!main) continue;
      if (!/[a-zA-ZÀ-ÿ]/.test(main)) continue;
      if (r.left < bestLeft) {
        bestLeft = r.left;
        best = n;
      }
    }
    return best;
  } catch {}
  return null;
}

function findBoolCandidate(ans) {
  try {
    const cands = candidates();
    const key = ans === 'true' ? 'data-qa-exercise-true' : 'data-qa-exercise-false';
    for (const el of cands) {
      const v = el.getAttribute && el.getAttribute(key);
      if (v && String(v).toLowerCase() === 'true') return el;
    }
  } catch {}
  return null;
}

function matchupItems() {
  const items = Array.from(document.querySelectorAll('[role="button"][data-qa-type]'));
  const answers = [];
  const assets = [];
  for (const el of items) {
    const type = el.getAttribute('data-qa-type');
    const pass = el.getAttribute('data-qa-pass');
    if (!type || pass == null) continue;
    const entry = { el, pass: String(pass).trim() };
    if (type === 'answer') answers.push(entry);
    else if (type === 'asset') assets.push(entry);
  }
  return { answers, assets };
}

function trySelectMatchupByPass() {
  const { answers, assets } = matchupItems();
  if (!answers.length || !assets.length) {
    if (state.processedPasses) state.processedPasses.clear();
    return false;
  }
  const pairs = [];
  for (const a of answers) {
    if (state.processedPasses && state.processedPasses.has(a.pass)) continue;
    const b = assets.find(x => x.pass === a.pass);
    if (b) pairs.push({ a, b });
  }
  if (!pairs.length) return false;
  if (state.semiAuto) {
    showOverlay('Paires PASS: ' + pairs.length);
    highlight(pairs[0].a.el);
    return true;
  }
  if (scheduleDelayedHandler('matchup_pass', () => { trySelectMatchupByPass(); })) return true;
  if (state.pairingInProgress) return true;
  state.pairingInProgress = true;
  let idx = 0;
  const clickNext = () => {
    const p = pairs[idx++];
    if (!p) {
      state.pairingInProgress = false;
      scheduleClickContinue();
      return;
    }
    state.processedPasses && state.processedPasses.add(p.a.pass);
    setTimeout(() => {
      clickEl(p.a.el);
      setTimeout(() => {
        clickEl(p.b.el);
        setTimeout(clickNext, 250);
      }, 200);
    }, 150);
  };
  clickNext();
  return true;
}

function findContinueButton() {
  const labels = ['continue','suivant','next','continuar','weiter','avanti'];
  const score = (el) => {
    try {
      const style = window.getComputedStyle(el);
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      if (disabled) return -1000;
      const txt = normLower(el.innerText || el.textContent || '');
      const aria = normLower(el.getAttribute('aria-label') || '');
      const testid = normLower(el.getAttribute('data-testid') || '');
      const qa = normLower(el.getAttribute('data-qa-continue') || el.getAttribute('data-qa-next') || el.getAttribute('data-qa-action') || el.getAttribute('data-qa-feedback-cta') || el.getAttribute('data-qa-feedback-positive') || el.getAttribute('data-qa-lesson-finished') || '');
      const klass = normLower((el.className || '').toString());
      const hit = (s) => labels.some(l => s.includes(l));
      const hasFeedbackCta = el.hasAttribute('data-qa-feedback-cta');
      const hasFeedbackPositive = el.hasAttribute('data-qa-feedback-positive');
      const hasLessonFinished = el.hasAttribute('data-qa-lesson-finished');
      const isCheckButton = testid.includes('check_button');
      const isRealButton = el.tagName === 'BUTTON';
      const audioish = aria.includes('play audio') || txt.includes('play audio') || aria.includes('audio') || txt.includes('audio') || aria.includes('volume') || txt.includes('volume');
      let s = 0;
      if (isRealButton) s += 40;
      if (hasFeedbackCta || hasFeedbackPositive) s += 100;
      if (hasLessonFinished) s += 650;
      if (isCheckButton) s += 90;
      if (hit(txt) || hit(aria) || hit(testid) || hit(qa) || hit(klass)) s += 320;
      if (!txt && !aria) s -= 80;
      if (audioish) s -= 200;
      return s;
    } catch {
      return 0;
    }
  };
  const preferred = Array.from(document.querySelectorAll('button[data-qa-lesson-finished], button[data-qa-feedback-cta], button[data-testid="check_button"], .ex-feedback-bar__button, .ex-feedback-bar button, .ex-feedback-bar [role="button"]'));
  const cand1 = [];
  for (const el of preferred) {
    if (!isVisibleNoPointer(el)) continue;
    if (isForbiddenControl(el) && !isAllowedExerciseControl(el)) continue;
    const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
    if (aria === 'play audio') continue;
    const style = window.getComputedStyle(el);
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
    if (disabled) continue;
    cand1.push(clickable(el));
  }
  if (cand1.length) {
    cand1.sort((a, b) => {
      const ds = score(b) - score(a);
      if (ds) return ds;
      const br = b.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const db = br.bottom - ar.bottom;
      if (db) return db;
      return br.right - ar.right;
    });
    return cand1[0];
  }
  const nodes = allNodes(document);
  const cand2 = [];
  for (const el of nodes) {
    if (!el || !el.matches) continue;
    if (!(el.matches('button, [role="button"], a, [tabindex]'))) continue;
    if (!isVisibleNoPointer(el)) continue;
    if (isForbiddenControl(el) && !isAllowedExerciseControl(el)) continue;
    const aria0 = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
    if (aria0 === 'play audio') continue;
    const style = window.getComputedStyle(el);
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
    if (disabled) continue;
    const txt = normLower(el.innerText || el.textContent || '');
    const aria = normLower(el.getAttribute('aria-label') || '');
    const testid = normLower(el.getAttribute('data-testid') || '');
    const qa = normLower(el.getAttribute('data-qa-continue') || el.getAttribute('data-qa-next') || el.getAttribute('data-qa-action') || el.getAttribute('data-qa-feedback-cta') || el.getAttribute('data-qa-feedback-positive') || '');
    const klass = normLower((el.className || '').toString());
    const hit = (s) => labels.some(l => s.includes(l));
    const hasFeedbackCta = el.hasAttribute('data-qa-feedback-cta');
    const hasFeedbackPositive = el.hasAttribute('data-qa-feedback-positive');
    const isCheckButton = testid.includes('check_button');
    if (hasFeedbackCta || hasFeedbackPositive || isCheckButton || hit(txt) || hit(aria) || hit(testid) || hit(qa) || hit(klass)) {
      cand2.push(clickable(el));
    }
  }
  if (cand2.length) {
    cand2.sort((a, b) => {
      const ds = score(b) - score(a);
      if (ds) return ds;
      const br = b.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const db = br.bottom - ar.bottom;
      if (db) return db;
      return br.right - ar.right;
    });
    return cand2[0];
  }
  return null;
}

function scheduleClickContinue() {
  if (state.continuePending) return;
  state.continuePending = true;
  const startedAt = Date.now();
  const maxMs = 18000;
  let clickCount = 0;
  const attempt = () => {
    const btn = findContinueButton();
    if (btn) {
      clickElHard(btn);
      clickCount++;
      if (clickCount >= 3) {
        state.continuePending = false;
        return;
      }
      setTimeout(() => {
        const still = findContinueButton();
        if (!still || (Date.now() - startedAt) > maxMs) {
          state.continuePending = false;
          return;
        }
        setTimeout(attempt, 350);
      }, 350);
      return;
    }
    if ((Date.now() - startedAt) > maxMs) {
      state.continuePending = false;
      return;
    }
    setTimeout(attempt, 450);
  };
  setTimeout(attempt, 450);
}

function findSendToCommunityButton(nodes) {
  try {
    const sendLabels = [
      'send to community',
      'envoyer a la communaute',
      'envoyer à la communaute',
      'enviar a la comunidad',
      'senden',
      'invia alla community',
      'enviar para a comunidade'
    ];
    const list = nodes || allNodes(document);
    for (const b of list) {
      if (!b || !b.matches) continue;
      if (!(b.matches('button, [role="button"], .ex-btn') || (b.className && typeof b.className === 'string' && b.className.includes('submit')))) continue;
      if (!isVisible(b)) continue;
      if (isForbiddenControl(b) && !isAllowedExerciseControl(b)) continue;
      const cls = (b.className || '').toString();
      if (cls && cls.includes('writing-share__submit')) return clickable(b);
      const t = normLower(b.innerText || b.textContent || '');
      const aria = normLower(b.getAttribute && (b.getAttribute('aria-label') || '') || '');
      const testid = normLower(b.getAttribute && (b.getAttribute('data-testid') || '') || '');
      const hit = (s) => sendLabels.some(l => s.includes(l));
      if (hit(t) || hit(aria) || (testid && (testid.includes('send') && testid.includes('community')))) return clickable(b);
    }
  } catch {}
  return null;
}

function findNoThanksButton(nodes) {
  try {
    const labels = [
      'no thanks',
      'non merci',
      'pas merci',
      'nein danke',
      'no gracias',
      'nao obrigado',
      'não obrigado',
      'no grazie'
    ];
    const list = nodes || allNodes(document);
    const dialogRoots = [];
    for (const el of list) {
      if (!el || !el.matches) continue;
      if (el.getAttribute && el.getAttribute('role') === 'dialog') dialogRoots.push(el);
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('modal') || cls.includes('dialog') || cls.includes('overlay')) dialogRoots.push(el);
    }
    const inDialog = (el) => {
      try {
        if (!el || !el.closest) return false;
        if (el.closest('[role="dialog"]')) return true;
        if (el.closest('[aria-modal="true"]')) return true;
        const n = el.closest('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="overlay"], [class*="Overlay"]');
        return !!n;
      } catch {
        return false;
      }
    };
    for (const el of list) {
      if (!el || !el.matches) continue;
      if (!(el.matches('button, a, [role="button"], [tabindex]'))) continue;
      if (!isVisible(el)) continue;
      if (!inDialog(el) && dialogRoots.length === 0) continue;
      const style = window.getComputedStyle(el);
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none';
      if (disabled) continue;
      const txt = normLower(el.innerText || el.textContent || '');
      const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
      const testid = normLower(el.getAttribute && (el.getAttribute('data-testid') || '') || '');
      const hit = (s) => labels.some(l => s.includes(l));
      if (hit(txt) || hit(aria) || (testid && (testid.includes('no') && testid.includes('thanks')))) return clickable(el);
    }
  } catch {}
  return null;
}

function findLetsGoButton(nodes) {
  try {
    const labels = [
      "let's go",
      'lets go',
      "let s go",
      "c'est parti",
      'cest parti',
      'allons y',
      'vamos',
      'los gehts',
      'los geht',
      'andiamo',
      'start quiz',
      'start the quiz',
      'begin quiz',
      'take a quiz',
      'commencer le quiz',
      'démarrer le quiz',
      'demarrer le quiz',
      'lancer le quiz',
      'quiz starten',
      'quiz starten!'
    ];
    const list = nodes || allNodes(document);
    for (const el of list) {
      if (!el || !el.matches) continue;
      if (!(el.matches('button, a, [role="button"], [tabindex]'))) continue;
      if (!isVisible(el)) continue;
      if (isForbiddenControl(el) && !isAllowedExerciseControl(el)) continue;
      const testid = normLower(el.getAttribute && (el.getAttribute('data-testid') || '') || '');
      if (testid && (testid === 'pop-up-card-cta' || testid.includes('pop-up-card-cta'))) return clickable(el);
      const style = window.getComputedStyle(el);
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none';
      if (disabled) continue;
      const txt = normLower(el.innerText || el.textContent || '');
      const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
      const hit = (s) => labels.some(l => s.includes(l));
      if (hit(txt) || hit(aria)) return clickable(el);
    }
  } catch {}
  return null;
}

function findPopupCardCtaButton() {
  try {
    const el = document.querySelector && document.querySelector('[data-testid="pop-up-card-cta"]');
    if (!el) return null;
    if (isVisibleNoPointer(el) && !isInTopBar(el)) return clickable(el);
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      if (n.matches && n.matches('button, a, [role="button"], [tabindex]') && isVisibleNoPointer(n) && !isInTopBar(n)) return clickable(n);
      n = n.parentElement;
    }
  } catch {}
  return null;
}

function isCourseMenuPage() {
  try {
    const p = String(location && location.pathname || '').toLowerCase();
    const okPath = p.includes('/dashboard/learning/course/') || p.includes('/dashboard/timeline/');
    if (!okPath) return false;
    if (p.includes('/finish/')) return false;
    if (p.includes('/exercise') || p.includes('/activity') || p.includes('/practice') || p.includes('/review')) return false;
    return true;
  } catch {
    return false;
  }
}

function hasCssAnimation(el) {
  try {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const name = (style.animationName || '').toLowerCase();
    const dur = style.animationDuration || '';
    if (!name || name === 'none') return false;
    if (dur.includes('0s') && !dur.includes('0.')) return false;
    return true;
  } catch {
    return false;
  }
}

function hasAnimatedMarker(el) {
  try {
    if (!el) return false;
    const cls = ((el.className || '').toString() || '').toLowerCase();
    if (cls.includes('anim') || cls.includes('pulse') || cls.includes('glow') || cls.includes('active') || cls.includes('current') || cls.includes('next')) return true;
    const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
    if (aria.includes('current') || aria.includes('next')) return true;
  } catch {}
  return false;
}

function looksAnimatedLesson(el) {
  try {
    if (!el) return false;
    if (el.getAnimations) {
      try {
        const anims = el.getAnimations({ subtree: true });
        if (anims && anims.length) return true;
      } catch {}
    }
    if (hasAnimatedMarker(el) || hasCssAnimation(el)) return true;
    const nodes = el.querySelectorAll ? Array.from(el.querySelectorAll('*')).slice(0, 90) : [];
    for (const n of nodes) {
      if (hasAnimatedMarker(n) || hasCssAnimation(n)) return true;
    }
  } catch {}
  return false;
}

function getTileProgressValue(el) {
  try {
    if (!el || !el.querySelector) return null;
    const pb = el.querySelector('[role="progressbar"]');
    if (!pb) return null;
    const v = pb.getAttribute && pb.getAttribute('aria-valuenow');
    if (v != null && v !== '') {
      const n = parseFloat(String(v));
      if (Number.isFinite(n)) return n;
    }
    const aria = normLower(pb.getAttribute && (pb.getAttribute('aria-label') || '') || '');
    const m = aria.match(/progress:\s*([0-9]+)\s*%/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return n;
    }
  } catch {}
  return null;
}

function hasZeroProgressMarker(el) {
  const v = getTileProgressValue(el);
  return v != null && v <= 0.01;
}

function isAvoidLessonTile(el) {
  try {
    if (!el) return false;
    const t = normLower((el.innerText || el.textContent || '').slice(0, 800));
    if (!t) return false;
    const avoid = [
      'speaking practice',
      'practice speaking',
      'practise speaking',
      'ai conversations',
      'ai conversation',
      'conversations ia',
      'conversation ia',
      'pratique orale',
      'pratique de l oral',
      "pratique de l'oral",
      'expression orale'
    ];
    return avoid.some(s => t.includes(s));
  } catch {}
  return false;
}

function findAnimatedLessonTileByAnimations() {
  try {
    if (!document.getAnimations) return null;
    const anims = document.getAnimations();
    if (!anims || !anims.length) return null;
    const w = Math.max(1, window.innerWidth || 1);
    const minLeft = w * 0.12;
    const maxRight = w * 0.95;
    const found = [];
    const seen = new Set();
    for (const a of anims) {
      const t = a && a.effect && a.effect.target;
      if (!t || !t.getBoundingClientRect) continue;
      const tr = t.getBoundingClientRect();
      if (tr.width < 2 || tr.height < 2) continue;
      if (tr.top < 80) continue;
      let n = t;
      for (let i = 0; i < 10 && n; i++) {
        if (!n.getBoundingClientRect) { n = n.parentElement; continue; }
        const r = n.getBoundingClientRect();
        if (r.height >= 34 && r.height <= 260 && r.width >= 180 && r.top >= 80 && r.left >= minLeft && r.right <= maxRight) {
          if (!isForbiddenControl(n) && !isInTopBar(n)) {
            const click = clickable(n);
            const key = click || n;
            if (!seen.has(key) && !looksCompleted(key) && !isAvoidLessonTile(key)) {
              seen.add(key);
              const score = (hasZeroProgressMarker(key) ? 50 : 0) + (looksAnimatedLesson(key) ? 10 : 0);
              found.push({ el: key, score, top: key.getBoundingClientRect().top });
            }
            break;
          }
        }
        n = n.parentElement;
      }
    }
    if (!found.length) return null;
    found.sort((a, b) => (b.score - a.score) || (a.top - b.top));
    return found[0].el;
  } catch {}
  return null;
}

function parseRgb(s) {
  const str = String(s || '').trim();
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    }
  }
  return null;
}

function isGreenish(s) {
  const c = parseRgb(s);
  if (!c) return false;
  return c.g >= 140 && c.r <= 140 && c.b <= 140;
}

function looksCompleted(el) {
  try {
    if (!el) return false;
    const pv = getTileProgressValue(el);
    if (pv != null) {
      if (pv >= 99) return true;
      return false;
    }
    const hasAttr = el.querySelector && el.querySelector('[aria-label*="completed" i], [aria-label*="termin" i], [data-qa*="completed" i], [data-testid*="completed" i]');
    if (hasAttr) return true;
    const svgNodes = el.querySelectorAll ? Array.from(el.querySelectorAll('svg, circle, path')).slice(0, 60) : [];
    for (const n of svgNodes) {
      if (n && n.closest && n.closest('[role="progressbar"]')) continue;
      const dt = normLower((n.getAttribute && n.getAttribute('data-testid')) || '');
      if (dt.includes('progress-circle') || dt.includes('base-circle')) continue;
      const style = window.getComputedStyle(n);
      const stroke = style.stroke || (n.getAttribute && n.getAttribute('stroke')) || '';
      const fill = style.fill || (n.getAttribute && n.getAttribute('fill')) || '';
      if (isGreenish(stroke) || isGreenish(fill)) return true;
    }
    const nodes = el.querySelectorAll ? Array.from(el.querySelectorAll('*')).slice(0, 50) : [];
    for (const n of nodes) {
      const style = window.getComputedStyle(n);
      const bw = parseFloat(style.borderTopWidth || '0') || 0;
      if (bw < 2) continue;
      const br = style.borderTopLeftRadius || '';
      const rect = n.getBoundingClientRect();
      const sq = rect.width > 18 && rect.height > 18 && Math.abs(rect.width - rect.height) <= 6 && rect.width <= 90;
      if (!sq) continue;
      if (isGreenish(style.borderTopColor) || isGreenish(style.outlineColor)) return true;
      if (br.includes('%') && parseFloat(br) >= 35 && isGreenish(style.borderTopColor)) return true;
    }
  } catch {}
  return false;
}

function findNextLessonTile() {
  try {
    const byGlobalAnim = findAnimatedLessonTileByAnimations();
    if (byGlobalAnim) return byGlobalAnim;
    const list = allNodes(document);
    const candidates = [];
    for (const raw of list) {
      if (!raw || !raw.matches) continue;
      const role = raw.getAttribute && raw.getAttribute('role');
      const tabindex = raw.getAttribute && raw.getAttribute('tabindex');
      const hasTab = tabindex != null && String(tabindex) !== '-1';
      const isClickableTag = raw.matches('button, a');
      const isClickableRole = role === 'button' || role === 'link';
      const hasOnclick = typeof raw.onclick === 'function';
      const style = window.getComputedStyle(raw);
      const cursor = (style.cursor || '').toLowerCase();
      const cursorPointer = cursor === 'pointer';
      const looksClickable = isClickableTag || isClickableRole || hasTab || hasOnclick || cursorPointer;
      if (!looksClickable) continue;
      const el = clickable(raw);
      if (!el) continue;
      if (!isVisible(el)) continue;
      if (isForbiddenControl(el) || isInTopBar(el)) continue;
      const elStyle = window.getComputedStyle(el);
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || elStyle.pointerEvents === 'none';
      if (disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 34 || rect.height > 220) continue;
      if (rect.width < 180) continue;
      if (rect.top < 80) continue;
      const txt = normLower(el.innerText || el.textContent || '');
      if (txt.length && txt.length > 160) continue;
      if (isAvoidLessonTile(el)) continue;
      if (txt.includes('lets go') || txt.includes("let s go") || txt.includes('cest parti') || txt.includes('no thanks') || txt.includes('continue') || txt.includes('suivant')) continue;
      const href = el.getAttribute && (el.getAttribute('href') || '') || (raw.getAttribute && raw.getAttribute('href')) || '';
      const hrefOk = href && /\/learning\/course\/|\/dashboard\/learning\/course\/|\/dashboard\/learning\/lesson\/|\/learning\/lesson\//i.test(href);
      const hasMedia = !!(el.querySelector && (el.querySelector('img') || el.querySelector('svg') || el.querySelector('[style*="background-image"]')));
      if (!hrefOk && !hasMedia && (!txt || txt.length < 4)) continue;
      candidates.push(el);
    }
    const uniq = Array.from(new Set(candidates)).filter(el => !isAvoidLessonTile(el));
    if (!uniq.length) return null;
    uniq.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const zero = uniq.filter(el => hasZeroProgressMarker(el));
    if (zero.length) return zero[0];
    const animated = uniq.filter(el => looksAnimatedLesson(el));
    if (animated.length) return animated[0];
    let lastCompletedTop = -Infinity;
    for (const el of uniq) {
      if (looksCompleted(el)) {
        const top = el.getBoundingClientRect().top;
        if (top > lastCompletedTop) lastCompletedTop = top;
      }
    }
    const notCompleted = uniq.filter(el => !looksCompleted(el));
    if (!notCompleted.length) return null;
    if (lastCompletedTop === -Infinity) return notCompleted[0];
    const after = notCompleted
      .map(el => ({ el, top: el.getBoundingClientRect().top }))
      .filter(x => x.top > lastCompletedTop + 6)
      .sort((a, b) => a.top - b.top);
    if (after.length) return after[0].el;
    return notCompleted[0];
  } catch {}
  return null;
}

function autoStartNextLessonFromMenu() {
  if (!state.enabled || !state.consent) return false;
  if (state.semiAuto) return false;
  const now = Date.now();
  const quizCta = findPopupCardCtaButton();
  if (quizCta) {
    if (state.quizCtaBurstUntil && now < state.quizCtaBurstUntil) return true;
    if (state.clicked) return true;
    state.clicked = true;
    state.lastClickTime = Date.now();
    state.awaitingLetsGoUntil = 0;
    state.lessonNavCooldownUntil = now + 2500;
    state.quizCtaBurstUntil = now + 2400;
    debugLog('Quiz CTA found, clicking...');
    const attempt = (delay) => setTimeout(() => {
      const btn = findPopupCardCtaButton();
      if (!btn) return;
      clickElHard(btn);
      try { btn.click(); } catch {}
    }, delay);
    attempt(0);
    attempt(220);
    attempt(520);
    attempt(900);
    setTimeout(() => {
      state.clicked = false;
      state.quizCtaBurstUntil = 0;
    }, 1600);
    return true;
  }
  if (state.awaitingLetsGoUntil && now < state.awaitingLetsGoUntil) {
    const letsGo = findLetsGoButton();
    if (letsGo) {
      if (state.clicked) return true;
      state.clicked = true;
      state.lastClickTime = Date.now();
      state.awaitingLetsGoUntil = 0;
      state.lessonNavCooldownUntil = now + 2500;
      setTimeout(() => {
        clickElHard(letsGo);
        setTimeout(() => { state.clicked = false; }, 1200);
      }, 150);
      return true;
    }
    return true;
  }

  if (state.lessonNavCooldownUntil && now < state.lessonNavCooldownUntil) {
    const letsGo = findLetsGoButton();
    if (letsGo) {
      if (state.clicked) return true;
      state.clicked = true;
      state.lastClickTime = Date.now();
      state.awaitingLetsGoUntil = 0;
      state.lessonNavCooldownUntil = now + 2500;
      setTimeout(() => {
        clickElHard(letsGo);
        setTimeout(() => { state.clicked = false; }, 1200);
      }, 150);
      return true;
    }
    return false;
  }

  const letsGo = findLetsGoButton();
  if (letsGo) {
    if (state.clicked) return true;
    state.clicked = true;
    state.lastClickTime = Date.now();
    state.awaitingLetsGoUntil = 0;
    state.lessonNavCooldownUntil = now + 2500;
    setTimeout(() => {
      clickElHard(letsGo);
      setTimeout(() => { state.clicked = false; }, 1200);
    }, 150);
    return true;
  }
  if (!isCourseMenuPage()) return false;
  const next = findNextLessonTile();
  if (!next) return false;
  if (state.clicked) return true;
  state.clicked = true;
  state.lastClickTime = Date.now();
  state.lessonNavCooldownUntil = now + 600;
  state.awaitingLetsGoUntil = now + 6500;
  startMenuFollowUp(7500);
  setTimeout(() => {
    clickEl(next);
    setTimeout(() => { state.clicked = false; }, 1200);
  }, 150);
  return true;
}

function isFinishPage() {
  try {
    const p = location.pathname.toLowerCase();
    return p.includes('/dashboard/learning/course/finish/') || p.includes('/finish/');
  } catch { return false; }
}

function isEndOfLessonScreen() {
  try {
    if (isFinishPage()) return true;
    const txt = normLower((document.body && document.body.innerText) || '');
    if (!txt) return false;
    const win = txt.includes('well done') || txt.includes('great job') || txt.includes('congratulations') || txt.includes('bravo') || txt.includes('bien joue');
    const stats = txt.includes('score') || txt.includes('stars') || txt.includes('etoiles');
    return win && stats;
  } catch { return false; }
}

function isChallengesScreen() {
  try {
    const p = location.pathname.toLowerCase();
    if (p.includes('/dashboard/learning/course/challenge/')) return true;
    if (p.includes('/course/challenge/')) return true;
    const txt = normLower((document.body && document.body.innerText) || '');
    if (!txt) return false;
    return txt.includes("today's challenges") || txt.includes('todays challenges') || txt.includes('defis du jour') || txt.includes('défis du jour');
  } catch { return false; }
}

function findChallengesContinueButton() {
  try {
    const labels = ['continue', 'continuer', 'suivant', 'next'];
    const nodes = allNodes(document);
    const cands = [];
    for (const el of nodes) {
      if (!el || !el.matches) continue;
      if (!el.matches('button, [role="button"], a, [tabindex]')) continue;
      if (!isVisibleNoPointer(el)) continue;
      if (isForbiddenControl(el) && !isAllowedExerciseControl(el)) continue;
      const txt = normLower(el.innerText || el.textContent || '');
      const aria = normLower(el.getAttribute && (el.getAttribute('aria-label') || '') || '');
      const testid = normLower(el.getAttribute && (el.getAttribute('data-testid') || '') || '');
      const qa = normLower(el.getAttribute && (el.getAttribute('data-qa-continue') || el.getAttribute('data-qa-next') || el.getAttribute('data-qa-action') || '') || '');
      const klass = normLower((el.className || '').toString());
      const hit = (s) => labels.some(l => s.includes(l));
      const likely = el.hasAttribute('data-qa-lesson-finished') || hit(txt) || hit(aria) || hit(testid) || hit(qa) || (klass.includes('cta') && hit(txt));
      if (!likely) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 28) continue;
      cands.push(clickable(el));
    }
    if (!cands.length) return null;
    cands.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const db = br.bottom - ar.bottom;
      if (Math.abs(db) > 6) return db;
      return br.right - ar.right;
    });
    return cands[0];
  } catch {}
  return null;
}

function autoContinueChallengesScreen() {
  if (!state.enabled || !state.consent) return false;
  if (!isChallengesScreen()) return false;
  const btn = findChallengesContinueButton() || findContinueButton();
  if (!btn) return false;
  if (state.semiAuto) {
    showOverlay('Continuer');
    highlight(btn);
    return true;
  }
  if (state.clicked) return true;
  clearDelayedAction();
  scheduleClickContinueImmediate(true);
  return true;
}

function findLevelPickerDialog() {
  try {
    const roots = allNodes(document).filter(el => {
      if (!el || !el.matches) return false;
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const ariaModal = (el.getAttribute && el.getAttribute('aria-modal')) || '';
      const cls = (el.className || '').toString().toLowerCase();
      const looksDialog = role === 'dialog' || ariaModal === 'true' || cls.includes('modal') || cls.includes('dialog');
      if (!looksDialog) return false;
      return isVisibleNoPointer(el);
    });
    const hasLevelToken = (t) => /\b(a1|a2|b1|b2|c1|c2)\b/.test(t);
    for (const r of roots) {
      const t = normLower((r.innerText || r.textContent || '').slice(0, 2000));
      if (!t) continue;
      if (!hasLevelToken(t)) continue;
      if (!(t.includes('chapters') || t.includes('chapter') || t.includes('chapitre') || t.includes('capitoli') || t.includes('capítulos'))) continue;
      if (t.includes('cefr') || t.includes('levels explained') || t.includes('niveau') || t.includes('beginner') || t.includes('intermediate') || t.includes('advanced')) {
        return r;
      }
      if (t.includes('beginner a1') || t.includes('elementary a2') || t.includes('intermediate b1') || t.includes('upper intermediate b2') || t.includes('advanced c1') || t.includes('advanced c2')) {
        return r;
      }
    }
  } catch {}
  return null;
}

function findLowestLevelButtonInDialog(dialogRoot) {
  try {
    const order = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
    const parseLevel = (txt) => {
      const m = (txt || '').toLowerCase().match(/\b(a1|a2|b1|b2|c1|c2)\b/);
      return m ? m[1] : null;
    };
    const btns = Array.from(dialogRoot.querySelectorAll('button,[role="button"],a,[tabindex]'));
    const cands = [];
    for (const el of btns) {
      if (!isVisibleNoPointer(el)) continue;
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      if (disabled) continue;
      if (isForbiddenControl(el) && !isAllowedExerciseControl(el)) continue;
      const txt = normLower(el.innerText || el.textContent || '');
      const lvl = parseLevel(txt);
      if (!lvl) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 34) continue;
      cands.push({ el: clickable(el), lvl, rank: order[lvl] || 999, bottom: r.bottom, right: r.right });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => {
      const dr = a.rank - b.rank;
      if (dr) return dr;
      const db = b.bottom - a.bottom;
      if (Math.abs(db) > 6) return db;
      return b.right - a.right;
    });
    return cands[0].el;
  } catch {}
  return null;
}

function autoPickLowestCourseLevel() {
  if (!state.enabled || !state.consent) return false;
  const dialog = findLevelPickerDialog();
  if (!dialog) return false;
  const btn = findLowestLevelButtonInDialog(dialog);
  if (!btn) return false;
  if (state.semiAuto) {
    showOverlay('Niveau: bas');
    highlight(btn);
    return true;
  }
  if (state.clicked) return true;
  clearDelayedAction();
  state.clicked = true;
  state.lastClickTime = Date.now();
  setTimeout(() => {
    clickElHard(btn);
    setTimeout(() => { state.clicked = false; }, 1200);
  }, 150);
  return true;
}

function scheduleClickContinueImmediate(force) {
  if (!force && state.continuePending) return;
  state.continuePending = true;
  let tries = 12;
  const attempt = () => {
    const btn = findContinueButton();
    if (btn) {
      clickElHard(btn);
      state.continuePending = false;
      return;
    }
    tries--;
    if (tries > 0) setTimeout(attempt, 200);
    else state.continuePending = false;
  };
  setTimeout(attempt, 0);
}

function scheduleDismissNoThanksImmediate() {
  if (state.continuePending) return;
  state.continuePending = true;
  let tries = 12;
  const attempt = () => {
    const btn = findNoThanksButton();
    if (btn) {
      clickEl(btn);
      state.continuePending = false;
      return;
    }
    tries--;
    if (tries > 0) setTimeout(attempt, 200);
    else state.continuePending = false;
  };
  setTimeout(attempt, 0);
}

function autoDismissNoThanksModal() {
  if (!state.enabled || !state.consent) return false;
  if (state.semiAuto) return false;
  const btn = findNoThanksButton();
  if (!btn) return false;
  clearDelayedAction();
  scheduleDismissNoThanksImmediate();
  return true;
}

function autoContinueEndScreens() {
  if (!state.enabled || !state.consent) return false;
  if (state.semiAuto) return false;
  if (!isEndOfLessonScreen()) return false;
  if (state.delayMode) {
    return scheduleDelayedHandler('end_continue', () => { scheduleClickContinue(); });
  }
  scheduleClickContinue();
  return true;
}

function trySelectOrderedLettersByPass() {
   // Strategy: use data-qa-pass attribute which indicates order index (0, 1, 2...)
   // This is extremely robust as it relies on internal exercise logic.
   const all = Array.from(document.querySelectorAll('[data-qa-pass]'));
   const candidates = all.filter(el => {
     if (!isVisible(el)) return false;
     // Exclude matchup items which have data-qa-type
     if (el.hasAttribute('data-qa-type')) return false;
     // Must be clickable
     if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button' && !el.classList.contains('ex-btn')) return false;
     return true;
   });
 
   if (candidates.length < 2) return false;
 
   const items = candidates.map(el => {
     const v = parseInt(el.getAttribute('data-qa-pass'), 10);
     return { el, v };
   }).filter(x => !isNaN(x.v));
 
   if (items.length < 2) return false;
 
   // Check for duplicates (if duplicates exist, it might be a matching pair exercise, handled elsewhere)
   const values = items.map(x => x.v);
   const unique = new Set(values);
   if (unique.size !== items.length) return false; // Duplicates found
 
   // Sort by index
   items.sort((a, b) => a.v - b.v);
 
   // Check if it looks like a sequence (dense integers)
   // e.g. 0, 1, 2, 3...
   // Allow starting at 0 or 1
   const first = items[0].v;
   if (first !== 0 && first !== 1) return false;
   
   // Verify continuity (optional but safer)
   for (let i = 0; i < items.length; i++) {
     if (items[i].v !== first + i) return false;
   }
 
   // Execute
   if (state.semiAuto) {
     showOverlay('Ordre auto (Pass)');
     highlight(items[0].el);
     return true;
   }
 
   if (scheduleDelayedHandler('ordered_letters_pass', () => { trySelectOrderedLettersByPass(); })) return true;
 
   if (state.pairingInProgress) return true;
   state.pairingInProgress = true;
 
   let i = 0;
   const clickNext = () => {
     if (i >= items.length) {
       state.pairingInProgress = false;
       scheduleClickContinue();
       return;
     }
     const item = items[i++];
     const prev = item.el.style.outline;
     item.el.style.outline = '3px solid #00e676';
     clickEl(item.el);
     setTimeout(() => {
        if (item.el) item.el.style.outline = prev;
        clickNext();
     }, 300);
   };
   clickNext();
   return true;
 }

function debugLog(msg, data) {
  console.log(`[BusuuHelper Debug] ${msg}`, data || '');
  if (state.debug) {
      showOverlay(`DBG: ${msg} ${data ? JSON.stringify(data).substring(0, 50) : ''}`);
  }
}

function trySelectLetterOrdering() {
  debugLog('Attempting Letter Ordering...');
  
  // 1. Get Answer
  if (!state.answers || state.answers.length === 0) {
    debugLog('No answers found in state.');
    return false;
  }
  
  // 2. Find Candidates: Relaxed Search
  // Look for any element that contains exactly one alphanumeric char
  const allNodes = document.querySelectorAll('div, span, button, li, a');
  let potentialTiles = [];
  
  for (const node of allNodes) {
    if (!isVisible(node)) continue;
    if (isForbiddenControl(node) || isInTopBar(node)) continue;
    // Check text content
    const txt = (node.innerText || node.textContent).trim();
    if (txt.length !== 1) continue;
    
    // Must be alphanumeric
    if (!/[a-zA-Z0-9À-ÿ]/.test(txt)) continue;

    // Check dimensions to ensure it's "tile-like" (not a giant container that happens to have 1 letter visible)
    const rect = node.getBoundingClientRect();
    if (rect.width > 100 || rect.height > 100) continue; // Too big
    if (rect.width < 10 || rect.height < 10) continue; // Too small
    
    // Check if it has children that are also text (avoid selecting containers)
    // Actually, we want the leaf-most element or close to it.
    // If this node has child elements that also have text, skip this node.
    if (node.children.length > 0 && Array.from(node.children).some(c => (c.innerText || c.textContent).trim().length > 0)) {
        continue;
    }

    potentialTiles.push({ el: node, txt: normLower(txt) });
  }

  // Filter out duplicates (sometimes we get the span AND the div wrapper)
  // We prefer the one that is a button or has role button, or just the outer one?
  // Actually, usually we want the clickable one. 
  // Let's filter by position. If two elements have almost same rect, pick the one that is 'button' or higher in hierarchy?
  // Simpler: Just keep them all for now and see if we can match the answer.
  
  debugLog(`Found ${potentialTiles.length} potential tiles`, potentialTiles.map(p => p.txt));

  if (potentialTiles.length < 3) {
      debugLog('Not enough tiles found.');
      return false;
  }

  // Count frequencies
  const candCounts = {};
  for (const p of potentialTiles) {
    candCounts[p.txt] = (candCounts[p.txt] || 0) + 1;
  }

  // Try to match an answer
  for (const ans of state.answers) {
    const ansNorm = normLower(ans);
    debugLog(`Checking answer: ${ansNorm}`);
    
    // Normalize answer to "bag of letters"
    // We need to handle spaces in answer. Usually tiles don't include spaces.
    const ansChars = ansNorm.replace(/\s+/g, '').split('');
    
    const ansCounts = {};
    for (const c of ansChars) ansCounts[c] = (ansCounts[c] || 0) + 1;
    
    // Check if we have enough tiles
    let match = true;
    for (const char in ansCounts) {
      if ((candCounts[char] || 0) < ansCounts[char]) {
        match = false;
        debugLog(`Missing char: ${char}`);
        break;
      }
    }
    
    // Strict check: Do we have EXACTLY the same tiles? 
    // Usually letter ordering uses all tiles.
    if (match) {
        let tileCount = 0;
        for (const char in candCounts) tileCount += candCounts[char];
        if (tileCount !== ansChars.length) {
            debugLog(`Tile count mismatch: Have ${tileCount}, need ${ansChars.length}. trying loose match...`);
            // Loose match allowed? Sometimes there are distractor tiles? 
            // Busuu usually uses exact set. But let's allow loose if strict fails?
            // If loose match is allowed, we need to know the ORDER.
        }
    }

    if (match) {
      debugLog('Match found!');
      
      // We need to determine the click sequence.
      // The answer string gives the order.
      // But we need to map answer chars to specific DOM elements.
      
      const sequence = [];
      const usedIndices = new Set(); // indices in potentialTiles array
      
      // Iterate through the Answer String (including spaces?)
      // Wait, the tiles usually don't have spaces. The answer has spaces.
      // We should iterate the answer characters (skipping spaces).
      
      for (const char of ansChars) {
        // Find a tile with this char that hasn't been used
        const idx = potentialTiles.findIndex((p, i) => p.txt === char && !usedIndices.has(i));
        if (idx === -1) {
            console.error('Logic error: matched counts but couldnt find tile');
            return false;
        }
        sequence.push(potentialTiles[idx].el);
        usedIndices.add(idx);
      }
      
      // Execute
       if (state.semiAuto) {
        showOverlay('Ordre: ' + ans);
        if (sequence.length > 0) highlight(sequence[0]);
        return true;
      }
      if (scheduleDelayedHandler('letter_ordering', () => { trySelectLetterOrdering(); })) return true;

      if (state.pairingInProgress) return true;
      state.pairingInProgress = true;

      let idx = 0;
      const clickNext = () => {
        const el = sequence[idx++];
        if (!el) {
          state.pairingInProgress = false;
          scheduleClickContinue();
          return;
        }
        // Click logic
        const prev = el.style.outline;
        el.style.outline = '3px solid #00e676';
        clickEl(el); // Helper click
        setTimeout(() => {
            if (el) el.style.outline = prev;
            setTimeout(clickNext, 350); // Little slower for visual feedback
        }, 150);
      };
      
      clickNext();
      return true;
    }
  }
  
  debugLog('No answer matched the tiles.');
  return false;
}

function getActiveElement(root = document) {
  const active = root.activeElement;
  if (!active) return null;
  if (active.shadowRoot && active.shadowRoot.activeElement) {
    return getActiveElement(active.shadowRoot);
  }
  return active;
}

function typeIntoElement(el, text) {
  debugLog('typeIntoElement called with:', text);
  if (state.semiAuto) {
    showOverlay('À taper: ' + text);
    highlight(el);
    return true;
  }
  
  if (state.pairingInProgress) return true;
  state.pairingInProgress = true;
  
  showOverlay('Écriture: ' + text);
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  
  // Robust focus and click sequence
  setTimeout(() => {
    // 1. Mouse events
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    
    // 2. Focus
    el.focus();
    
    // 3. Wait for UI response (e.g. cursor activation)
    setTimeout(() => {
        let worked = false;
        const active = getActiveElement();
        
        // If focus didn't stick, try forcing it again
        if (active !== el) {
            debugLog('Retrying focus...');
            el.focus();
        }

        // Attempt 1: execCommand (simulates real typing best)
        try {
            // Some editors require a 'beforeinput' event or similar, but execCommand is standard for contentEditable
            // For inputs/textareas, execCommand might work if focused
            document.execCommand('selectAll', false, null);
            worked = document.execCommand('insertText', false, text);
            debugLog('execCommand insertText result:', worked);
        } catch (e) {
            debugLog('execCommand failed', e);
        }

        if (!worked) {
            debugLog('Fallback to value setter');
            // Attempt 2: Setter
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                el.innerHTML = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // Native setter hack for React
                const proto = Object.getPrototypeOf(el);
                const setter = Object.getOwnPropertyDescriptor(proto, 'value') ? Object.getOwnPropertyDescriptor(proto, 'value').set : null;
                if (setter) {
                    setter.call(el, text);
                } else {
                    el.value = text;
                }
                
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                
                // React tracker
                if (el._valueTracker) {
                    el._valueTracker.setValue(text);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }
        
        // Finalize
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
        
        el.dispatchEvent(new Event('blur', { bubbles: true }));

        setTimeout(() => {
            state.pairingInProgress = false;
            scheduleClickContinue();
        }, 800);
    }, 150); // Increased delay after click
  }, 50);

  return true;
}

function tryTypingAnswer() {
  // Strategy 1: Direct answer in DOM (data-qa-pass attribute)
  // This attribute might be on the input itself OR on a parent wrapper
  const passElements = Array.from(document.querySelectorAll('[data-qa-pass]'));
  
  for (const el of passElements) {
    if (!isVisible(el)) continue;
    const val = el.getAttribute('data-qa-pass');
    
    // Ignore if empty
    if (!val || !val.trim()) continue;
    
    // Determine target input
    let target = null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        target = el;
    } else if (el.isContentEditable) {
        target = el;
    } else {
        // Look for input inside
        target = el.querySelector('input, textarea, [contenteditable]');
    }

    if (!target) continue;
    if (!isVisible(target)) continue;

    // Check if input is already filled
    const currentVal = target.value || target.innerText || '';
    if (currentVal && currentVal.trim() === val) continue;
    
    // Safety: don't overwrite if user typed something else (unless we are sure)
    // For now, let's be helpful and overwrite if it differs? 
    // Or only if empty? User said "rien ne se passe", so likely it is empty.
    if (currentVal && currentVal.trim().length > 0) continue;

    debugLog('Found data-qa-pass answer:', val);
    if (scheduleDelayedHandler('typing_answer', () => { tryTypingAnswer(); })) return true;
    return typeIntoElement(target, val);
  }

  // Strategy 2: Heuristic search (inputs matched against state.answers)
  const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"], div[class*="input"], div[class*="field"]'));
  
  const target = inputs.find(el => {
    if (!isVisible(el)) return false;
    const t = el.getAttribute('type');
    if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button' || t === 'hidden' || t === 'file' || t === 'range') return false;
    // Check for fake input divs
    if (el.tagName === 'DIV' && !el.getAttribute('contenteditable') && el.getAttribute('role') !== 'textbox') {
        if (el.querySelector('input, textarea')) return false;
    }
    return true;
  });

  if (!target) return false;

  const val = target.value || target.textContent || target.innerText || '';
  if (val && val.trim().length > 0) {
      const ph = target.getAttribute('placeholder');
      if (ph && val === ph) {
          // OK
      } else {
          return false;
      }
  }

  const bad = new Set(['true', 'false', 'default', 'error', 'undefined']);
  const candidates = Array.from(state.answers).filter(a => !bad.has(a) && a.length > 0); 
  
  debugLog('Typing Candidates:', candidates);

  if (candidates.length === 0) {
    if (state.debug) showOverlay('Champ trouvé sans réponse');
    return false;
  }

  // Use the first candidate
  if (scheduleDelayedHandler('typing_answer', () => { tryTypingAnswer(); })) return true;
  return typeIntoElement(target, candidates[0]);
}

function trySelectWordOrdering() {
  debugLog('Attempting Word Ordering...');
  if (!state.answers || state.answers.size === 0) {
    debugLog('No answers found in state.');
    return false;
  }

  // 1. Find all word tiles using allNodes (Shadow DOM support)
  const nodes = allNodes(document);
  const tiles = [];
  
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    if (isForbiddenControl(node)) continue;
    
    // Check if it matches our "tile" criteria
    // Must be clickable or look like a tile
    const isClickable = node.matches && (
        node.matches('button, [role="button"], .ex-btn, div[class*="tile"], div[class*="word"], div[class*="token"], span[class*="token"], div[draggable="true"]') ||
        (node.className && typeof node.className === 'string' && (node.className.includes('tile') || node.className.includes('word')))
    );
    
    if (!isClickable) continue;

    // Ignore control buttons
    if (node.getAttribute('data-qa-feedback-cta')) continue;
    if (node.getAttribute('aria-label') === 'Play audio') continue; // Audio buttons
    
    // Get text
    const txt = (node.innerText || node.textContent).trim();
    if (!txt) continue;
    if (txt.length < 1) continue;
    if (txt.length > 35) continue; 
    
    // Must contain letters/numbers
    if (!/[a-zA-Z0-9À-ÿ]/.test(txt)) continue;
    
    tiles.push({ el: node, txt: normLower(txt), raw: txt });
  }

  debugLog(`Found ${tiles.length} tiles`, tiles.map(t => t.txt));

  if (tiles.length < 2) return false;

  // 2. Try to match an answer
  for (const ans of state.answers) {
    const ansNorm = normLower(ans);
    // debugLog(`Check: ${ansNorm}`); 
    
    const ansWords = ansNorm.split(/\s+/).filter(x => x);
    if (ansWords.length === 0) continue;
    
    const usedTiles = new Set();
    const sequence = [];
    let possible = true;
    
    for (const word of ansWords) {
        const tileIdx = tiles.findIndex((t, i) => !usedTiles.has(i) && t.txt === word);
        
        if (tileIdx === -1) {
            possible = false;
            // debugLog(`Missing: ${word}`);
            break;
        }
        
        usedTiles.add(tileIdx);
        sequence.push(tiles[tileIdx].el);
    }
    
    if (possible) {
        debugLog('Match:', ans);
        
        if (state.semiAuto) {
            showOverlay('Ordre mots: ' + ans);
            highlight(sequence[0]);
            return true;
        }

        if (scheduleDelayedHandler('word_ordering', () => { trySelectWordOrdering(); })) return true;
        if (state.pairingInProgress) return true;
        state.pairingInProgress = true;

        let idx = 0;
        const clickNext = () => {
            const el = sequence[idx++];
            if (!el) {
                state.pairingInProgress = false;
                scheduleClickContinue();
                return;
            }
            
            const prev = el.style.outline;
            el.style.outline = '3px solid #00e676';
            clickEl(el);
            setTimeout(() => {
                if (el) el.style.outline = prev;
                setTimeout(clickNext, 450); 
            }, 150);
        };
        
        clickNext();
        return true;
    }
  }

  return false;
}

function trySelectWordPickN() {
  debugLog('Attempting Word Pick...');
  let questionText = '';
  const extractMainLabel = (node) => {
    try {
      const raw = String((node && (node.innerText || node.textContent)) || '').replace(/\r/g, '');
      const lines = raw.split('\n').map(s => String(s || '').trim()).filter(Boolean);
      const nonNums = lines.filter(s => !/^\d+$/.test(s));
      const joined = (nonNums.length ? nonNums : lines).join(' ').trim();
      return joined;
    } catch {
      return '';
    }
  };
  const getQuestionCandidates = () => {
    const out = [];
    try {
      const nodes = Array.from(document.querySelectorAll('h1,h2,h3,[data-qa-exercise-title],[data-testid*="title"],[class*="title"],[class*="question"]'));
      for (const n of nodes) {
        if (!isVisible(n)) continue;
        const t = extractMainLabel(n);
        if (!t) continue;
        if (t.length > 220) continue;
        out.push(t);
      }
    } catch {}
    try {
      const nodes = allNodes(document);
      const w = Math.max(1, window.innerWidth || 1);
      const centerLeft = w * 0.2;
      const centerRight = w * 0.8;
      for (const n of nodes) {
        if (!n || !n.getBoundingClientRect) continue;
        if (!isVisible(n)) continue;
        const r = n.getBoundingClientRect();
        if (r.top < 60 || r.top > 260) continue;
        if (r.left > centerRight || r.right < centerLeft) continue;
        if (r.height < 16 || r.height > 140) continue;
        const t = extractMainLabel(n);
        if (!t) continue;
        if (t.length < 10 || t.length > 220) continue;
        out.push(t);
      }
    } catch {}
    const uniq = [];
    const seen = new Set();
    for (const t of out) {
      const k = normLower(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(t);
    }
    return uniq;
  };
  const parsePickCount = () => {
    const candidates = getQuestionCandidates();
    const scoreQ = (t) => {
      const q = normLower(t);
      let s = 0;
      if (q.includes('which')) s += 5;
      if (q.includes('pick') || q.includes('select') || q.includes('choose')) s += 4;
      if (q.includes('words') || q.includes('mots')) s += 4;
      if (q.includes('filler') || q.includes('um') || q.includes('uh')) s += 3;
      if (q.includes('?')) s += 1;
      return s;
    };
    candidates.sort((a, b) => scoreQ(b) - scoreQ(a));
    let q = candidates[0] || '';
    if (!q) {
      try { q = ((document.body && document.body.innerText) || '').slice(0, 400); } catch {}
    }
    const qNorm = normLower(q);
    questionText = qNorm || '';
    if (!qNorm) return null;
    const map = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
      uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
      eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6,
      due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6
    };
    const m1 = qNorm.match(/\b(which|pick|select|choose)\s+(\d+|one|two|three|four|five|six)\s+(words?|mots?)\b/i);
    if (m1) {
      const v = m1[2];
      const n = /^\d+$/.test(v) ? parseInt(v, 10) : (map[v.toLowerCase()] || null);
      if (n && n >= 1 && n <= 6) return n;
    }
    const m2 = qNorm.match(/\b(quels?|choisis|choisissez|selectionne|sélectionne|selectionnez|sélectionnez)\s+(\d+|un|une|deux|trois|quatre|cinq|six)\s+mots?\b/i);
    if (m2) {
      const v = m2[2];
      const n = /^\d+$/.test(v) ? parseInt(v, 10) : (map[v.toLowerCase()] || null);
      if (n && n >= 1 && n <= 6) return n;
    }
    const m3 = qNorm.match(/\b(\d+)\s+(words?|mots?)\b/i);
    if (m3) {
      const n = parseInt(m3[1], 10);
      if (n && n >= 1 && n <= 6) return n;
    }
    if (qNorm.includes('which') && qNorm.includes('words') && qNorm.includes('filler')) return 2;
    if (qNorm.includes('phrasal verb') || qNorm.includes('verbe a particule') || qNorm.includes('verbe à particule')) return 2;
    return null;
  };

  const isSelected = (el) => {
    try {
      const ariaPressed = el.getAttribute && el.getAttribute('aria-pressed');
      if (ariaPressed === 'true') return true;
      const ariaSelected = el.getAttribute && el.getAttribute('aria-selected');
      if (ariaSelected === 'true') return true;
      const cls = normLower((el.className || '').toString());
      if (cls.includes('selected') || cls.includes('is-selected')) return true;
    } catch {}
    return false;
  };

  const nodes = allNodes(document);
  const tiles = [];
  const tokens = [];
  const seenTiles = new Set();
  const seenTokens = new Set();
  const looksTileRect = (r) => {
    if (!r) return false;
    if (r.width < 24 || r.width > 240) return false;
    if (r.height < 18 || r.height > 120) return false;
    return true;
  };
  const pickClickTarget = (node) => {
    try {
      let n = node;
      for (let i = 0; i < 6 && n; i++) {
        if (!n.getBoundingClientRect) { n = n.parentElement; continue; }
        const r = n.getBoundingClientRect();
        const okRect = looksTileRect(r);
        const okRole = n.matches && n.matches('button,[role="button"],[role="option"]');
        const okTab = n.hasAttribute && n.hasAttribute('tabindex');
        if (okRect && (okRole || okTab)) return n;
        n = n.parentElement;
      }
    } catch {}
    return node;
  };
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    if (isForbiddenControl(node)) continue;
    const isClickable = node.matches && (
      node.matches('button, [role="button"], .ex-btn, li, [tabindex], div[class*="tile"], div[class*="word"], div[class*="token"], span[class*="token"], div[draggable="true"]') ||
      (node.className && typeof node.className === 'string' && (node.className.includes('tile') || node.className.includes('word') || node.className.includes('token')))
    );
    if (!isClickable) continue;
    if (node.getAttribute('data-qa-feedback-cta')) continue;
    if (node.getAttribute('aria-label') === 'Play audio') continue;
    const rawLabel = extractMainLabel(node);
    if (!rawLabel || rawLabel.length < 1 || rawLabel.length > 35) continue;
    const clickTarget = pickClickTarget(node);
    try {
      const r = clickTarget.getBoundingClientRect();
      if (!looksTileRect(r)) continue;
    } catch {}
    const hasWord = /[a-zA-ZÀ-ÿ]/.test(rawLabel);
    const isPunct = rawLabel.length === 1 && ',.;:!?'.includes(rawLabel);
    if (!hasWord && !isPunct) continue;
    if (!seenTokens.has(clickTarget)) {
      seenTokens.add(clickTarget);
      tokens.push({ el: clickTarget, txt: hasWord ? normLower(rawLabel) : '', raw: rawLabel });
    }
    if (!hasWord) continue;
    if (seenTiles.has(clickTarget)) continue;
    seenTiles.add(clickTarget);
    const ids = new Set();
    for (const id of getCandidateIds(node)) ids.add(id);
    for (const id of getCandidateIds(clickTarget)) ids.add(id);
    tiles.push({ el: clickTarget, txt: normLower(rawLabel), raw: rawLabel, ids: Array.from(ids) });
  }

  let pickCount = parsePickCount();
  const isFiller = questionText.includes('filler') || questionText.includes('um') || questionText.includes('uh') || questionText.includes('remplissage') || questionText.includes('tic');
  if (tiles.length < 2) return false;
  debugLog('Word Pick Context', { pickCount, tiles: tiles.length, tokens: tokens.length, isFiller, ans: state.answers ? state.answers.size : 0, ids: state.idAnswers ? state.idAnswers.size : 0 });

  const sortedTiles = tiles.slice().sort((a, b) => {
    const ar = a.el.getBoundingClientRect();
    const br = b.el.getBoundingClientRect();
    const dt = ar.top - br.top;
    if (Math.abs(dt) > 3) return dt;
    return ar.left - br.left;
  });

  const resolveAnswerTextFromIds = () => {
    const out = new Set();
    try {
      if (!state.idAnswers || state.idAnswers.size === 0) return out;
      for (const id of state.idAnswers) {
        const txt = resolveId(id);
        if (!txt) continue;
        const words = normLower(txt).split(/\s+/).filter(Boolean);
        if (!words.length) continue;
        if (words.length === 1) out.add(words[0]);
        else out.add(words.join(' '));
      }
    } catch {}
    return out;
  };
  const resolvedFromIds = resolveAnswerTextFromIds();

  const pickByIds = () => {
    if (!state.idAnswers || state.idAnswers.size < 2) return null;
    const idSet = state.idAnswers;
    const hits = [];
    const seen = new Set();
    for (const t of sortedTiles) {
      for (const id of t.ids) {
        if (idSet.has(id) || idSet.has('entity_' + id) || (id.startsWith('entity_') && idSet.has(id.slice(7)))) {
          if (!seen.has(t.el)) {
            seen.add(t.el);
            hits.push(t.el);
          }
          break;
        }
      }
    }
    if (pickCount && hits.length >= pickCount) return hits.slice(0, pickCount);
    if (!pickCount && hits.length >= 2) return hits;
    return null;
  };

  const pickByCommaGroup = () => {
    if (!tokens.length) return null;
    const sortedTokens = tokens.slice().sort((a, b) => {
      const ar = a.el.getBoundingClientRect();
      const br = b.el.getBoundingClientRect();
      const dt = ar.top - br.top;
      if (Math.abs(dt) > 3) return dt;
      return ar.left - br.left;
    });
    const commaIdx = [];
    for (let i = 0; i < sortedTokens.length; i++) {
      if (sortedTokens[i].raw === ',') commaIdx.push(i);
    }
    const segs = [];
    for (let i = 0; i < commaIdx.length - 1; i++) {
      const seg = sortedTokens.slice(commaIdx[i] + 1, commaIdx[i + 1]);
      const words = seg.filter(t => t.txt);
      if (words.length >= 2 && words.length <= 6) segs.push(words);
    }
    if (!segs.length) return null;
    if (!pickCount) {
      const hasLen2 = segs.some(s => s.length === 2);
      if (hasLen2) pickCount = 2;
      else pickCount = segs[0].length;
    }
    segs.sort((a, b) => {
      const da = Math.abs(a.length - pickCount);
      const db = Math.abs(b.length - pickCount);
      if (da !== db) return da - db;
      return a.length - b.length;
    });
    return segs[0].map(w => w.el);
  };

  const pickByAnswerText = () => {
    if (!state.answers || state.answers.size === 0) return null;
    const tileTexts = new Set(sortedTiles.map(t => t.txt));
    const candidates = [];
    for (const ans of state.answers) {
      const words = normLower(ans).split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      if (pickCount && words.length !== pickCount) continue;
      if (!pickCount && (words.length < 2 || words.length > 6)) continue;
      let ok = true;
      for (const w of words) {
        if (!tileTexts.has(w)) { ok = false; break; }
      }
      if (ok) candidates.push({ ans, words });
    }
    candidates.sort((a, b) => a.words.length - b.words.length);
    for (const c of candidates) {
      const used = new Set();
      const seq = [];
      let ok = true;
      for (const w of c.words) {
        const idx = sortedTiles.findIndex((t, i) => !used.has(i) && t.txt === w);
        if (idx === -1) { ok = false; break; }
        used.add(idx);
        seq.push(sortedTiles[idx].el);
      }
      if (ok && seq.length >= 2) return seq;
    }
    return null;
  };

  const pickBySingleAnswerWords = () => {
    if (!pickCount) return null;
    const tileTexts = new Set(sortedTiles.map(t => t.txt));
    const hits = [];
    const seen = new Set();
    const single = new Set();
    for (const ans of state.answers) {
      const w = normLower(ans).split(/\s+/).filter(Boolean);
      if (w.length === 1) single.add(w[0]);
    }
    for (const w of resolvedFromIds) {
      const ww = normLower(w).split(/\s+/).filter(Boolean);
      if (ww.length === 1) single.add(ww[0]);
    }
    if (single.size === 0) return null;
    for (const w of single) {
      if (!tileTexts.has(w)) continue;
      const t = sortedTiles.find(x => x.txt === w);
      if (t && !seen.has(t.el)) { seen.add(t.el); hits.push(t.el); }
    }
    if (hits.length >= pickCount) return hits.slice(0, pickCount);
    return null;
  };

  const pickByMultiSingleWords = () => {
    if (pickCount) return null;
    const single = new Set();
    for (const ans of state.answers) {
      const w = normLower(ans).split(/\s+/).filter(Boolean);
      if (w.length === 1) single.add(w[0]);
    }
    for (const w of resolvedFromIds) {
      const ww = normLower(w).split(/\s+/).filter(Boolean);
      if (ww.length === 1) single.add(ww[0]);
    }
    if (single.size < 2) return null;
    const hits = [];
    const seen = new Set();
    for (const t of sortedTiles) {
      if (!t || !t.txt) continue;
      if (!single.has(t.txt)) continue;
      if (seen.has(t.el)) continue;
      seen.add(t.el);
      hits.push(t.el);
    }
    if (hits.length >= 2) return hits;
    return null;
  };

  const pickByAdjacentSingles = () => {
    if (pickCount !== 2) return null;
    if (!state.answers || state.answers.size === 0) return null;
    const single = new Set();
    for (const ans of state.answers) {
      const w = normLower(ans).split(/\s+/).filter(Boolean);
      if (w.length === 1) single.add(w[0]);
    }
    if (single.size < 2) return null;
    const ordered = tokens
      .map(t => ({ el: t.el, txt: t.txt, raw: t.raw }))
      .filter(t => t.txt);
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (single.has(a.txt) && single.has(b.txt)) {
        return [a.el, b.el];
      }
    }
    return null;
  };

  let sequence = pickByCommaGroup();
  if (!sequence) sequence = pickByIds();
  if (!sequence) sequence = pickByAdjacentSingles();
  if (!sequence) sequence = pickBySingleAnswerWords();
  if (!sequence) sequence = pickByMultiSingleWords();
  if (!sequence) sequence = pickByAnswerText();
  if (!sequence) return false;

  const toClick = sequence.filter(el => !isSelected(el));
  if (toClick.length === 0) {
    scheduleClickContinueImmediate(true);
    return true;
  }

  if (state.semiAuto) {
    showOverlay('Sélection mots: ' + toClick.length + ' / ' + sequence.length);
    highlight(toClick[0]);
    return true;
  }

  if (scheduleDelayedHandler('word_pick', () => { trySelectWordPickN(); })) return true;
  if (state.pairingInProgress) return true;
  state.pairingInProgress = true;

  let idx = 0;
  const clickNext = () => {
    const el = toClick[idx++];
    if (!el) {
      state.pairingInProgress = false;
      setTimeout(() => scheduleClickContinueImmediate(true), 200);
      return;
    }
    const prev = el.style.outline;
    el.style.outline = '3px solid #00e676';
    clickEl(el);
    setTimeout(() => {
      if (el) el.style.outline = prev;
      setTimeout(clickNext, 260);
    }, 130);
  };
  clickNext();
  return true;
}

function trySelectGapFill() {
  if (isChallengesScreen()) return false;
  debugLog('Attempting Gap Fill...');
  if (!state.answers || state.answers.size === 0) return false;

  // 1. Find tiles (Reuse logic from Word Ordering)
  const nodes = allNodes(document);
  const tiles = [];
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    if (isForbiddenControl(node)) continue;
    const isClickable = node.matches && (
        node.matches('button, [role="button"], .ex-btn, div[class*="tile"], div[class*="word"], div[class*="token"], span[class*="token"], div[draggable="true"]') ||
        (node.className && typeof node.className === 'string' && (node.className.includes('tile') || node.className.includes('word')))
    );
    if (!isClickable) continue;
    if (node.getAttribute('data-qa-feedback-cta')) continue;
    if (node.getAttribute('aria-label') === 'Play audio') continue;
    
    const txt = (node.innerText || node.textContent).trim();
    if (!txt || txt.length < 1 || txt.length > 35) continue;
    if (!/[a-zA-Z0-9À-ÿ]/.test(txt)) continue;
    
    tiles.push({ el: node, txt: normLower(txt), raw: txt });
  }

  if (tiles.length < 2) return false;

  // 2. Check answers
  for (const ans of state.answers) {
    const ansNorm = normLower(ans);
    
    const tilesByText = {};
    for (const t of tiles) {
        if (!tilesByText[t.txt]) tilesByText[t.txt] = [];
        tilesByText[t.txt].push(t);
    }
    
    const finalSequence = [];
    let covered = false;

    for (const txt in tilesByText) {
        const candidates = tilesByText[txt];
        const esc = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${esc}\\b`, 'gi');
        let m;
        const occurrences = [];
        while ((m = re.exec(ansNorm)) !== null) {
            occurrences.push(m.index);
        }
        
        if (occurrences.length > 0) {
            covered = true;
            const count = Math.min(candidates.length, occurrences.length);
            for (let k = 0; k < count; k++) {
                finalSequence.push({ el: candidates[k].el, index: occurrences[k] });
            }
        }
    }
    
    if (covered && finalSequence.length > 0) {
         finalSequence.sort((a, b) => a.index - b.index);
         
         debugLog('Gap Fill Match:', ans);

         if (state.semiAuto) {
             showOverlay('Gap Fill: ' + ans);
             highlight(finalSequence[0].el);
             return true;
         }

         if (scheduleDelayedHandler('gap_fill', () => { trySelectGapFill(); })) return true;
         if (state.pairingInProgress) return true;
         state.pairingInProgress = true;

         let idx = 0;
         const clickNext = () => {
             const item = finalSequence[idx++];
             if (!item) {
                 state.pairingInProgress = false;
                 scheduleClickContinue();
                 return;
             }
             const el = item.el;
             const prev = el.style.outline;
             el.style.outline = '3px solid #00e676';
             clickEl(el);
             setTimeout(() => {
                 if (el) el.style.outline = prev;
                 setTimeout(clickNext, 450);
             }, 150);
         };
         clickNext();
         return true;
    }
  }
  return false;
}

function trySelectWritingMode() {
  const writeLabels = ['write', 'écrire', 'escribir', 'schreiben', 'scrivere', 'escrever'];
  const buttons = document.querySelectorAll('button, [role="button"], .ex-btn');
  
  for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if (isForbiddenControl(btn)) continue;
      const txt = normLower(btn.innerText || btn.textContent);
      
      // Strict check: the button must contain one of the "write" keywords
      // But we must be careful not to click random things.
      // Usually these buttons are in pairs: Speak / Write.
      // Let's check if there is a "Speak" button nearby to confirm context?
      // Or just check if the text is exactly "Write" or "Write response".
      
      if (writeLabels.some(l => txt === l || txt === l + ' response' || txt.includes(l))) {
          // Double check context: usually inside a "choice" container
          // But "Write" is quite specific in this context.
          
          // Avoid false positives:
          if (txt.includes('review') || txt.includes('feedback')) continue;
          
          // Check for "Speak" sibling to confirm it's a choice
          // This is optional but safer.
          // Let's just click it if found, it's low risk if unique.
          
          debugLog('Found Write mode button:', txt);
          
          if (state.semiAuto) {
              showOverlay('Mode: Écrire');
              highlight(btn);
              return true;
          }
          if (scheduleDelayedHandler('writing_mode', () => { trySelectWritingMode(); })) return true;
          
          if (state.clicked) return true;
          state.clicked = true;
          state.lastClickTime = Date.now();
          
          showOverlay('Choix: Écrire');
          
          setTimeout(() => {
             clickEl(btn);
             setTimeout(() => { state.clicked = false; }, 1000);
          }, 300);
          
          return true;
      }
  }
  return false;
}

function tryAutoWriteCommunity() {
  // Use allNodes to find deep elements including Shadow DOM
  const nodes = allNodes(document);
  
  // Explicitly check for the user-provided structure
  // <textarea id="answer" class="sc-bqiRlB kcxYcf writing-share__answer" ...>
  let target = nodes.find(el => {
      if (!isVisible(el)) return false;
      // Check ID
      if (el.id === 'answer') return true;
      // Check Class
      if (el.className && typeof el.className === 'string' && el.className.includes('writing-share__answer')) return true;
      return false;
  });

  if (!target) {
      // Fallback: Find any potential text inputs if specific ID not found
      const inputs = nodes.filter(el => {
          if (!isVisible(el)) return false;
          const tag = el.tagName;
          if (tag === 'TEXTAREA') return true;
          if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
          if (el.getAttribute('role') === 'textbox') return true;
          return false;
      });

      // Filter for "main" writing area
      for (const el of inputs) {
          // Must be big enough to be the main writing area
          if (el.offsetHeight < 60) continue; 
          
          // Avoid feedback forms
          const ph = (el.getAttribute('placeholder') || '').toLowerCase();
          if (ph.includes('feedback') || ph.includes('comment')) continue;
          
          target = el;
          break;
      }
  }

  if (!target) {
      // debugLog('No large textarea found via allNodes.');
      return false;
  }

  // Heuristics to confirm it's a writing exercise
  const bodyText = document.body.innerText || '';
  const m = bodyText.match(/(\d+)\s+(words?|mots?|palabras?|wörter|parole)/i);

  const sendBtn = findSendToCommunityButton(nodes);

  let isWritingContext = false;
  
  // If we found the specific target (writing-share__answer), we are definitely in context
  if (target.id === 'answer' || (target.className && typeof target.className === 'string' && target.className.includes('writing-share__answer'))) {
      isWritingContext = true;
      debugLog('Confirmed Writing Context (Specific ID/Class match)');
  } else if (m || sendBtn) {
      isWritingContext = true;
      debugLog('Confirmed Writing Context (Words left or Send button found)');
  } else {
      // Fallback: Check for absence of other exercise types
      const tiles = nodes.filter(n => n.matches && (n.matches('.tile, .word, .token') || (n.className && typeof n.className === 'string' && (n.className.includes('tile') || n.className.includes('word')))));
      if (tiles.length === 0) {
          debugLog('Assuming Writing Context (Large textarea, no tiles)');
          isWritingContext = true;
      }
  }

  if (!isWritingContext) return false;

  // Determine requirement
  let required = 20; 
  if (m) {
      try { required = parseInt(m[1], 10); } catch(e) {}
  }
  
  // Check if already filled
  const val = target.value || target.innerText || target.textContent || '';
  const currentWords = val.trim().split(/\s+/).length;

  if (val && val.trim().length > 10 && currentWords >= required) {
      // Already filled. Click send if available.
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
          if (state.semiAuto) {
             showOverlay('Prêt à envoyer');
             highlight(sendBtn);
             return true;
          }
          if (state.clicked) return true;
          state.clicked = true;
          state.lastClickTime = Date.now();
          debugLog('Clicking Send button...');
          setTimeout(() => {
              clickEl(sendBtn);
              setTimeout(() => { state.clicked = false; }, 1500);
          }, 500);
          return true;
      }
      return false;
  }

  // Generate random text
  const words = ["the", "be", "to", "of", "and", "a", "in", "that", "have", "I", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time", "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could", "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new", "want", "because", "any", "these", "give", "day", "most", "us"];
  
  let text = "";
  for(let i=0; i < required + 5; i++) {
      text += words[Math.floor(Math.random() * words.length)] + " ";
  }
  text = text.trim() + ".";
  
  debugLog('Auto Writing Random Words...');

  if (state.semiAuto) {
      showOverlay('Auto-Write: Random words');
      highlight(target);
      return true;
  }

  if (scheduleDelayedHandler('auto_write_community', () => { tryAutoWriteCommunity(); })) return true;
  if (state.pairingInProgress) return true;
  
  typeIntoElement(target, text);
  
  // Extra events to trigger word counter
  setTimeout(() => {
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
  }, 200);

  setTimeout(() => {
    if (!state.enabled || !state.consent || state.semiAuto) return;
    const btn = findSendToCommunityButton();
    if (!btn) return;
    const style = window.getComputedStyle(btn);
    const disabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none';
    if (disabled) return;
    if (state.clicked) return;
    state.clicked = true;
    state.lastClickTime = Date.now();
    clickEl(btn);
    setTimeout(() => { state.clicked = false; }, 1500);
  }, 1700);

  return true;
}

function trySelect() {
  if (!state.enabled || !state.consent) return;
  if (autoContinueEndScreens()) return;
  if (autoContinueChallengesScreen()) return;
  if (autoPickLowestCourseLevel()) return;
  if (autoDismissNoThanksModal()) return;
  if (autoStartNextLessonFromMenu()) return;
  if (state.clicked) return;
  const qKey = computeQuestionKey();
  if (qKey && qKey !== state.questionKey) {
    state.questionKey = qKey;
    clearDelayedAction();
  } else if (!state.questionKey && qKey) {
    state.questionKey = qKey;
  }
  if (state.delayPending) {
    const remaining = Math.max(0, state.delayMs - (Date.now() - (state.delayScheduledAt || 0)));
    const act = state.delayAction;
    if (act && act.type === 'handler') {
      showOverlay('Attente: ' + Math.ceil(remaining / 1000) + 's');
      return;
    }
    const el = findDelayedTarget(act);
    if (!el) {
      clearDelayedAction();
    } else {
      highlight(el);
      showOverlay('Attente: ' + Math.ceil(remaining / 1000) + 's');
      return;
    }
  }
  if (trySelectOrderedLettersByPass()) return;
  if (trySelectLetterOrdering()) return;
  if (trySelectWordOrdering()) return;
  if (trySelectWordPickN()) return;
  if (trySelectGapFill()) return;
  if (trySelectWritingMode()) return;
  if (tryAutoWriteCommunity()) return;
  if (tryTypingAnswer()) return;
  if (trySelectMatchupByPass()) return;
  if (trySelectPairs()) return;
  const cands = candidates();
  if (!cands.length) {
    const btn = findContinueButton();
    if (btn) {
      if (state.semiAuto) {
        showOverlay('Continuer');
        highlight(btn);
        return;
      } else {
        state.clicked = true;
        state.lastClickTime = Date.now();
        setTimeout(() => {
          clickElHard(btn);
          setTimeout(() => { state.clicked = false; }, 1000);
        }, 300);
        scheduleClickContinue();
        return;
      }
    }
    dbg('Aucun candidat UI');
    return;
  }
  const passEls = findPassCandidates();
  if (passEls && passEls.length >= 2) {
    const toClick = passEls.filter(el => !isPassSelected(el));
    if (state.semiAuto) {
      showOverlay('Sélection mots: ' + toClick.length + ' / ' + passEls.length);
      if (toClick[0]) highlight(toClick[0]);
      else if (passEls[0]) highlight(passEls[0]);
      return;
    } else {
      if (scheduleDelayedHandler('pass_multi', () => { trySelect(); })) return;
      state.clicked = true;
      state.lastClickTime = Date.now();
      let idx = 0;
      const clickNext = () => {
        const el = toClick[idx++];
        if (!el) {
          setTimeout(() => { state.clicked = false; }, 1200);
          scheduleClickContinue();
          return;
        }
        clickEl(el);
        setTimeout(clickNext, 220);
      };
      setTimeout(clickNext, 220);
      return;
    }
  }
  const passEl = findPassCandidate();
  if (passEl) {
    const maybeSecond = isPhrasalVerbPickPage() ? findNearestRightWordTile(passEl) : null;
    if (state.semiAuto) {
      if (maybeSecond) showOverlay('Réponse: PASS + 2 mots');
      else showOverlay('Réponse: PASS attr');
      highlight(passEl);
      return;
    } else {
      if (scheduleDelayedAnswer({ kind: 'pass', value: 'pass' })) return;
      state.clicked = true;
      state.lastClickTime = Date.now();
      setTimeout(() => {
        clickEl(passEl);
        if (maybeSecond) {
          setTimeout(() => { clickEl(maybeSecond); }, 180);
          setTimeout(() => { state.clicked = false; }, 1400);
        } else {
          setTimeout(() => { state.clicked = false; }, 1200);
        }
      }, 300);
      scheduleClickContinue();
      return;
    }
  }
  const boolAns = state.answers.has('true') ? 'true' : (state.answers.has('false') ? 'false' : null);
  if (boolAns) {
    const boolEl = findBoolCandidate(boolAns);
    if (boolEl) {
      if (state.semiAuto) {
        showOverlay('Réponse: ' + boolAns);
        highlight(boolEl);
        return;
      } else {
        if (scheduleDelayedAnswer({ kind: 'bool', value: boolAns })) return;
        state.clicked = true;
        state.lastClickTime = Date.now();
        setTimeout(() => {
          clickEl(boolEl);
          setTimeout(() => { state.clicked = false; }, 1200);
        }, 300);
        scheduleClickContinue();
        return;
      }
    }
  }
  for (const a of state.answers) {
    for (const el of cands) {
      const t = normLower(el.innerText || el.textContent);
      if (matchText(t, a)) {
        if (state.semiAuto) {
          showOverlay('Réponse: ' + a);
          highlight(el);
          return;
        } else {
          if (scheduleDelayedAnswer({ kind: 'text', value: a })) return;
          state.clicked = true;
          state.lastClickTime = Date.now();
          setTimeout(() => {
            clickEl(el);
            setTimeout(() => { state.clicked = false; }, 1200);
          }, 300);
          scheduleClickContinue();
          return;
        }
      }
    }
  }
  if (state.idAnswers.size) {
    const idSet = state.idAnswers;
    for (const el of cands) {
      const ids = getCandidateIds(el);
      for (const id of ids) {
        if (idSet.has(id) || idSet.has('entity_' + id)) {
          if (state.semiAuto) {
            showOverlay('Réponse ID');
            highlight(el);
            return;
          } else {
            if (scheduleDelayedAnswer({ kind: 'id', value: id })) return;
            state.clicked = true;
            state.lastClickTime = Date.now();
            setTimeout(() => {
              clickEl(el);
              setTimeout(() => { state.clicked = false; }, 1200);
            }, 300);
            scheduleClickContinue();
            return;
          }
        }
      }
      for (const raw of idSet) {
        const txt = resolveId(raw);
        if (txt) {
          const t = normLower(el.innerText || el.textContent);
          if (matchText(t, txt)) {
            if (state.semiAuto) {
              showOverlay('Réponse: ' + txt);
              highlight(el);
              return;
            } else {
              if (scheduleDelayedAnswer({ kind: 'text', value: txt })) return;
              state.clicked = true;
              state.lastClickTime = Date.now();
              setTimeout(() => {
                clickEl(el);
                setTimeout(() => { state.clicked = false; }, 1200);
              }, 300);
              scheduleClickContinue();
              return;
            }
          }
        }
      }
    }
  }
  const btn = findContinueButton();
  if (btn) {
    if (state.semiAuto) {
      showOverlay('Continuer');
      highlight(btn);
      return;
    } else {
      state.clicked = true;
      state.lastClickTime = Date.now();
      setTimeout(() => {
        clickEl(btn);
        setTimeout(() => { state.clicked = false; }, 1000);
      }, 300);
      scheduleClickContinue();
      return;
    }
  }
}

function startObserver() {
  if (state.observer) return;
  state.observer = new MutationObserver(muts => {
    if (state.overlay) {
      const skip = muts.every(m => m.target === state.overlay || state.overlay.contains(m.target));
      if (skip) return;
    }
    scanStaticData();
    scheduleSelect();
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
}

function onMessage(ev) {
  const d = ev.data;
  if (!d || !d.__busuu_helper__) return;
  if (d.type === 'ws_open') {
    state.wsConnected = true;
    if (state.semiAuto) showOverlay('WS connecté');
    dbg('WS ouvert');
    return;
  }
  if (d.type === 'ws_message') {
    const ignoreOps = new Set(['getUserLeaguePosition', 'getMe', 'me', 'flags']);
    if (d.op && ignoreOps.has(d.op)) return;
    if (d.op) state.lastOp = d.op;
    extractAnswers(d.data);
    collectDict(d.data);
    if (state.debug) {
      const lastText = Array.from(state.answers).slice(-1)[0];
      const lastId = Array.from(state.idAnswers || []).slice(-1)[0];
      dbg('Op: ' + (state.lastOp || '') + ' | Réponses: ' + (lastText || lastId || 'undefined'));
    }
    scheduleSelect();
  }
}

function init() {
  inject();
  window.addEventListener('message', onMessage);
  startObserver();
  chrome.storage.sync.get(['enabled', 'consent', 'semiAuto', 'delayMode', 'debug'], v => {
    state.enabled = !!v.enabled;
    state.consent = !!v.consent;
    state.semiAuto = !!v.semiAuto;
    state.delayMode = !!v.delayMode;
    state.debug = !!v.debug;
    if (!state.delayMode) clearDelayedAction();
    scanStaticData();
    scanTranslations();
    scheduleSelect();
    if (state.semiAuto) showOverlay('Prêt');
    dbg('Debug prêt');
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.enabled) state.enabled = !!changes.enabled.newValue;
    if (changes.consent) state.consent = !!changes.consent.newValue;
    if (changes.semiAuto) state.semiAuto = !!changes.semiAuto.newValue;
    if (changes.delayMode) state.delayMode = !!changes.delayMode.newValue;
    if (changes.debug) state.debug = !!changes.debug.newValue;
    if (!state.enabled || !state.consent || !state.delayMode || state.semiAuto) clearDelayedAction();
    scheduleSelect();
    if (state.semiAuto) showOverlay('Prêt');
    dbg('Debug prêt');
  });

  // Boucle de sécurité demandée par l'utilisateur pour ne jamais s'arrêter
  setInterval(() => {
      if (state.enabled && state.consent) {
          // Si on est bloqué en état "clicked" depuis trop longtemps (> 3s), on reset
          if (state.clicked && state.lastClickTime && (Date.now() - state.lastClickTime > 3000)) {
             state.clicked = false;
             state.pairingInProgress = false;
             dbg('Watchdog: Déblocage forcé');
          }
          // Si on est bloqué en pairing trop longtemps, on reset
          if (state.pairingInProgress && state.lastActionTime && (Date.now() - state.lastActionTime > 3500)) {
             state.pairingInProgress = false;
             dbg('Watchdog: Reset pairingInProgress');
          }
          // Si on attend "continue" trop longtemps, on reset le flag
          if (state.continuePending && state.lastActionTime && (Date.now() - state.lastActionTime > 3000)) {
             state.continuePending = false;
          }
          
          // On tente de sélectionner régulièrement
          scheduleSelect();
      }
  }, 1500);
}

init();
function trySelectPairs() {
  if (!state.enabled || !state.consent) return false;
  if (!state.pairs || !state.pairs.length) return false;
  if (state.pairingInProgress) return true;
  const cands = candidates();
  const byText = new Map();
  for (const el of cands) {
    const t = normLower(el.innerText || el.textContent);
    if (t) byText.set(t, el);
  }
  for (const [l, r] of state.pairs) {
    const lTxt = l.startsWith('entity_') ? resolveId(l) || l : l;
    const rTxt = r.startsWith('entity_') ? resolveId(r) || r : r;
    const leftEl = byText.get(lTxt);
    const rightEl = byText.get(rTxt);
    if (leftEl && rightEl) {
      if (state.semiAuto) {
        showOverlay('Pair: ' + lTxt + ' ⇢ ' + rTxt);
        highlight(leftEl);
        return true;
      } else {
        if (scheduleDelayedHandler('pairs', () => { trySelectPairs(); })) return true;
        state.pairingInProgress = true;
        setTimeout(() => {
          clickEl(leftEl);
          setTimeout(() => {
            clickEl(rightEl);
            state.pairingInProgress = false;
          }, 350);
        }, 200);
        return true;
      }
    }
  }
  return false;
}
