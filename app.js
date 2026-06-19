/* ═══════════════════════════════════════════
   貓咪照護紀錄系統 — app.js
   Modules: DB · Utils · Nav · Home · Calendar
            Stats · Cats · Settings · Backup
   ═══════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */
const DB_NAME    = 'CatCareDB';
const DB_VERSION = 1;
const RECORD_TYPES = [
  '吃飯','喝水','尿尿','大便','吃藥','梳毛','剪指甲','驅蟲','看醫生','其他'
];
const TYPE_CLASS = {
  '吃藥':'q-med','梳毛':'q-groom','剪指甲':'q-groom','驅蟲':'q-groom',
  '看醫生':'q-vet','體重':'q-weight'
};

/* ─────────────────────────────────────────
   MODULE: DB
───────────────────────────────────────── */
const DB = (() => {
  let _db = null;

  function open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        // cats store
        if (!db.objectStoreNames.contains('cats')) {
          const s = db.createObjectStore('cats', { keyPath: 'id', autoIncrement: true });
          s.createIndex('name', 'name', { unique: false });
        }
        // records store
        if (!db.objectStoreNames.contains('records')) {
          const s = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
          s.createIndex('catId',   'catId',   { unique: false });
          s.createIndex('date',    'date',    { unique: false });
          s.createIndex('type',    'type',    { unique: false });
          s.createIndex('catDate', ['catId','date'], { unique: false });
        }
        // weights store
        if (!db.objectStoreNames.contains('weights')) {
          const s = db.createObjectStore('weights', { keyPath: 'id', autoIncrement: true });
          s.createIndex('catId', 'catId', { unique: false });
          s.createIndex('date',  'date',  { unique: false });
        }
        // reminders store
        if (!db.objectStoreNames.contains('reminders')) {
          db.createObjectStore('reminders', { keyPath: 'catId' });
        }
        // meta store
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  function tx(stores, mode = 'readonly') {
    return _db.transaction(stores, mode);
  }

  function getAll(store) {
    return new Promise((res, rej) => {
      const r = tx(store).objectStore(store).getAll();
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }

  function get(store, key) {
    return new Promise((res, rej) => {
      const r = tx(store).objectStore(store).get(key);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }

  function put(store, data) {
    return new Promise((res, rej) => {
      const t = tx(store, 'readwrite');
      const r = t.objectStore(store).put(data);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }

  function del(store, key) {
    return new Promise((res, rej) => {
      const t = tx(store, 'readwrite');
      const r = t.objectStore(store).delete(key);
      r.onsuccess = () => res();
      r.onerror   = e => rej(e.target.error);
    });
  }

  function getByIndex(store, indexName, value) {
    return new Promise((res, rej) => {
      const idx = tx(store).objectStore(store).index(indexName);
      const r = idx.getAll(value);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }

  function getRange(store, indexName, lower, upper) {
    return new Promise((res, rej) => {
      const range = IDBKeyRange.bound(lower, upper);
      const idx = tx(store).objectStore(store).index(indexName);
      const r = idx.getAll(range);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => rej(e.target.error);
    });
  }

  return { open, get, getAll, put, del, getByIndex, getRange, tx };
})();

/* ─────────────────────────────────────────
   MODULE: UTILS
───────────────────────────────────────── */
const Utils = (() => {
  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  function nowTime() {
    const d = new Date();
    return d.toTimeString().slice(0, 5);
  }
  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${y}/${m}/${day}`;
  }
  function fmtTime(t) { return t || ''; }
  function fmtDateTime(date, time) {
    return `${fmtDate(date)} ${fmtTime(time)}`;
  }
  function calcAge(birthday) {
    if (!birthday) return '';
    const b = new Date(birthday), n = new Date();
    let y = n.getFullYear() - b.getFullYear();
    let m = n.getMonth()    - b.getMonth();
    if (m < 0) { y--; m += 12; }
    if (y > 0) return `${y} 歲 ${m} 個月`;
    return `${m} 個月`;
  }
  function daysBetween(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr), n = new Date();
    n.setHours(0,0,0,0); d.setHours(0,0,0,0);
    return Math.round((d - n) / 86400000);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  // Compress image to base64
  function compressImage(file, maxW = 400, maxH = 400, quality = .75) {
    return new Promise(res => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxW || h > maxH) {
            const r = Math.min(maxW/w, maxH/h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          res(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { today, nowTime, fmtDate, fmtTime, fmtDateTime, calcAge, daysBetween, uid, compressImage, downloadJSON, downloadBlob };
})();

/* ─────────────────────────────────────────
   MODULE: TOAST
───────────────────────────────────────── */
const Toast = (() => {
  const wrap = document.getElementById('toast-wrap');

  function show(msg, type = '', duration = 2400) {
    const el = document.createElement('div');
    el.className = `toast${type ? ' ' + type : ''}`;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toastOut .2s ease forwards';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }
  return { show };
})();

/* ─────────────────────────────────────────
   MODULE: MODAL
───────────────────────────────────────── */
const Modal = (() => {
  function open(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }
  function closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }

  // Wire close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => close(btn.dataset.close));
  });
  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(overlay.id);
    });
  });

  return { open, close, closeAll };
})();

/* ─────────────────────────────────────────
   MODULE: CONFIRM
───────────────────────────────────────── */
const Confirm = (() => {
  let _cb = null;

  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    Modal.close('modal-confirm');
    if (_cb) { _cb(); _cb = null; }
  });

  function show({ title = '確定要刪除？', msg = '此操作無法復原', icon = '🗑️', cb }) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-icon').textContent = icon;
    _cb = cb;
    Modal.open('modal-confirm');
  }
  return { show };
})();

/* ─────────────────────────────────────────
   MODULE: NAV
───────────────────────────────────────── */
const Nav = (() => {
  const pages = document.querySelectorAll('.page');
  const items  = document.querySelectorAll('.nav-item');

  function goto(pageId) {
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${pageId}`));
    items.forEach(i => i.classList.toggle('active', i.dataset.page === pageId));

    // Refresh page on switch
    if (pageId === 'home')     Home.refresh();
    if (pageId === 'cal')      Cal.refresh();
    if (pageId === 'stats')    Stats.refresh();
    if (pageId === 'cats')     Cats.refresh();
    if (pageId === 'settings') Settings.refresh();
  }

  items.forEach(item => {
    item.addEventListener('click', () => goto(item.dataset.page));
  });

  return { goto };
})();

/* ─────────────────────────────────────────
   MODULE: STATE (shared cache)
───────────────────────────────────────── */
const State = (() => {
  let cats = [];
  let reminders = {};

  async function loadCats() {
    cats = await DB.getAll('cats');
    // Load reminders
    const rs = await DB.getAll('reminders');
    reminders = {};
    rs.forEach(r => { reminders[r.catId] = r; });
    return cats;
  }

  function getCats() { return cats; }
  function getReminder(catId) { return reminders[catId] || {}; }
  function getCatById(id) { return cats.find(c => c.id === id); }

  function avatarEl(cat, size = 44) {
    const div = document.createElement('div');
    div.className = 'cat-avatar';
    div.style.width = size + 'px';
    div.style.height = size + 'px';
    if (cat && cat.photo) {
      const img = document.createElement('img');
      img.src = cat.photo; img.alt = cat.name;
      div.appendChild(img);
    } else {
      div.textContent = '🐱';
    }
    return div;
  }

  return { loadCats, getCats, getReminder, getCatById, avatarEl };
})();

/* ─────────────────────────────────────────
   MODULE: HOME
───────────────────────────────────────── */
const Home = (() => {
  let _pendingQuick = null; // { catId, type }

  async function refresh() {
    await State.loadCats();
    renderReminders();
    renderTimelines();
  }

  // ── Reminders ──
  function renderReminders() {
    const sec = document.getElementById('remind-section');
    sec.innerHTML = '';
    const cats = State.getCats();
    if (!cats.length) return;

    const cards = [];
    const now = new Date();
    const hhmm = now.toTimeString().slice(0,5);

    cats.forEach(cat => {
      const r = State.getReminder(cat.id);

      // Feed time
      if (r.feedTime) {
        const diff = diffMinutes(hhmm, r.feedTime);
        if (Math.abs(diff) <= 60) {
          cards.push({ type: diff < 0 ? 'info' : 'warn', icon: '🍚',
            strong: `${cat.name} 餵飯提醒`,
            text: diff < 0 ? `已過 ${-diff} 分鐘（${r.feedTime}）` : `還有 ${diff} 分鐘（${r.feedTime}）` });
        }
      }
      // Med time
      if (r.medTime) {
        const diff = diffMinutes(hhmm, r.medTime);
        if (Math.abs(diff) <= 60) {
          cards.push({ type: 'urgent', icon: '💊',
            strong: `${cat.name} 吃藥提醒`,
            text: diff < 0 ? `已過 ${-diff} 分鐘（${r.medTime}）` : `還有 ${diff} 分鐘（${r.medTime}）` });
        }
      }
      // Nail
      if (r.nailCycle && r.nailLast) {
        const dueDate = addDays(r.nailLast, r.nailCycle);
        const days = Utils.daysBetween(dueDate);
        if (days !== null && days <= 7) {
          cards.push({ type: days < 0 ? 'urgent' : days <= 3 ? 'warn' : 'info',
            icon: '✂️', strong: `${cat.name} 剪指甲`,
            text: days < 0 ? `已超過 ${-days} 天` : days === 0 ? '今天需要剪' : `${days} 天後` });
        }
      }
      // Deworm
      if (r.dewormCycle && r.dewormLast) {
        const dueDate = addDays(r.dewormLast, r.dewormCycle);
        const days = Utils.daysBetween(dueDate);
        if (days !== null && days <= 14) {
          cards.push({ type: days < 0 ? 'urgent' : days <= 3 ? 'warn' : 'info',
            icon: '🐛', strong: `${cat.name} 驅蟲`,
            text: days < 0 ? `已超過 ${-days} 天` : days === 0 ? '今天需要驅蟲' : `${days} 天後` });
        }
      }
      // Vet
      if (r.vetDate) {
        const days = Utils.daysBetween(r.vetDate);
        if (days !== null && days <= 14) {
          cards.push({ type: days < 0 ? 'urgent' : days <= 3 ? 'warn' : 'info',
            icon: '🏥', strong: `${cat.name} 回診`,
            text: days < 0 ? `已過期 ${-days} 天` : days === 0 ? '今天回診' : `${days} 天後（${Utils.fmtDate(r.vetDate)}）` });
        }
      }
    });

    if (!cards.length) return;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; wrapper.style.gap = '8px';
    cards.forEach(c => {
      const el = document.createElement('div');
      el.className = `remind-card ${c.type}`;
      el.innerHTML = `<span class="remind-icon">${c.icon}</span>
        <div class="remind-text"><strong>${c.strong}</strong><span>${c.text}</span></div>`;
      wrapper.appendChild(el);
    });
    sec.appendChild(wrapper);
  }

  function diffMinutes(a, b) {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return (bh * 60 + bm) - (ah * 60 + am);
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  }

  // ── Timelines ──
  async function renderTimelines() {
    const wrap = document.getElementById('home-timelines');
    wrap.innerHTML = '';
    const cats = State.getCats();
    if (!cats.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🐾</div>
        <div class="empty-title">尚未新增貓咪</div>
        <div class="empty-desc">前往「貓咪」頁面新增你的第一隻貓咪吧！</div>
      </div>`;
      return;
    }

    const todayStr = Utils.today();
    // Get today's records
    const records = await DB.getByIndex('records', 'date', todayStr);
    const recordsByCat = {};
    records.forEach(r => {
      if (!recordsByCat[r.catId]) recordsByCat[r.catId] = [];
      recordsByCat[r.catId].push(r);
    });

    for (const cat of cats) {
      const card = buildCatSection(cat, recordsByCat[cat.id] || []);
      wrap.appendChild(card);
    }
  }

  function buildCatSection(cat, records) {
    records.sort((a, b) => a.time.localeCompare(b.time));

    const card = document.createElement('div');
    card.className = 'card cat-section';

    // Header
    const header = document.createElement('div');
    header.className = 'cat-section-header';
    const av = State.avatarEl(cat, 44);
    const nameBlock = document.createElement('div');
    nameBlock.className = 'cat-name-block';
    nameBlock.innerHTML = `<div class="name">${cat.name}</div>
      <div class="meta">今天 ${records.length} 筆紀錄</div>`;
    header.appendChild(av);
    header.appendChild(nameBlock);
    card.appendChild(header);

    // Timeline
    const tl = document.createElement('div');
    tl.className = 'timeline';
    if (records.length === 0) {
      tl.innerHTML = `<div class="tl-empty">今天還沒有紀錄 ✨</div>`;
    } else {
      records.forEach(rec => tl.appendChild(buildTlItem(rec, cat)));
    }
    card.appendChild(tl);

    // Quick buttons
    const qwrap = document.createElement('div');
    qwrap.className = 'quick-btns';
    RECORD_TYPES.forEach(t => {
      const btn = document.createElement('button');
      btn.className = `q-btn${TYPE_CLASS[t] ? ' ' + TYPE_CLASS[t] : ''}`;
      btn.textContent = t;
      btn.addEventListener('click', () => quickLog(cat.id, t, btn, card, tl, records));
      qwrap.appendChild(btn);
    });
    card.appendChild(qwrap);

    return card;
  }

  function buildTlItem(rec, cat) {
    const el = document.createElement('div');
    el.className = 'tl-item';
    el.dataset.id = rec.id;
    el.innerHTML = `
      <div class="tl-dot"></div>
      <div class="tl-time">${rec.time}</div>
      <div style="flex:1;">
        <div class="tl-label">${rec.type}</div>
        ${rec.note ? `<div class="tl-note">${rec.note}</div>` : ''}
      </div>
      <div class="tl-actions">
        <button class="tl-btn edit">編輯</button>
        <button class="tl-btn del">刪除</button>
      </div>`;
    el.querySelector('.edit').addEventListener('click', () => Records.openEdit(rec.id));
    el.querySelector('.del').addEventListener('click', () => {
      Confirm.show({ cb: async () => {
        await DB.del('records', rec.id);
        Toast.show('已刪除', 'success');
        Home.refresh();
      }});
    });
    return el;
  }

  async function quickLog(catId, type, btn, card, tl, records) {
    const now = new Date();
    const date = now.toISOString().slice(0,10);
    const time = now.toTimeString().slice(0,5);

    // Flash animation
    btn.classList.add('active-flash');
    setTimeout(() => btn.classList.remove('active-flash'), 450);

    // For types that benefit from a note, show quick note modal
    const noteTypes = ['吃藥','看醫生','其他'];
    if (noteTypes.includes(type)) {
      _pendingQuick = { catId, type, date, time };
      document.getElementById('quick-note-title').textContent = `${type} — 新增備註`;
      document.getElementById('quick-note-input').value = '';
      Modal.open('modal-quick-note');
      return;
    }

    const rec = { catId, type, date, time, note: '', createdAt: Date.now() };
    const id = await DB.put('records', rec);
    rec.id = id;
    records.push(rec);
    records.sort((a,b) => a.time.localeCompare(b.time));

    // Update timeline
    tl.innerHTML = '';
    const cat = State.getCatById(catId);
    records.forEach(r => tl.appendChild(buildTlItem(r, cat)));

    // Update meta count
    card.querySelector('.cat-name-block .meta').textContent = `今天 ${records.length} 筆紀錄`;

    Toast.show(`✓ ${type}`, 'success', 1600);
  }

  // Quick note handlers
  document.getElementById('quick-note-skip').addEventListener('click', async () => {
    if (!_pendingQuick) { Modal.close('modal-quick-note'); return; }
    const { catId, type, date, time } = _pendingQuick;
    await DB.put('records', { catId, type, date, time, note: '', createdAt: Date.now() });
    _pendingQuick = null;
    Modal.close('modal-quick-note');
    Toast.show(`✓ ${type}`, 'success', 1600);
    Home.refresh();
  });
  document.getElementById('quick-note-save').addEventListener('click', async () => {
    if (!_pendingQuick) { Modal.close('modal-quick-note'); return; }
    const { catId, type, date, time } = _pendingQuick;
    const note = document.getElementById('quick-note-input').value.trim();
    await DB.put('records', { catId, type, date, time, note, createdAt: Date.now() });
    _pendingQuick = null;
    Modal.close('modal-quick-note');
    Toast.show(`✓ ${type}`, 'success', 1600);
    Home.refresh();
  });

  // Top add button
  document.getElementById('btn-add-record-top').addEventListener('click', () => Records.openNew());

  return { refresh };
})();

/* ─────────────────────────────────────────
   MODULE: RECORDS (add/edit)
───────────────────────────────────────── */
const Records = (() => {
  // Populate cat select
  function populateCatSel(selId, selectedCatId = null) {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    State.getCats().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id; opt.textContent = cat.name;
      if (selectedCatId && cat.id === selectedCatId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // Populate type select
  function populateTypeSel(selId, selected = '') {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    RECORD_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      if (t === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function openNew(catId = null, type = null) {
    document.getElementById('modal-record-title').textContent = '新增紀錄';
    document.getElementById('record-edit-id').value = '';
    populateCatSel('record-cat', catId || (State.getCats()[0]?.id));
    populateTypeSel('record-type', type || RECORD_TYPES[0]);
    document.getElementById('record-date').value = Utils.today();
    document.getElementById('record-time').value = Utils.nowTime();
    document.getElementById('record-note').value = '';
    Modal.open('modal-record');
  }

  async function openEdit(id) {
    const rec = await DB.get('records', id);
    if (!rec) return;
    document.getElementById('modal-record-title').textContent = '編輯紀錄';
    document.getElementById('record-edit-id').value = rec.id;
    populateCatSel('record-cat', rec.catId);
    populateTypeSel('record-type', rec.type);
    document.getElementById('record-date').value = rec.date;
    document.getElementById('record-time').value = rec.time;
    document.getElementById('record-note').value = rec.note || '';
    Modal.open('modal-record');
  }

  document.getElementById('btn-save-record').addEventListener('click', async () => {
    const id   = document.getElementById('record-edit-id').value;
    const catId= parseInt(document.getElementById('record-cat').value);
    const type = document.getElementById('record-type').value;
    const date = document.getElementById('record-date').value;
    const time = document.getElementById('record-time').value;
    const note = document.getElementById('record-note').value.trim();

    if (!catId || !type || !date || !time) {
      Toast.show('請填寫必填欄位', 'error'); return;
    }
    const rec = { catId, type, date, time, note, createdAt: Date.now() };
    if (id) rec.id = parseInt(id);

    await DB.put('records', rec);
    Modal.close('modal-record');
    Toast.show(id ? '已更新' : '已新增', 'success');
    Home.refresh();
    if (Cal._currentPage === 'cal') Cal.refresh();
  });

  return { openNew, openEdit };
})();

/* ─────────────────────────────────────────
   MODULE: CALENDAR
───────────────────────────────────────── */
const Cal = (() => {
  let _year, _month, _selected = null;
  _currentPage = 'home';

  function refresh() {
    _currentPage = 'cal';
    const now = new Date();
    if (!_year) { _year = now.getFullYear(); _month = now.getMonth(); }
    renderCal();
  }

  async function renderCal() {
    const now   = new Date();
    const today = Utils.today();

    // Label
    document.getElementById('cal-month-label').textContent =
      `${_year} 年 ${_month + 1} 月`;

    // DOW headers
    const dowEl = document.getElementById('cal-dow');
    dowEl.innerHTML = '';
    ['日','一','二','三','四','五','六'].forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-dow'; el.textContent = d;
      dowEl.appendChild(el);
    });

    // Get all dates with records in this month
    const fromDate = `${_year}-${String(_month+1).padStart(2,'0')}-01`;
    const lastDay  = new Date(_year, _month+1, 0).getDate();
    const toDate   = `${_year}-${String(_month+1).padStart(2,'0')}-${lastDay}`;
    let monthRecords = [];
    try { monthRecords = await DB.getRange('records', 'date', fromDate, toDate); } catch(e) {}
    const datesWithRecords = new Set(monthRecords.map(r => r.date));

    // Days grid
    const daysEl = document.getElementById('cal-days');
    daysEl.innerHTML = '';

    const firstDay = new Date(_year, _month, 1).getDay();
    const totalDays = new Date(_year, _month+1, 0).getDate();
    const prevTotal = new Date(_year, _month, 0).getDate();

    // Prev month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const el = document.createElement('div');
      el.className = 'cal-day other-month';
      el.textContent = prevTotal - i;
      daysEl.appendChild(el);
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${_year}-${String(_month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const el = document.createElement('div');
      el.className = 'cal-day';
      el.textContent = d;
      if (dateStr === today) el.classList.add('today');
      if (datesWithRecords.has(dateStr)) el.classList.add('has-records');
      if (dateStr === _selected) el.classList.add('selected');
      el.addEventListener('click', () => selectDay(dateStr));
      daysEl.appendChild(el);
    }

    // Next month padding
    const filled = firstDay + totalDays;
    const remain = filled % 7 === 0 ? 0 : 7 - (filled % 7);
    for (let i = 1; i <= remain; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day other-month';
      el.textContent = i;
      daysEl.appendChild(el);
    }
  }

  async function selectDay(dateStr) {
    _selected = dateStr;
    renderCal();

    const records = await DB.getByIndex('records', 'date', dateStr);
    const detail  = document.getElementById('cal-day-detail');
    const title   = document.getElementById('cal-detail-title');
    const body    = document.getElementById('cal-detail-body');

    title.textContent = `${Utils.fmtDate(dateStr)} 的紀錄`;
    body.innerHTML = '';
    detail.style.display = 'block';

    if (!records.length) {
      body.innerHTML = `<div class="empty-state" style="padding:20px 0;">
        <div class="empty-icon">📝</div>
        <div class="empty-title">這天沒有紀錄</div></div>`;
      return;
    }

    records.sort((a,b) => a.time.localeCompare(b.time));
    const cats = State.getCats();
    const catMap = {};
    cats.forEach(c => { catMap[c.id] = c; });

    // Group by cat
    const byCat = {};
    records.forEach(r => {
      if (!byCat[r.catId]) byCat[r.catId] = [];
      byCat[r.catId].push(r);
    });

    Object.entries(byCat).forEach(([catId, recs]) => {
      const cat = catMap[parseInt(catId)];
      if (!cat) return;
      const sec = document.createElement('div');
      sec.style.marginBottom = '12px';
      sec.innerHTML = `<div class="section-label" style="margin-bottom:6px;">${cat.name}</div>`;
      const tl = document.createElement('div');
      tl.className = 'timeline';
      recs.forEach(rec => {
        const item = document.createElement('div');
        item.className = 'tl-item';
        item.innerHTML = `
          <div class="tl-dot"></div>
          <div class="tl-time">${rec.time}</div>
          <div style="flex:1;">
            <div class="tl-label">${rec.type}</div>
            ${rec.note ? `<div class="tl-note">${rec.note}</div>` : ''}
          </div>
          <div class="tl-actions">
            <button class="tl-btn edit">編輯</button>
            <button class="tl-btn del">刪除</button>
          </div>`;
        item.querySelector('.edit').addEventListener('click', () => Records.openEdit(rec.id));
        item.querySelector('.del').addEventListener('click', () => {
          Confirm.show({ cb: async () => {
            await DB.del('records', rec.id);
            Toast.show('已刪除', 'success');
            selectDay(dateStr);
            renderCal();
          }});
        });
        tl.appendChild(item);
      });
      sec.appendChild(tl);
      body.appendChild(sec);
    });
  }

  document.getElementById('cal-prev').addEventListener('click', () => {
    _month--; if (_month < 0) { _month = 11; _year--; }
    _selected = null; renderCal();
    document.getElementById('cal-day-detail').style.display = 'none';
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    _month++; if (_month > 11) { _month = 0; _year++; }
    _selected = null; renderCal();
    document.getElementById('cal-day-detail').style.display = 'none';
  });

  return { refresh, _currentPage };
})();

/* ─────────────────────────────────────────
   MODULE: STATS
───────────────────────────────────────── */
const Stats = (() => {
  let _selectedCatId = 'all';
  let _period = 'week';
  let _weightChart = null;
  let _reportMonth = null;

  async function refresh() {
    await State.loadCats();
    renderCatSwitcher();
    await renderStats();
    await renderWeight();
    renderReportMonthSel();
    await renderReport();
  }

  function renderCatSwitcher() {
    const wrap = document.getElementById('stats-cat-switcher');
    wrap.innerHTML = '';
    const all = document.createElement('div');
    all.className = `cat-chip cat-chip-all${_selectedCatId === 'all' ? ' active' : ''}`;
    all.textContent = '全部';
    all.addEventListener('click', () => { _selectedCatId = 'all'; renderCatSwitcher(); renderStats(); renderWeight(); });
    wrap.appendChild(all);

    State.getCats().forEach(cat => {
      const chip = document.createElement('div');
      chip.className = `cat-chip${_selectedCatId === cat.id ? ' active' : ''}`;
      const av = document.createElement('div');
      av.className = 'chip-av';
      if (cat.photo) {
        const img = document.createElement('img'); img.src = cat.photo;
        av.appendChild(img);
      } else { av.textContent = '🐱'; }
      chip.appendChild(av);
      chip.appendChild(document.createTextNode(cat.name));
      chip.addEventListener('click', () => { _selectedCatId = cat.id; renderCatSwitcher(); renderStats(); renderWeight(); });
      wrap.appendChild(chip);
    });
  }

  async function renderStats() {
    const now = new Date();
    let from;
    if (_period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      from = d.toISOString().slice(0,10);
    } else {
      from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    }
    const to = Utils.today();

    let records;
    try { records = await DB.getRange('records','date', from, to); } catch(e) { records = []; }

    if (_selectedCatId !== 'all') {
      records = records.filter(r => r.catId === _selectedCatId);
    }

    const counts = {};
    ['吃飯','喝水','尿尿','大便'].forEach(t => {
      counts[t] = records.filter(r => r.type === t).length;
    });

    const grid = document.getElementById('stats-grid');
    grid.innerHTML = '';
    [['吃飯','🍚'],['喝水','💧'],['尿尿','🚽'],['大便','💩']].forEach(([t, icon]) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `<div class="stat-num">${counts[t]}</div>
        <div class="stat-lbl">${icon} ${t}</div>
        <div class="stat-sub">${_period === 'week' ? '本週' : '本月'}</div>`;
      grid.appendChild(card);
    });
  }

  async function renderWeight() {
    let weights;
    try {
      if (_selectedCatId !== 'all') {
        weights = await DB.getByIndex('weights','catId', _selectedCatId);
      } else {
        weights = await DB.getAll('weights');
      }
    } catch(e) { weights = []; }
    weights.sort((a,b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||''));

    const canvas = document.getElementById('weight-chart');
    if (_weightChart) { _weightChart.destroy(); _weightChart = null; }

    if (!weights.length) {
      canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
      return;
    }

    const cats = State.getCats();
    const catMap = {};
    cats.forEach(c => { catMap[c.id] = c.name; });

    // If single cat or all, group by cat for multi-line
    const grouped = {};
    weights.forEach(w => {
      if (!grouped[w.catId]) grouped[w.catId] = [];
      grouped[w.catId].push(w);
    });

    const colors = ['#D9A86C','#64B5F6','#8BC34A','#FFB74D','#EF5350','#CE93D8'];
    const datasets = Object.entries(grouped).map(([catId, ws], i) => ({
      label: catMap[parseInt(catId)] || `貓 ${catId}`,
      data: ws.map(w => ({ x: w.date, y: parseFloat(w.weight) })),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      tension: .35,
      pointRadius: 4,
      pointBackgroundColor: colors[i % colors.length],
      fill: false,
    }));

    _weightChart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: { size: 11 }, color: '#7A6250' }},
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y} kg` }}
        },
        scales: {
          x: { type:'category', ticks: { color:'#A89280', font:{size:10} }, grid:{color:'#EDE8DF'} },
          y: { ticks: { color:'#A89280', font:{size:10}, callback: v => v + 'kg' }, grid:{color:'#EDE8DF'} }
        }
      }
    });
  }

  function renderReportMonthSel() {
    const sel = document.getElementById('report-month-sel');
    sel.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
      sel.appendChild(opt);
    }
    if (!_reportMonth) _reportMonth = sel.value;
    sel.value = _reportMonth;
    sel.addEventListener('change', () => { _reportMonth = sel.value; renderReport(); });
  }

  async function renderReport() {
    if (!_reportMonth) return;
    const [y, m] = _reportMonth.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const from = `${_reportMonth}-01`;
    const to   = `${_reportMonth}-${String(lastDay).padStart(2,'0')}`;

    let records, weights;
    try { records = await DB.getRange('records','date', from, to); } catch(e) { records=[]; }
    try { weights = await DB.getRange('weights','date', from, to); } catch(e) { weights=[]; }

    const body = document.getElementById('report-body');
    body.innerHTML = '';

    const cats = State.getCats();
    if (!cats.length) {
      body.innerHTML = '<div class="text-sm text-muted" style="padding:8px 0;">尚無資料</div>';
      return;
    }

    cats.forEach(cat => {
      const recs = records.filter(r => r.catId === cat.id);
      const ws   = weights.filter(w => w.catId === cat.id).sort((a,b)=>a.date.localeCompare(b.date));
      const wt0  = ws[0]?.weight, wt1 = ws[ws.length-1]?.weight;
      const wtChange = (wt0 && wt1) ? ((parseFloat(wt1) - parseFloat(wt0)).toFixed(2)) : null;

      const block = document.createElement('div');
      block.className = 'report-cat-block';
      block.innerHTML = `
        <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:4px;">${cat.name}</div>
        ${[['吃飯','🍚'],['喝水','💧'],['尿尿','🚽'],['大便','💩'],['吃藥','💊'],['看醫生','🏥']].map(([t,i]) =>
          `<div class="report-row"><span>${i} ${t}</span><span>${recs.filter(r=>r.type===t).length} 次</span></div>`
        ).join('')}
        ${wtChange !== null ? `<div class="report-row"><span>⚖️ 體重變化</span>
          <span style="color:${parseFloat(wtChange)>0?'var(--error)':parseFloat(wtChange)<0?'var(--success)':'var(--text-3)'}">
          ${parseFloat(wtChange)>0?'+':''}${wtChange} kg</span></div>` : ''}
      `;
      body.appendChild(block);
    });
  }

  // Period tabs
  document.querySelectorAll('.period-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _period = tab.dataset.period;
      renderStats();
    });
  });

  // Export buttons
  document.getElementById('btn-export-png').addEventListener('click', () => exportReport('png'));
  document.getElementById('btn-export-pdf').addEventListener('click', () => exportReport('pdf'));
  document.getElementById('prompt-export-png').addEventListener('click', () => exportReport('png'));
  document.getElementById('prompt-export-pdf').addEventListener('click', () => exportReport('pdf'));

  async function exportReport(format) {
    const canvas = document.getElementById('export-canvas');
    const ctx = canvas.getContext('2d');
    const W = 800, H = 1000;
    canvas.width = W; canvas.height = H;

    // Background
    ctx.fillStyle = '#FFFDF9';
    ctx.fillRect(0,0,W,H);

    // Header
    ctx.fillStyle = '#D9A86C';
    ctx.fillRect(0,0,W,80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('貓咪照護月報', W/2, 52);

    // Month label
    ctx.fillStyle = '#A67C52';
    ctx.font = '18px sans-serif';
    ctx.fillText(_reportMonth ? _reportMonth.replace('-','年')+'月' : '', W/2, 108);

    // Data
    const [y, m] = (_reportMonth||'').split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const from = `${_reportMonth}-01`, to = `${_reportMonth}-${String(lastDay).padStart(2,'0')}`;
    let records = [], weights = [];
    try { records = await DB.getRange('records','date', from, to); } catch(e) {}
    try { weights = await DB.getRange('weights','date', from, to); } catch(e) {}

    const cats = State.getCats();
    let y2 = 140;
    ctx.textAlign = 'left';

    cats.forEach(cat => {
      const recs = records.filter(r => r.catId === cat.id);
      ctx.fillStyle = '#3D2B1F';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(cat.name, 60, y2); y2 += 30;

      [['吃飯','🍚'],['喝水','💧'],['尿尿','🚽'],['大便','💩']].forEach(([t]) => {
        ctx.fillStyle = '#7A6250';
        ctx.font = '14px sans-serif';
        const cnt = recs.filter(r=>r.type===t).length;
        ctx.fillText(`  ${t}: ${cnt} 次`, 60, y2);
        y2 += 24;
      });
      y2 += 12;
    });

    // Footer
    ctx.fillStyle = '#A89280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`產生於 ${new Date().toLocaleDateString('zh-TW')}`, W/2, H - 20);

    if (format === 'png') {
      canvas.toBlob(blob => Utils.downloadBlob(blob, `貓咪月報_${_reportMonth}.png`));
    } else {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation:'portrait', unit:'px', format:[W,H] });
      pdf.addImage(canvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, W, H);
      pdf.save(`貓咪月報_${_reportMonth}.pdf`);
    }
    Toast.show('匯出成功！', 'success');
  }

  return { refresh, exportReport, getReportMonth: () => _reportMonth };
})();

/* ─────────────────────────────────────────
   MODULE: CATS
───────────────────────────────────────── */
const Cats = (() => {
  let _photoData = null;

  async function refresh() {
    await State.loadCats();
    render();
  }

  function render() {
    const list = document.getElementById('cats-list');
    list.innerHTML = '';
    const cats = State.getCats();
    if (!cats.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🐾</div>
        <div class="empty-title">還沒有貓咪</div>
        <div class="empty-desc">點擊右上角「＋」新增你的第一隻貓咪！</div>
      </div>`;
      return;
    }
    cats.forEach(cat => list.appendChild(buildCatCard(cat)));
  }

  function buildCatCard(cat) {
    const card = document.createElement('div');
    card.className = 'cat-card';
    const av = document.createElement('div');
    av.className = 'cat-card-av';
    if (cat.photo) {
      const img = document.createElement('img'); img.src = cat.photo;
      av.appendChild(img);
    } else { av.textContent = '🐱'; }

    const info = document.createElement('div');
    info.className = 'cat-card-info';
    const age = cat.birthday ? ` · ${Utils.calcAge(cat.birthday)}` : '';
    const gender = cat.gender ? `${cat.gender}` : '';
    info.innerHTML = `
      <div class="cat-card-name">${cat.name}</div>
      <div class="cat-card-meta">
        ${[gender, cat.birthday ? Utils.fmtDate(cat.birthday) : '', age].filter(Boolean).join(' ')}
        ${cat.chip ? `<br>晶片：${cat.chip}` : ''}
        ${cat.note ? `<br>${cat.note}` : ''}
      </div>
      <div class="cat-card-actions">
        <button class="btn btn-secondary btn-sm">編輯</button>
        <button class="btn btn-secondary btn-sm">提醒設定</button>
        <button class="btn btn-danger btn-sm">刪除</button>
      </div>`;

    info.querySelector('.cat-card-actions button:nth-child(1)').addEventListener('click', () => openEdit(cat));
    info.querySelector('.cat-card-actions button:nth-child(2)').addEventListener('click', () => Reminders.openFor(cat));
    info.querySelector('.cat-card-actions button:nth-child(3)').addEventListener('click', () => {
      Confirm.show({ title: `刪除 ${cat.name}？`, msg: '貓咪的所有紀錄也將一併刪除。', icon: '😿', cb: async () => {
        await DB.del('cats', cat.id);
        // Delete associated records, weights, reminders
        const rs = await DB.getByIndex('records','catId', cat.id);
        const ws = await DB.getByIndex('weights','catId', cat.id);
        for (const r of rs) await DB.del('records', r.id);
        for (const w of ws) await DB.del('weights', w.id);
        await DB.del('reminders', cat.id);
        Toast.show(`${cat.name} 已刪除`, 'success');
        await State.loadCats();
        render();
      }});
    });

    card.appendChild(av);
    card.appendChild(info);
    return card;
  }

  function openNew() {
    document.getElementById('modal-cat-title').textContent = '新增貓咪';
    document.getElementById('cat-edit-id').value = '';
    document.getElementById('cat-name').value = '';
    document.getElementById('cat-gender').value = '';
    document.getElementById('cat-birthday').value = '';
    document.getElementById('cat-chip').value = '';
    document.getElementById('cat-weight').value = '';
    document.getElementById('cat-note').value = '';
    _photoData = null;
    const pu = document.getElementById('cat-photo-upload');
    pu.innerHTML = `<span class="photo-upload-icon">🐱</span>
      <span class="photo-upload-text">點擊上傳照片</span>
      <input type="file" id="cat-photo-input" accept="image/*">`;
    pu.querySelector('input').addEventListener('change', handlePhotoChange);
    Modal.open('modal-cat');
  }

  function openEdit(cat) {
    document.getElementById('modal-cat-title').textContent = '編輯貓咪';
    document.getElementById('cat-edit-id').value = cat.id;
    document.getElementById('cat-name').value = cat.name || '';
    document.getElementById('cat-gender').value = cat.gender || '';
    document.getElementById('cat-birthday').value = cat.birthday || '';
    document.getElementById('cat-chip').value = cat.chip || '';
    document.getElementById('cat-weight').value = '';
    document.getElementById('cat-note').value = cat.note || '';
    _photoData = cat.photo || null;

    const pu = document.getElementById('cat-photo-upload');
    if (cat.photo) {
      pu.innerHTML = `<img src="${cat.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
        <input type="file" id="cat-photo-input" accept="image/*">`;
    } else {
      pu.innerHTML = `<span class="photo-upload-icon">🐱</span>
        <span class="photo-upload-text">點擊上傳照片</span>
        <input type="file" id="cat-photo-input" accept="image/*">`;
    }
    pu.querySelector('input').addEventListener('change', handlePhotoChange);
    Modal.open('modal-cat');
  }

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    _photoData = await Utils.compressImage(file);
    const pu = document.getElementById('cat-photo-upload');
    pu.innerHTML = `<img src="${_photoData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
      <input type="file" id="cat-photo-input" accept="image/*">`;
    pu.querySelector('input').addEventListener('change', handlePhotoChange);
  }

  document.getElementById('cat-photo-upload').addEventListener('click', function() {
    const inp = this.querySelector('input[type=file]');
    if (inp) inp.click();
  });
  document.getElementById('cat-photo-upload').querySelector('input').addEventListener('change', handlePhotoChange);

  document.getElementById('btn-save-cat').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) { Toast.show('請輸入貓咪名字', 'error'); return; }

    const idVal = document.getElementById('cat-edit-id').value;
    const cat = {
      name,
      gender:   document.getElementById('cat-gender').value,
      birthday: document.getElementById('cat-birthday').value,
      chip:     document.getElementById('cat-chip').value.trim(),
      note:     document.getElementById('cat-note').value.trim(),
      photo:    _photoData,
      createdAt: Date.now(),
    };
    if (idVal) cat.id = parseInt(idVal);

    const savedId = await DB.put('cats', cat);

    // If initial weight provided, add weight record
    const wt = parseFloat(document.getElementById('cat-weight').value);
    if (wt > 0 && !idVal) {
      await DB.put('weights', {
        catId: savedId, weight: wt,
        date: Utils.today(), time: Utils.nowTime(),
        note: '初始體重'
      });
    }

    Modal.close('modal-cat');
    Toast.show(idVal ? '已更新' : '已新增貓咪', 'success');
    await State.loadCats();
    render();
  });

  document.getElementById('btn-add-cat').addEventListener('click', openNew);

  return { refresh, openNew, openEdit };
})();

/* ─────────────────────────────────────────
   MODULE: REMINDERS
───────────────────────────────────────── */
const Reminders = (() => {
  async function openFor(cat) {
    const r = await DB.get('reminders', cat.id) || { catId: cat.id };
    document.getElementById('modal-reminder-title').textContent = `${cat.name} 的提醒設定`;
    document.getElementById('reminder-cat-id').value = cat.id;
    document.getElementById('remind-feed').value         = r.feedTime    || '';
    document.getElementById('remind-med').value          = r.medTime     || '';
    document.getElementById('remind-nail').value         = r.nailCycle   || '';
    document.getElementById('remind-nail-last').value    = r.nailLast    || '';
    document.getElementById('remind-deworm').value       = r.dewormCycle || '';
    document.getElementById('remind-deworm-last').value  = r.dewormLast  || '';
    document.getElementById('remind-vet').value          = r.vetDate     || '';
    Modal.open('modal-reminder');
  }

  document.getElementById('btn-save-reminder').addEventListener('click', async () => {
    const catId = parseInt(document.getElementById('reminder-cat-id').value);
    const r = {
      catId,
      feedTime:    document.getElementById('remind-feed').value,
      medTime:     document.getElementById('remind-med').value,
      nailCycle:   parseInt(document.getElementById('remind-nail').value)   || null,
      nailLast:    document.getElementById('remind-nail-last').value,
      dewormCycle: parseInt(document.getElementById('remind-deworm').value) || null,
      dewormLast:  document.getElementById('remind-deworm-last').value,
      vetDate:     document.getElementById('remind-vet').value,
    };
    await DB.put('reminders', r);
    Modal.close('modal-reminder');
    Toast.show('提醒已儲存', 'success');
    await State.loadCats();
    Home.refresh();
  });

  return { openFor };
})();

/* ─────────────────────────────────────────
   MODULE: WEIGHT
───────────────────────────────────────── */
const Weight = (() => {
  let _selCatId = null;

  function renderCatSwitcher() {
    const wrap = document.getElementById('weight-cat-switcher');
    wrap.innerHTML = '';
    const cats = State.getCats();
    if (!cats.length) return;
    if (!_selCatId) _selCatId = cats[0]?.id;

    cats.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = `cat-chip${_selCatId === cat.id ? ' active' : ''}`;
      const av = document.createElement('div');
      av.className = 'chip-av';
      if (cat.photo) { const img = document.createElement('img'); img.src = cat.photo; av.appendChild(img); }
      else av.textContent = '🐱';
      chip.appendChild(av);
      chip.appendChild(document.createTextNode(cat.name));
      chip.addEventListener('click', () => { _selCatId = cat.id; renderCatSwitcher(); renderList(); });
      wrap.appendChild(chip);
    });
  }

  async function renderList() {
    const listEl = document.getElementById('weight-list');
    listEl.innerHTML = '';
    if (!_selCatId) return;
    const weights = (await DB.getByIndex('weights','catId',_selCatId))
      .sort((a,b) => b.date.localeCompare(a.date) || (b.time||'').localeCompare(a.time||''));

    if (!weights.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:16px 0;">
        <div class="empty-icon">⚖️</div>
        <div class="empty-title">尚無體重紀錄</div></div>`;
      return;
    }

    const listWrap = document.createElement('div');
    listWrap.className = 'weight-list';
    weights.forEach((w, i) => {
      const prev = weights[i + 1];
      let diffHtml = '';
      if (prev) {
        const diff = (parseFloat(w.weight) - parseFloat(prev.weight)).toFixed(2);
        const cls  = parseFloat(diff) > 0 ? 'up' : parseFloat(diff) < 0 ? 'dn' : 'eq';
        diffHtml = `<span class="weight-diff ${cls}">${parseFloat(diff) > 0 ? '+' : ''}${diff} kg</span>`;
      }
      const item = document.createElement('div');
      item.className = 'weight-item';
      item.innerHTML = `
        <span class="weight-date">${Utils.fmtDate(w.date)} ${w.time || ''}</span>
        <span class="weight-val">${w.weight} kg</span>
        ${diffHtml}
        <div style="display:flex;gap:6px;margin-left:4px;">
          <button class="tl-btn edit" style="font-size:.7rem;">編輯</button>
          <button class="tl-btn del" style="font-size:.7rem;">刪除</button>
        </div>`;
      item.querySelector('.edit').addEventListener('click', () => openEdit(w));
      item.querySelector('.del').addEventListener('click', () => {
        Confirm.show({ cb: async () => {
          await DB.del('weights', w.id);
          Toast.show('已刪除', 'success');
          renderList();
        }});
      });
      listWrap.appendChild(item);
    });
    listEl.appendChild(listWrap);
  }

  function openNew() {
    document.getElementById('modal-weight-title').textContent = '新增體重';
    document.getElementById('weight-edit-id').value = '';
    // populate cat select
    const sel = document.getElementById('weight-cat');
    sel.innerHTML = '';
    State.getCats().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id; opt.textContent = cat.name;
      if (cat.id === _selCatId) opt.selected = true;
      sel.appendChild(opt);
    });
    document.getElementById('weight-date').value = Utils.today();
    document.getElementById('weight-time').value = Utils.nowTime();
    document.getElementById('weight-val').value  = '';
    document.getElementById('weight-note').value = '';
    Modal.open('modal-weight');
  }

  function openEdit(w) {
    document.getElementById('modal-weight-title').textContent = '編輯體重';
    document.getElementById('weight-edit-id').value = w.id;
    const sel = document.getElementById('weight-cat');
    sel.innerHTML = '';
    State.getCats().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id; opt.textContent = cat.name;
      if (cat.id === w.catId) opt.selected = true;
      sel.appendChild(opt);
    });
    document.getElementById('weight-date').value = w.date;
    document.getElementById('weight-time').value = w.time || '';
    document.getElementById('weight-val').value  = w.weight;
    document.getElementById('weight-note').value = w.note || '';
    Modal.open('modal-weight');
  }

  document.getElementById('btn-save-weight').addEventListener('click', async () => {
    const idVal = document.getElementById('weight-edit-id').value;
    const catId = parseInt(document.getElementById('weight-cat').value);
    const date  = document.getElementById('weight-date').value;
    const time  = document.getElementById('weight-time').value;
    const weight = parseFloat(document.getElementById('weight-val').value);
    const note  = document.getElementById('weight-note').value.trim();
    if (!catId || !date || isNaN(weight) || weight <= 0) {
      Toast.show('請填寫必填欄位', 'error'); return;
    }
    const rec = { catId, date, time, weight, note, createdAt: Date.now() };
    if (idVal) rec.id = parseInt(idVal);
    await DB.put('weights', rec);
    Modal.close('modal-weight');
    Toast.show('體重已儲存', 'success');
    _selCatId = catId;
    renderCatSwitcher();
    renderList();
  });

  document.getElementById('btn-add-weight').addEventListener('click', () => {
    if (!State.getCats().length) { Toast.show('請先新增貓咪', 'error'); return; }
    openNew();
  });

  async function init() {
    await State.loadCats();
    renderCatSwitcher();
    await renderList();
  }

  return { init, renderCatSwitcher, renderList };
})();

/* ─────────────────────────────────────────
   MODULE: SETTINGS
───────────────────────────────────────── */
const Settings = (() => {
  async function refresh() {
    await State.loadCats();
    Weight.renderCatSwitcher();
    Weight.renderList();
    renderReminderSettings();
    renderSearchTypePills();
  }

  function renderReminderSettings() {
    const list = document.getElementById('reminder-settings-list');
    list.innerHTML = '';
    const cats = State.getCats();
    if (!cats.length) {
      list.innerHTML = `<div class="setting-item"><div class="setting-text"><div class="setting-desc">尚未新增貓咪</div></div></div>`;
      return;
    }
    cats.forEach(cat => {
      const item = document.createElement('div');
      item.className = 'setting-item';
      const av = State.avatarEl(cat, 36);
      av.style.borderRadius = '50%';
      const text = document.createElement('div');
      text.className = 'setting-text';
      text.innerHTML = `<div class="setting-title">${cat.name}</div><div class="setting-desc">設定餵飯、吃藥、剪指甲等提醒</div>`;
      item.appendChild(av);
      item.appendChild(text);
      item.innerHTML += '<span class="setting-arrow">›</span>';
      item.addEventListener('click', () => Reminders.openFor(cat));
      list.appendChild(item);
    });
  }

  function renderSearchTypePills() {
    const wrap = document.getElementById('search-type-pills');
    wrap.innerHTML = '';
    const all = document.createElement('div');
    all.className = 'filter-pill active';
    all.textContent = '全部';
    all.dataset.type = '';
    wrap.appendChild(all);
    RECORD_TYPES.forEach(t => {
      const p = document.createElement('div');
      p.className = 'filter-pill';
      p.textContent = t; p.dataset.type = t;
      wrap.appendChild(p);
    });
    wrap.querySelectorAll('.filter-pill').forEach(p => {
      p.addEventListener('click', () => {
        wrap.querySelectorAll('.filter-pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
      });
    });
  }

  document.getElementById('btn-search').addEventListener('click', async () => {
    const from    = document.getElementById('search-date-from').value;
    const to      = document.getElementById('search-date-to').value;
    const keyword = document.getElementById('search-keyword').value.trim().toLowerCase();
    const typeEl  = document.querySelector('#search-type-pills .filter-pill.active');
    const type    = typeEl ? typeEl.dataset.type : '';

    let records;
    try {
      if (from && to) {
        records = await DB.getRange('records','date', from, to);
      } else if (from) {
        records = await DB.getRange('records','date', from, Utils.today());
      } else {
        records = await DB.getAll('records');
      }
    } catch(e) { records = await DB.getAll('records'); }

    if (type) records = records.filter(r => r.type === type);
    if (keyword) records = records.filter(r =>
      r.type.includes(keyword) || (r.note||'').toLowerCase().includes(keyword) ||
      (State.getCatById(r.catId)?.name||'').toLowerCase().includes(keyword));

    records.sort((a,b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = '';
    if (!records.length) {
      resultsEl.innerHTML = `<div class="card"><div class="card-body">
        <div class="empty-state" style="padding:20px 0;"><div class="empty-icon">🔍</div>
        <div class="empty-title">無符合結果</div></div></div></div>`;
      return;
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="card-header"><span class="card-title">找到 ${records.length} 筆</span></div>`;
    const body = document.createElement('div');
    body.className = 'card-body';
    body.style.paddingTop = '4px';

    records.forEach(rec => {
      const cat = State.getCatById(rec.catId);
      const item = document.createElement('div');
      item.className = 'record-item';
      item.innerHTML = `
        <div class="record-type-badge">${rec.type}</div>
        <div class="record-meta">
          <div class="record-cat">${cat?.name || '未知'}</div>
          <div class="record-time">${Utils.fmtDate(rec.date)} ${rec.time}</div>
          ${rec.note ? `<div class="record-note">${rec.note}</div>` : ''}
        </div>
        <div class="record-actions">
          <button class="tl-btn edit">編輯</button>
          <button class="tl-btn del">刪除</button>
        </div>`;
      item.querySelector('.edit').addEventListener('click', () => Records.openEdit(rec.id));
      item.querySelector('.del').addEventListener('click', () => {
        Confirm.show({ cb: async () => {
          await DB.del('records', rec.id);
          Toast.show('已刪除', 'success');
          document.getElementById('btn-search').click();
        }});
      });
      body.appendChild(item);
    });
    card.appendChild(body);
    resultsEl.appendChild(card);
  });

  return { refresh };
})();

/* ─────────────────────────────────────────
   MODULE: BACKUP
───────────────────────────────────────── */
const Backup = (() => {
  async function exportAll() {
    const cats    = await DB.getAll('cats');
    const records = await DB.getAll('records');
    const weights = await DB.getAll('weights');
    const reminders = await DB.getAll('reminders');
    const data = { version: 1, exportedAt: new Date().toISOString(), cats, records, weights, reminders };
    Utils.downloadJSON(data, `貓咪紀錄_全部備份_${Utils.today()}.json`);
    Toast.show('已匯出完整備份', 'success');
  }

  async function exportRange(from, to) {
    if (!from || !to) { Toast.show('請選擇日期區間', 'error'); return; }
    const cats     = await DB.getAll('cats');
    const reminders = await DB.getAll('reminders');
    let records = [], weights = [];
    try { records = await DB.getRange('records','date', from, to); } catch(e) {}
    try { weights = await DB.getRange('weights','date', from, to); } catch(e) {}
    Utils.downloadJSON({ version:1, exportedAt: new Date().toISOString(), cats, records, weights, reminders },
      `貓咪紀錄_${from}_${to}.json`);
    Toast.show('已匯出', 'success');
  }

  async function exportMonth(month) {
    if (!month) { Toast.show('請選擇月份', 'error'); return; }
    const [y, m] = month.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    await exportRange(`${month}-01`, `${month}-${String(lastDay).padStart(2,'0')}`);
  }

  async function exportByCats(catIds) {
    if (!catIds.length) { Toast.show('請選擇貓咪', 'error'); return; }
    const allCats  = await DB.getAll('cats');
    const cats     = allCats.filter(c => catIds.includes(c.id));
    const allReminders = await DB.getAll('reminders');
    const reminders = allReminders.filter(r => catIds.includes(r.catId));
    let records = [], weights = [];
    for (const id of catIds) {
      const rs = await DB.getByIndex('records','catId', id);
      const ws = await DB.getByIndex('weights','catId', id);
      records.push(...rs); weights.push(...ws);
    }
    Utils.downloadJSON({ version:1, exportedAt: new Date().toISOString(), cats, records, weights, reminders },
      `貓咪紀錄_${cats.map(c=>c.name).join('_')}.json`);
    Toast.show('已匯出', 'success');
  }

  async function restore(data, mode) {
    if (!data || !data.cats) { Toast.show('無效的備份檔', 'error'); return; }

    if (mode === 'overwrite') {
      // Clear existing
      const existing = await DB.getAll('records');
      for (const r of existing) await DB.del('records', r.id);
      const ew = await DB.getAll('weights');
      for (const w of ew) await DB.del('weights', w.id);
      const ec = await DB.getAll('cats');
      for (const c of ec) await DB.del('cats', c.id);
      const er = await DB.getAll('reminders');
      for (const r of er) await DB.del('reminders', r.catId);
    }

    // Restore
    for (const cat of data.cats || []) await DB.put('cats', cat);
    for (const rec of data.records || []) await DB.put('records', rec);
    for (const w of data.weights || []) await DB.put('weights', w);
    for (const r of data.reminders || []) await DB.put('reminders', r);

    Toast.show(`還原完成！新增 ${data.records?.length || 0} 筆紀錄`, 'success');
    Modal.close('modal-restore');
    await State.loadCats();
    Home.refresh();
  }

  // Wire buttons
  document.getElementById('btn-backup-all').addEventListener('click', exportAll);

  document.getElementById('btn-backup-range').addEventListener('click', () => {
    const now = Utils.today();
    document.getElementById('backup-range-from').value = now.slice(0,8) + '01';
    document.getElementById('backup-range-to').value   = now;
    Modal.open('modal-backup-range');
  });
  document.getElementById('btn-do-backup-range').addEventListener('click', () => {
    exportRange(
      document.getElementById('backup-range-from').value,
      document.getElementById('backup-range-to').value
    );
    Modal.close('modal-backup-range');
  });

  document.getElementById('btn-backup-month').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('backup-month-val').value =
      `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    Modal.open('modal-backup-month');
  });
  document.getElementById('btn-do-backup-month').addEventListener('click', () => {
    exportMonth(document.getElementById('backup-month-val').value);
    Modal.close('modal-backup-month');
  });

  document.getElementById('btn-backup-cat').addEventListener('click', async () => {
    await State.loadCats();
    const list = document.getElementById('backup-cat-list');
    list.innerHTML = '';
    State.getCats().forEach(cat => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;';
      label.innerHTML = `<input type="checkbox" value="${cat.id}" style="width:18px;height:18px;accent-color:var(--primary);">
        <span style="font-size:.9rem;font-weight:600;">${cat.name}</span>`;
      list.appendChild(label);
    });
    Modal.open('modal-backup-cat');
  });
  document.getElementById('btn-do-backup-cat').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('#backup-cat-list input:checked')].map(i => parseInt(i.value));
    exportByCats(checked);
    Modal.close('modal-backup-cat');
  });

  document.getElementById('btn-restore').addEventListener('click', () => {
    document.getElementById('restore-file').value = '';
    Modal.open('modal-restore');
  });
  document.getElementById('btn-do-restore').addEventListener('click', async () => {
    const file = document.getElementById('restore-file').files[0];
    if (!file) { Toast.show('請選擇備份檔', 'error'); return; }
    const mode = document.getElementById('restore-mode').value;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await restore(data, mode);
    } catch(e) { Toast.show('檔案格式錯誤', 'error'); }
  });

  return { exportAll };
})();

/* ─────────────────────────────────────────
   MODULE: MONTHLY PROMPT
───────────────────────────────────────── */
const MonthlyPrompt = (() => {
  async function check() {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    let lastSeen;
    try {
      const m = await DB.get('meta', 'lastMonthSeen');
      lastSeen = m?.value;
    } catch(e) {}

    if (lastSeen === thisMonth) return; // Already shown this month

    // Check if previous month has data
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
    const lastDay = new Date(prevDate.getFullYear(), prevDate.getMonth()+1, 0).getDate();
    const from = `${prevMonth}-01`, to = `${prevMonth}-${String(lastDay).padStart(2,'0')}`;

    let records = [];
    try { records = await DB.getRange('records','date', from, to); } catch(e) {}
    if (!records.length) {
      await DB.put('meta', { key: 'lastMonthSeen', value: thisMonth });
      return;
    }

    document.getElementById('monthly-prompt-title').textContent = `${prevDate.getFullYear()}年${prevDate.getMonth()+1}月月報`;
    document.getElementById('monthly-prompt-text').textContent =
      `新的一個月開始了！\n${prevDate.getFullYear()}年${prevDate.getMonth()+1}月共有 ${records.length} 筆紀錄，要匯出月報嗎？`;

    await DB.put('meta', { key: 'lastMonthSeen', value: thisMonth });
    Modal.open('modal-monthly-prompt');
  }

  document.getElementById('prompt-later').addEventListener('click', () => {
    Modal.close('modal-monthly-prompt');
  });

  return { check };
})();

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
async function init() {
  try {
    await DB.open();
    await State.loadCats();
    Home.refresh();
    await MonthlyPrompt.check();
  } catch(e) {
    console.error('Init error:', e);
    Toast.show('初始化失敗，請重新整理頁面', 'error', 5000);
  }
}

document.addEventListener('DOMContentLoaded', init);
