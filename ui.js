/* Mizani UI toolkit: escaping, icons, modal/forms, toasts, popovers, SVG charts. No external libraries. */
'use strict';
var C = window.MizaniCore;
var D = C.dates;

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(h, cls) { return '<span class="num' + (cls ? ' ' + cls : '') + '">' + C.fmt(h) + '</span>'; }
function sar(h, cls) { return money(h, cls) + ' <span class="u">ريال</span>'; }
function numSpan(v) { return '<span class="num">' + esc(v) + '</span>'; }
var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function monthLabel(m) { return MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
function dayName(date) { var p = date.split('-'); return DAYS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()]; }
function plural(n, one, two, few, many) { // Arabic count agreement
  if (n === 1) return one; if (n === 2) return two; if (n >= 3 && n <= 10) return n + ' ' + few; return n + ' ' + many;
}

var ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  swap: '<path d="M4 8h14"/><path d="m15 4.5 3.5 3.5L15 11.5"/><path d="M20 16H6"/><path d="M9 12.5 5.5 16 9 19.5"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="M3 10h18"/><path d="M7 14.5h4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/><path d="M8 14h3"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  safe: '<rect x="3.5" y="8" width="17" height="12" rx="2.2"/><path d="M12 12v4"/><path d="m9.5 13.5 2.5-2 2.5 2"/><path d="M7.5 8V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8.5 20v-6M13 20V9M17.5 20v-9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  undo: '<path d="M8 6 4 10l4 4"/><path d="M4 10h10a5.5 5.5 0 0 1 0 11h-3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v5"/><path d="M12 17.6h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.2"/><path d="M16 13.8h.01"/>',
  stop: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h5v5h-5z"/>'
};
function icon(name, size) {
  size = size || 18;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

// ---------- Arabic digits are converted to English digits in every text field ----------
document.addEventListener('input', function (e) {
  var el = e.target;
  if (!el || !('value' in el) || el.type === 'date' || el.type === 'month' || el.type === 'checkbox' || el.tagName === 'SELECT') return;
  if (!/[٠-٩۰-۹٫٬]/.test(el.value)) return;
  var pos = el.selectionStart;
  el.value = C.toLatinDigits(el.value);
  try { el.setSelectionRange(pos, pos); } catch (err) { /* not all input types support it */ }
}, true);

// ---------- toasts ----------
function toast(msg, o) {
  o = o || {};
  var el = document.createElement('div');
  el.className = 'toast' + (o.type ? ' ' + o.type : '');
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="m">' + msg + '</div>';
  if (o.action) {
    var b = document.createElement('button');
    b.className = 'btn sm'; b.innerHTML = o.action.icon ? icon(o.action.icon, 15) + ' ' + esc(o.action.label) : esc(o.action.label);
    b.onclick = function () { el.remove(); o.action.fn(); };
    el.appendChild(b);
  }
  var x = document.createElement('button');
  x.className = 'btn icon sm ghost'; x.innerHTML = icon('x', 15); x.setAttribute('aria-label', 'إغلاق');
  x.onclick = function () { el.remove(); };
  el.appendChild(x);
  $('#toasts').appendChild(el);
  setTimeout(function () { el.remove(); }, o.timeout || (o.action ? 9000 : 4500));
  return el;
}

// ---------- modal ----------
var modalStack = [];
function openModal(o) {
  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
    '<header><h2>' + esc(o.title) + '</h2><button class="btn icon ghost" data-close aria-label="إغلاق">' + icon('x') + '</button></header>' +
    '<div class="body">' + o.body + '</div>' + (o.footer ? '<footer>' + o.footer + '</footer>' : '') + '</div>';
  var prevFocus = document.activeElement;
  function close(result) {
    var i = modalStack.indexOf(entry); if (i >= 0) modalStack.splice(i, 1);
    ov.remove();
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
    if (o.onClose) o.onClose(result);
  }
  var entry = { close: close, el: ov };
  ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
  ov.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
  ov.addEventListener('keydown', function (e) { // keep Tab inside the dialog
    if (e.key !== 'Tab') return;
    var f = $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', ov).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $('#modal-root').appendChild(ov);
  modalStack.push(entry);
  var first = $('[autofocus]', ov) || $('.body input:not([type=hidden]), .body select, .body textarea', ov) || $('footer .btn', ov);
  if (first) setTimeout(function () { first.focus(); if (first.select && first.type !== 'date') first.select(); }, 30);
  if (o.onOpen) o.onOpen(ov, close);
  return entry;
}
function closeTopModal() { if (modalStack.length) { modalStack[modalStack.length - 1].close(); return true; } return false; }

function confirmDialog(message, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var done = false;
    openModal({
      title: o.title || 'تأكيد',
      body: '<p>' + message + '</p>' + (o.note ? '<p class="muted small mt">' + o.note + '</p>' : ''),
      footer: '<button class="btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok autofocus>' + esc(o.ok || 'تأكيد') + '</button><button class="btn" data-close>إلغاء</button>',
      onOpen: function (ov, close) { $('[data-ok]', ov).onclick = function () { done = true; close(); resolve(true); }; },
      onClose: function () { if (!done) resolve(false); }
    });
  });
}

function fieldHtml(f) {
  var id = 'f_' + f.name, v = f.value == null ? '' : f.value, h = '';
  var req = f.required ? ' required' : '';
  if (f.type === 'check') {
    return '<div class="field"><label class="check"><input type="checkbox" id="' + id + '" name="' + f.name + '"' + (v ? ' checked' : '') + '> <span>' + esc(f.label) + '</span></label>' + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
  }
  if (f.type === 'seg') {
    h = '<div class="seg" role="radiogroup" data-seg="' + f.name + '">' + f.options.map(function (o) {
      return '<button type="button" role="radio" aria-checked="' + (o[0] === v) + '" class="' + (o[0] === v ? 'on' : '') + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div><input type="hidden" name="' + f.name + '" value="' + esc(v) + '">';
  } else if (f.type === 'select') {
    h = '<select class="input" id="' + id + '" name="' + f.name + '"' + req + '>' + (f.placeholder ? '<option value="">' + esc(f.placeholder) + '</option>' : '') +
      f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  } else if (f.type === 'amount') {
    h = '<input class="input ltr" id="' + id + '" name="' + f.name + '" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(v === '' ? '' : C.fmt(v).replace(/,/g, '')) + '"' + req + '>';
  } else if (f.type === 'date' || f.type === 'month') {
    h = '<input class="input" type="' + f.type + '" id="' + id + '" name="' + f.name + '" value="' + esc(v) + '"' + req + '>';
  } else if (f.type === 'number') {
    h = '<input class="input ltr" id="' + id + '" name="' + f.name + '" inputmode="numeric" autocomplete="off" value="' + esc(v) + '"' + req + '>';
  } else {
    h = '<input class="input" id="' + id + '" name="' + f.name + '" autocomplete="off" value="' + esc(v) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : ' maxlength="200"') + req + '>';
  }
  return '<div class="field" data-field="' + f.name + '"><label for="' + id + '">' + esc(f.label) + (f.required ? '' : ' <span class="small">(اختياري)</span>') + '</label>' + h + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
}
/** Opens a form dialog. onSubmit(values, form) may throw an Error whose message is shown inline. */
function formModal(o) {
  var rows = '', pair = [];
  o.fields.forEach(function (f) {
    if (f.half) { pair.push(fieldHtml(f)); if (pair.length === 2) { rows += '<div class="fields2">' + pair.join('') + '</div>'; pair = []; } }
    else { if (pair.length) { rows += pair.join(''); pair = []; } rows += f.html != null ? f.html : fieldHtml(f); }
  });
  rows += pair.join('');
  return openModal({
    title: o.title, wide: o.wide,
    body: (o.intro ? '<p class="muted small mb">' + o.intro + '</p>' : '') + '<form novalidate><div class="err" role="alert"></div>' + rows + '<button type="submit" hidden></button></form>',
    footer: '<button class="btn primary" data-submit>' + esc(o.submit || 'حفظ') + '</button><button class="btn" data-close>إلغاء</button>' + (o.footerExtra || ''),
    onOpen: function (ov, close) {
      var form = $('form', ov), errEl = $('.err', ov), busy = false;
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('[data-seg] button');
        if (!b) return;
        var seg = b.parentNode;
        $$('button', seg).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
        var hidden = form.elements[seg.getAttribute('data-seg')];
        hidden.value = b.getAttribute('data-val');
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      });
      function submit(e) {
        if (e) e.preventDefault();
        if (busy) return;
        var values = {}, bad = null;
        o.fields.forEach(function (f) {
          if (f.html != null || bad) return;
          var el = form.elements[f.name];
          if (f.type === 'check') { values[f.name] = el.checked; return; }
          var raw = String(el.value || '').trim();
          if (!raw) { if (f.required) bad = f.label + ' مطلوب.'; values[f.name] = f.type === 'amount' ? null : ''; return; }
          if (f.type === 'amount') {
            var a = C.parseAmount(raw);
            if (a == null) bad = f.label + ': اكتب رقمًا صحيحًا مثل 150 أو 150.75';
            else if (a <= 0) bad = f.label + ' يجب أن يكون أكبر من صفر.';
            values[f.name] = a;
          } else if (f.type === 'number') {
            if (!/^\d+$/.test(raw)) bad = f.label + ': اكتب رقمًا صحيحًا.';
            values[f.name] = parseInt(raw, 10);
          } else values[f.name] = raw;
        });
        if (bad) { errEl.textContent = bad; return; }
        busy = true; errEl.textContent = '';
        Promise.resolve().then(function () { return o.onSubmit(values, form); }).then(function (keepOpen) {
          busy = false; if (keepOpen !== false) close(true);
        }).catch(function (er) { busy = false; errEl.textContent = er && er.message ? er.message : String(er); });
      }
      form.addEventListener('submit', submit);
      $('[data-submit]', ov).onclick = submit;
      if (o.onOpen) o.onOpen(form, ov, close);
    }
  });
}

// ---------- popover ----------
var popState = null;
function closePop() { if (popState) { popState.el.remove(); popState = null; } }
function openPop(anchor, html, o) {
  o = o || {};
  if (popState && popState.anchor === anchor && !o.keep) { closePop(); return null; }
  closePop();
  var el = document.createElement('div');
  el.className = 'pop'; el.innerHTML = html;
  $('#pop-root').appendChild(el);
  var r = anchor.getBoundingClientRect();
  el.style.minWidth = Math.max(o.minWidth || 240, o.matchWidth ? r.width : 0) + 'px';
  el.style.maxWidth = '460px';
  var w = el.offsetWidth, left = o.alignLeft ? r.left : r.right - w;
  left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
  el.style.left = left + 'px'; el.style.top = (r.bottom + 6) + 'px';
  popState = { el: el, anchor: anchor };
  return el;
}
document.addEventListener('mousedown', function (e) {
  if (popState && !popState.el.contains(e.target) && !popState.anchor.contains(e.target)) closePop();
});

// ---------- charts (inline SVG) ----------
var PALETTE = ['#27b3a2', '#5aa7d8', '#e6b04a', '#b58be0', '#e2695f', '#7fc97f', '#f08a4b', '#8d9ba3'];
function donut(items, o) {
  o = o || {};
  var size = o.size || 190, r = size / 2 - 16, c = size / 2, sw = 26, total = 0;
  items.forEach(function (i) { total += i.amount; });
  if (!total) return '';
  var circ = 2 * Math.PI * r, off = 0, segs = '';
  items.forEach(function (it, i) {
    var len = (it.amount / total) * circ;
    segs += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + PALETTE[i % PALETTE.length] + '" stroke-width="' + sw + '" stroke-dasharray="' + Math.max(0, len - 1.5).toFixed(2) + ' ' + (circ - Math.max(0, len - 1.5)).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + c + ' ' + c + ')"><title>' + esc(it.name) + ': ' + C.fmt(it.amount) + '</title></circle>';
    off += len;
  });
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(o.label || 'توزيع المصروفات') + '" style="flex:none">' + segs +
    '<text x="' + c + '" y="' + (c - 4) + '" text-anchor="middle" style="font-size:12px">' + esc(o.center || 'الإجمالي') + '</text>' +
    '<text x="' + c + '" y="' + (c + 16) + '" text-anchor="middle" direction="ltr" style="font-size:16px;font-weight:600;fill:' + (o.ink || 'var(--text)') + '">' + C.fmt(total) + '</text></svg>';
}
function legend(items) {
  var total = 0; items.forEach(function (i) { total += i.amount; });
  return '<div class="legend">' + items.map(function (it, i) {
    return '<div class="li"><span class="sw" style="background:' + PALETTE[i % PALETTE.length] + '"></span><span>' + esc(it.name) + '</span>' + money(it.amount, 'b') + '<span class="p num">' + (total ? Math.round(it.amount * 100 / total) : 0) + '%</span></div>';
  }).join('') + '</div>';
}
function groupItems(items, max) { // keep the chart readable: top N + "أخرى"
  if (items.length <= max) return items;
  var head = items.slice(0, max - 1), rest = 0;
  items.slice(max - 1).forEach(function (i) { rest += i.amount; });
  return head.concat([{ name: 'تصنيفات أخرى', amount: rest }]);
}
function barsCompare(months, o) {
  o = o || {};
  var W = o.width || 640, H = 230, padL = 10, padR = 58, padT = 14, padB = 30, max = 0;
  months.forEach(function (m) { max = Math.max(max, m.income, m.expense); });
  if (!max) return '';
  var step = Math.pow(10, Math.floor(Math.log10(max / 100))) * 100; // in halalas
  var top = Math.ceil(max / step) * step, ticks = 4, g = '', ih = H - padT - padB, iw = W - padL - padR;
  for (var t = 0; t <= ticks; t++) {
    var y = padT + ih - (ih * t / ticks), val = top * t / ticks;
    g += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="' + (o.grid || 'var(--line)') + '" stroke-width="1"/>' +
      '<text x="' + (W - padR + 6) + '" y="' + (y + 4) + '" direction="ltr" text-anchor="start">' + C.fmt(val).replace(/\.00$/, '') + '</text>';
  }
  var slot = iw / months.length, bw = Math.min(26, slot / 3.2);
  months.forEach(function (m, i) { // RTL: oldest month on the right
    var cx = W - padR - slot * (i + 0.5);
    var hi = ih * m.income / top, he = ih * m.expense / top;
    g += '<rect x="' + (cx + 2) + '" y="' + (padT + ih - hi) + '" width="' + bw + '" height="' + Math.max(hi, m.income ? 1.5 : 0) + '" rx="3" fill="' + (o.incomeColor || 'var(--good)') + '"><title>دخل ' + m.month + ': ' + C.fmt(m.income) + '</title></rect>' +
      '<rect x="' + (cx - bw - 2) + '" y="' + (padT + ih - he) + '" width="' + bw + '" height="' + Math.max(he, m.expense ? 1.5 : 0) + '" rx="3" fill="' + (o.expenseColor || 'var(--bad)') + '"><title>مصروف ' + m.month + ': ' + C.fmt(m.expense) + '</title></rect>' +
      '<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle" direction="ltr">' + m.month + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px" role="img" aria-label="مقارنة الدخل والمصروف شهريًا">' + g + '</svg>';
}
function progress(pctVal, status, big) {
  return '<div class="bar ' + (status || 'ok') + (big ? ' big' : '') + '" role="progressbar" aria-valuenow="' + Math.min(100, pctVal) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + Math.min(100, Math.max(0, pctVal)) + '%"></i></div>';
}
var STATUS_TEXT = { ok: 'ضمن الخطة', near: 'اقتربت من الحد', over: 'تجاوزت الحد' };
function statusPill(s) { return '<span class="pill ' + s + '">' + STATUS_TEXT[s] + '</span>'; }
function emptyState(ic, title, text, btn) {
  return '<div class="empty">' + icon(ic, 34) + '<b>' + esc(title) + '</b><div>' + esc(text) + '</div>' + (btn || '') + '</div>';
}
