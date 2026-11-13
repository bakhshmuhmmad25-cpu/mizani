/* Mizani — pages and interactions. */
'use strict';

var PAGES = [
  { id: 'home', label: 'الرئيسية', icon: 'home', month: true, title: 'الرئيسية', sub: 'نظرة هادئة على أموالك وما ينتظرك.' },
  { id: 'tx', label: 'الحركات', icon: 'swap', month: true, title: 'الحركات', sub: 'كل حركة في مكانها، وكل رقم له أثر واضح.' },
  { id: 'debts', label: 'الديون والأقساط', icon: 'card', month: false, title: 'الديون والأقساط', sub: 'تابع ما عليك وما لك، وسجّل السداد مرة واحدة.' },
  { id: 'dues', label: 'الالتزامات', icon: 'calendar', month: true, title: 'الالتزامات', sub: 'استحقاقاتك الشهرية، دون مصروف قبل السداد.' },
  { id: 'budget', label: 'الميزانية', icon: 'calc', month: true, title: 'الميزانية', sub: 'خطط للشهر والأسبوع، واعرف أين تقف.' },
  { id: 'savings', label: 'الادخار', icon: 'safe', month: false, title: 'الادخار', sub: 'خطوات صغيرة نحو هدف أكبر.' },
  { id: 'reports', label: 'التقارير', icon: 'chart', month: true, title: 'التقارير', sub: 'افهم أموالك على امتداد الوقت.' },
  { id: 'settings', label: 'الإعدادات', icon: 'gear', month: false, title: 'الإعدادات', sub: 'اضبط تجربتك واحتفظ بنسخة من بياناتك.' }
];
var S = {
  page: 'home', today: D.localToday(), month: D.monthOf(D.localToday()), settings: {}, cats: [], undo: null, alerts: [],
  tx: { q: '', type: '', categoryId: '', all: false, from: '', to: '', limit: 200 },
  debts: { q: '', status: '' }, dues: { q: '', status: '' }, sav: { q: '', kind: '' },
  weekDate: D.localToday(), report: { type: 'month', from: '', to: '' }, lastReport: null
};

// ---------- bridge ----------
function api(method, args) {
  return window.mizani.call(method, args || {}).then(function (r) { if (!r.ok) throw new Error(r.error); return r.data; });
}
function host(name, args) {
  return window.mizani.host(name, args || {}).then(function (r) { if (!r.ok) throw new Error(r.error); return r.data; });
}
if (window.mizani.onChanged) window.mizani.onChanged(function () { refresh(); });
function oops(e) { toast(esc(e && e.message ? e.message : e), { type: 'bad', timeout: 7000 }); }
function catsOf(kind) { return S.cats.filter(function (c) { return c.kind === kind; }).map(function (c) { return [c.id, c.name]; }); }
function pageDef() { return PAGES.filter(function (p) { return p.id === S.page; })[0]; }

function showAlerts(list) {
  (list || []).forEach(function (a) {
    var scope = a.scope === 'week' ? 'الأسبوعية' : 'الشهرية';
    var msg = a.level === 100
      ? '<b>بلغت ميزانية «' + esc(a.name) + '» ' + scope + ' حدّها</b><br>' + sar(a.spent) + ' من ' + money(a.budget)
      : '<b>وصلت 80% من ميزانية «' + esc(a.name) + '» ' + scope + '</b><br>' + sar(a.spent) + ' من ' + money(a.budget);
    toast(msg, { type: a.level === 100 ? 'bad' : 'warn', timeout: 9000 });
  });
}
function write(method, args) {
  return api(method, args).then(function (r) { if (r && r.alerts) showAlerts(r.alerts); return refresh().then(function () { return r; }); });
}
function removeWithUndo(method, args, question, note) {
  return confirmDialog(question, { danger: true, ok: 'حذف', title: 'تأكيد الحذف', note: note || 'يمكنك التراجع عن آخر حذف من زر «تراجع» أو Ctrl+Z.' }).then(function (yes) {
    if (!yes) return;
    return api(method, args).then(function () { return refresh(); }).then(function () {
      toast('تم الحذف' + (S.undo ? ': ' + esc(S.undo.label) : ''), { action: { label: 'تراجع', icon: 'undo', fn: doUndo } });
    }).catch(oops);
  });
}
function doUndo() {
  if (!S.undo) { toast('لا يوجد حذف للتراجع عنه.'); return; }
  api('undo').then(function (u) { toast('تمت استعادة ' + esc(u.label)); return refresh(); }).catch(oops);
}

// ---------- shell ----------
function renderNav() {
  $('#nav').innerHTML = PAGES.map(function (p, i) {
    return '<button class="nav-btn' + (p.id === S.page ? ' on' : '') + '" data-act="go" data-page="' + p.id + '"' + (p.id === S.page ? ' aria-current="page"' : '') + ' title="' + esc(p.label) + '">' + icon(p.icon, 19) + '<span>' + esc(p.label) + '</span><kbd>Ctrl+' + (i + 1) + '</kbd></button>';
  }).join('');
}
function buildTop() {
  $('#top').innerHTML =
    '<button class="btn primary" data-act="addTx" title="إضافة حركة (Ctrl+N)">' + icon('plus') + ' إضافة حركة</button>' +
    '<div class="search">' + icon('search', 17) + '<input class="input" id="q" type="search" placeholder="ابحث في الحركات والديون والالتزامات…  (Ctrl+F)" aria-label="بحث شامل" autocomplete="off"></div>' +
    '<div class="spacer"></div><div id="top-month"></div><div id="top-tools" class="row"></div>';
  var timer = null, q = $('#q');
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(runSearch, 160); });
  q.addEventListener('focus', function () { if (q.value.trim().length >= 2) runSearch(); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' && popState) { e.preventDefault(); var f = $('.item', popState.el); if (f) f.focus(); }
    if (e.key === 'Enter' && q.value.trim()) { closePop(); S.tx.q = q.value.trim(); S.tx.all = true; go('tx'); }
  });
}
function renderTop() {
  var p = pageDef(), cur = D.monthOf(S.today);
  $('#top-month').innerHTML = !p.month ? '' :
    '<div class="row"><div class="month-nav" role="group" aria-label="اختيار الشهر">' +
    '<button class="btn icon sm ghost" data-act="month" data-step="-1" title="الشهر السابق (Alt+→)" aria-label="الشهر السابق">' + icon('right', 16) + '</button>' +
    '<button class="label" data-act="pickMonth" title="اختر شهرًا">' + esc(monthLabel(S.month)) + '</button>' +
    '<button class="btn icon sm ghost" data-act="month" data-step="1" title="الشهر التالي (Alt+←)" aria-label="الشهر التالي">' + icon('left', 16) + '</button></div>' +
    (S.month !== cur ? '<button class="btn sm" data-act="monthNow">الشهر الحالي</button>' : '') + '</div>';
  $('#top-tools').innerHTML =
    '<button class="btn icon" data-act="undo" title="' + (S.undo ? 'تراجع عن حذف ' + esc(S.undo.label) + ' (Ctrl+Z)' : 'لا يوجد حذف للتراجع عنه') + '" aria-label="تراجع عن آخر حذف"' + (S.undo ? '' : ' disabled') + '>' + icon('undo') + '</button>' +
    '<button class="btn icon badge-dot" data-act="bell" title="التنبيهات" aria-label="التنبيهات (' + S.alerts.length + ')">' + icon('bell') + (S.alerts.length ? '<i>' + S.alerts.length + '</i>' : '') + '</button>';
}
function runSearch() {
  var q = $('#q'), text = q.value.trim();
  if (text.length < 2) { closePop(); return; }
  api('search', { q: text }).then(function (r) {
    if (q.value.trim() !== text) return;
    var h = '', typeName = { income: 'دخل', expense: 'مصروف', save_in: 'إيداع ادخار', save_out: 'سحب ادخار' };
    if (r.transactions.length) h += '<h4>الحركات</h4>' + r.transactions.map(function (t) {
      return '<button class="item" data-act="searchTx" data-q="' + esc(t.description || t.category) + '"><span>' + esc(t.description || t.category) + '<small>' + numSpan(t.date) + ' · ' + typeName[t.type] + ' · ' + esc(t.category) + '</small></span>' + money(t.amount, 'b') + '</button>';
    }).join('');
    if (r.debts.length) h += '<h4>الديون</h4>' + r.debts.map(function (d) {
      return '<button class="item" data-act="searchGo" data-page="debts" data-q="' + esc(d.party) + '"><span>' + esc(d.party) + '<small>المتبقي</small></span>' + money(d.remaining, 'b') + '</button>';
    }).join('');
    if (r.obligations.length) h += '<h4>الالتزامات</h4>' + r.obligations.map(function (o) {
      return '<button class="item" data-act="searchGo" data-page="dues" data-q="' + esc(o.name) + '"><span>' + esc(o.name) + '<small>يوم ' + o.dueDay + ' من كل شهر</small></span>' + money(o.amount, 'b') + '</button>';
    }).join('');
    if (r.goals.length) h += '<h4>أهداف الادخار</h4>' + r.goals.map(function (g) {
      return '<button class="item" data-act="searchGo" data-page="savings" data-q=""><span>' + esc(g.name) + '</span>' + money(g.balance, 'b') + '</button>';
    }).join('');
    if (!h) h = '<div class="empty" style="padding:16px">لا نتائج لـ «' + esc(text) + '»</div>';
    openPop(q.parentNode, h, { keep: true, matchWidth: true, alignLeft: false });
  }).catch(oops);
}

function go(page) { S.page = page; closePop(); renderNav(); return refresh(true); }
function refresh(resetScroll) {
  var pg = $('#page'), y = pg.scrollTop;
  S.today = D.localToday();
  return Promise.all([api('getSettings'), api('listCategories'), api('undoInfo'), api('alerts')]).then(function (r) {
    S.settings = r[0]; S.cats = r[1]; S.undo = r[2]; S.alerts = r[3];
    document.documentElement.setAttribute('data-theme', S.settings.theme === 'light' ? 'light' : 'dark');
    renderTop();
    return VIEW[S.page]();
  }).then(function (html) {
    var p = pageDef();
    pg.innerHTML = '<div class="page-head"><h1>' + esc(p.title) + '</h1><p>' + esc(p.sub) + '</p></div>' + html;
    pg.scrollTop = resetScroll ? 0 : y;
  }).catch(function (e) { pg.innerHTML = '<div class="banner bad">' + icon('warn') + '<div class="t"><b>تعذر عرض الصفحة</b><span>' + esc(e.message) + '</span></div></div>'; });
}
function stat(ic, k, v, u, cls) {
  return '<div class="card stat ' + (cls || '') + '"><div class="k">' + icon(ic, 17) + '<span>' + esc(k) + '</span></div><div class="v' + (typeof v === 'number' && v < 0 ? ' neg' : '') + '">' + (typeof v === 'number' ? money(v) : v) + '</div><div class="u">' + u + '</div></div>';
}

// ================= VIEWS =================
var VIEW = {};

VIEW.home = function () {
  return api('dashboard', { month: S.month }).then(function (d) {
    var h = '';
    if (d.empty) {
      h += '<div class="card block">' + emptyState('wallet', 'ابدأ بأول حركة', 'سجّل دخلك ومصروفاتك لتظهر لك الصورة كاملة: الرصيد، الميزانية، والتوقعات.', '<div><button class="btn primary" data-act="addTx">' + icon('plus') + ' إضافة حركة</button></div>') + '</div>';
    }
    d.alerts.forEach(function (a) {
      h += '<div class="banner' + (a.level === 100 ? ' bad' : '') + '">' + icon('warn') + '<div class="t"><b>' + (a.level === 100 ? 'بلغت' : 'اقتربت من') + ' حد ميزانية «' + esc(a.name) + '» ' + (a.scope === 'week' ? 'الأسبوعية' : 'الشهرية') + ' (' + numSpan(a.pct + '%') + ')</b><span>صرفت ' + sar(a.spent) + ' من ' + money(a.budget) + '</span></div><button class="btn sm" data-act="go" data-page="budget">عرض الميزانية</button></div>';
    });
    h += '<div class="grid n6">' +
      stat('home', 'الرصيد النقدي الآن', d.cash, 'ريال سعودي · حتى اليوم') +
      stat('chart', 'دخل الشهر', d.income, 'ريال سعودي · ' + numSpan(d.month)) +
      stat('swap', 'مصروف الشهر', d.expense, 'ريال سعودي · ' + numSpan(d.month)) +
      stat('safe', 'رصيد الادخار', d.savings, d.savingsRate ? 'ادخرت ' + numSpan(d.savingsRate + '%') + ' من دخل الشهر' : 'ريال سعودي · تحويلات فعلية') +
      stat('card', 'الديون المتبقية', d.debtsLeft, 'ريال سعودي · بعد السداد') +
      stat('calendar', 'الاستحقاقات المحجوزة', d.reserved, 'ريال سعودي · حتى نهاية الشهر الحالي') + '</div>';

    // available + this week
    var w = d.week, g = w.items[0];
    h += '<div class="grid wide"><div class="card stat hero"><div class="k">' + icon('wallet', 17) + '<span>المتاح بعد حجز الاستحقاقات</span></div><div class="v' + (d.available < 0 ? ' neg' : '') + '">' + sar(d.available) + '</div><div class="u">النقدية الحالية − الالتزامات غير المسددة والأقساط المستحقة حتى نهاية الشهر الحالي.</div></div>';
    if (g.budget > 0) {
      h += '<div class="card stat"><div class="between"><div class="k">' + icon('bolt', 17) + '<span>المتبقي هذا الأسبوع</span></div>' + statusPill(g.status) + '</div>' +
        '<div class="v' + (g.remaining < 0 ? ' neg' : '') + '">' + sar(g.remaining) + '</div>' + progress(g.pct, g.status, true) +
        '<div class="u mt">' + (g.remaining > 0 && w.daysLeft > 0 ? 'المسموح يوميًا: <b>' + sar(w.dailyAllowance) + '</b> لباقي الأسبوع (' + plural(w.daysLeft, 'يوم واحد', 'يومان', 'أيام', 'يومًا') + ')' : (g.remaining < 0 ? 'تجاوزت ميزانية هذا الأسبوع.' : 'انتهى رصيد هذا الأسبوع.')) +
        ' · صرفت ' + money(g.spent) + ' من ' + money(g.total) + (g.carry ? ' · منها ' + (g.carry < 0 ? 'عجز مرحّل ' : 'مرحّل ') + money(g.carry) : '') + (g.isDefault ? ' · افتراضي = الشهرية ÷ 4' : '') + '</div>' +
        '<div class="mt"><button class="btn sm" data-act="weekly">تفاصيل الأسبوع</button></div></div>';
    } else {
      h += '<div class="card stat"><div class="k">' + icon('bolt', 17) + '<span>ميزانية هذا الأسبوع</span></div><div class="u mt">صرفت هذا الأسبوع ' + sar(g.spent) + '. حدّد مبلغًا أسبوعيًا لتعرف المسموح لك يوميًا.</div><div class="mt"><button class="btn primary sm" data-act="weekly">حدّد ميزانية أسبوعية</button></div></div>';
    }
    h += '</div>';

    if (d.isCurrentMonth) h += forecastCard(d.forecast);
    if (d.budget.unbudgetedCount > 0) {
      h += '<div class="banner">' + icon('warn') + '<div class="t"><b>لديك ' + plural(d.budget.unbudgetedCount, 'تصنيف مصروف واحد', 'تصنيفا مصروف', 'تصنيفات مصروف', 'تصنيف مصروف') + ' بلا ميزانية</b><span>' + sar(d.budget.outsidePlan) + ' من مصروف الشهر خارج الخطة.</span></div><button class="btn sm primary" data-act="go" data-page="budget">حدّد ميزانيات للبقية</button></div>';
    }
    // quick add
    h += '<div class="card block"><div class="between"><div><h2>إضافة سريعة</h2><div class="sub">قوالب لحركاتك المتكررة — ضغطة واحدة تسجّلها بتاريخ اليوم.</div></div><button class="btn sm" data-act="templates">إدارة القوالب</button></div><div class="chips mt">' +
      (d.templates.length ? d.templates.map(function (t) { return '<button class="chip" data-act="useTemplate" data-id="' + t.id + '" title="' + esc(t.category) + '">' + icon('bolt', 14) + esc(t.name) + ' <small class="num">' + C.fmt(t.amount) + '</small></button>'; }).join('') : '<span class="muted small">لا توجد قوالب بعد. أنشئ قالبًا مثل «بنزين» أو «مواصلات».</span>') + '</div></div>';

    // charts
    var max = Math.max(d.income, d.expense, 1);
    h += '<div class="grid wide"><div class="card"><h2>الدخل مقابل المصروف</h2><div class="sub mb">' + esc(monthLabel(d.month)) + '</div>' +
      '<div class="between small"><span>الدخل</span>' + money(d.income, 'b') + '</div><div class="bar big ok mb"><i style="width:' + (d.income * 100 / max) + '%"></i></div>' +
      '<div class="between small"><span>المصروف</span>' + money(d.expense, 'b') + '</div><div class="bar big over mb"><i style="width:' + (d.expense * 100 / max) + '%"></i></div>' +
      '<div class="between small"><span>الصافي</span><b class="' + (d.income - d.expense < 0 ? 'neg' : 'pos') + '">' + money(d.income - d.expense) + '</b></div></div>' +
      '<div class="card"><h2>أين تذهب المصروفات؟</h2><div class="sub mb">' + esc(monthLabel(d.month)) + '</div>' +
      (d.byCategory.length ? '<div class="chart-row">' + donut(groupItems(d.byCategory, 7)) + legend(groupItems(d.byCategory, 7)) + '</div>' : emptyState('chart', 'لا مصروفات في هذا الشهر', 'ستظهر هنا حصة كل تصنيف.')) + '</div></div>';
    return h;
  });
};
function forecastCard(f) {
  var body, cls = 'info', ic = 'info';
  if (!f.hasData) body = '<b>توقع نهاية الشهر</b><span>سجّل مصروفاتك اليومية ليظهر هنا: هل يكفي المتاح حتى نهاية الشهر؟</span>';
  else if (f.available <= 0) { cls = 'bad'; ic = 'warn'; body = '<b>المتاح لا يغطي ما هو محجوز</b><span>معدل صرفك الحالي ' + sar(f.avgDaily) + ' يوميًا، ولا يوجد متاح بعد حجز الاستحقاقات.</span>'; }
  else if (f.enough) body = '<b>بمعدل صرفك الحالي، المتاح يكفي حتى نهاية الشهر</b><span>تصرف ' + sar(f.avgDaily) + ' يوميًا. المتوقع أن يتبقى ' + sar(f.projectedEnd) + ' في ' + numSpan(f.monthEnd) + '.</span>';
  else {
    cls = ''; ic = 'warn';
    var safe = f.daysLeft > 0 ? Math.floor(f.available / f.daysLeft) : 0;
    body = '<b>بمعدل صرفك الحالي ينفد المتاح يوم ' + esc(dayName(f.depletionDate)) + ' ' + numSpan(f.depletionDate) + '</b><span>تصرف ' + sar(f.avgDaily) + ' يوميًا، والمتوقع عجز ' + sar(-f.projectedEnd) + ' بنهاية الشهر. لتصل إلى ' + numSpan(f.monthEnd) + ': لا تتجاوز ' + sar(safe) + ' يوميًا.</span>';
  }
  return '<div class="banner ' + cls + '">' + icon(ic) + '<div class="t">' + body + '</div></div>';
}

// ---------- transactions ----------
var TYPE_NAME = { income: 'دخل', expense: 'مصروف', save_in: 'إيداع ادخار', save_out: 'سحب ادخار' };
VIEW.tx = function () {
  var f = S.tx;
  var from = f.all ? (f.from || '') : (f.from || D.monthStart(S.month)), to = f.all ? (f.to || '') : (f.to || D.monthEnd(S.month));
  return api('listTransactions', { from: from || undefined, to: to || undefined, type: f.type || undefined, categoryId: f.categoryId || undefined, q: f.q || undefined }).then(function (rows) {
    var inc = 0, exp = 0;
    rows.forEach(function (t) { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; });
    var catOpts = S.cats.map(function (c) { return '<option value="' + c.id + '"' + (String(f.categoryId) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + (c.kind === 'income' ? ' (دخل)' : '') + '</option>'; }).join('');
    var h = '<div class="toolbar" data-filter="tx">' +
      '<input class="input grow" data-f="q" type="search" placeholder="بحث في الوصف والملاحظات…" value="' + esc(f.q) + '" aria-label="بحث في الحركات">' +
      '<select class="input" data-f="type" aria-label="النوع"><option value="">كل الأنواع</option>' + [['expense', 'مصروف'], ['income', 'دخل'], ['savings', 'ادخار']].map(function (o) { return '<option value="' + o[0] + '"' + (f.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select class="input" data-f="categoryId" aria-label="التصنيف"><option value="">كل التصنيفات</option>' + catOpts + '</select>' +
      '<input class="input" data-f="from" type="date" value="' + esc(from) + '" aria-label="من تاريخ" title="من تاريخ">' +
      '<input class="input" data-f="to" type="date" value="' + esc(to) + '" aria-label="إلى تاريخ" title="إلى تاريخ">' +
      '<button class="btn' + (f.all ? ' primary' : '') + '" data-act="txAll" aria-pressed="' + f.all + '">كل الفترات</button>' +
      (f.q || f.type || f.categoryId || f.all || f.from || f.to ? '<button class="btn ghost" data-act="txClear">مسح الفلاتر</button>' : '') + '</div>' +
      '<div class="toolbar"><button class="btn primary" data-act="addTx">' + icon('plus') + ' إضافة حركة</button><button class="btn" data-act="templates">' + icon('bolt') + ' القوالب</button><button class="btn" data-act="categories">إدارة التصنيفات</button></div>';
    if (!rows.length) {
      return h + '<div class="card">' + emptyState('swap', 'لا توجد حركات هنا', f.q || f.type || f.categoryId ? 'لا شيء يطابق الفلاتر الحالية. جرّب مسحها أو تغيير الفترة.' : 'لم تُسجَّل حركات في ' + monthLabel(S.month) + '.', '<div><button class="btn primary" data-act="addTx">' + icon('plus') + ' إضافة حركة</button></div>') + '</div>';
    }
    var shown = rows.slice(0, f.limit);
    h += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>النوع</th><th class="amt">المبلغ</th><th>التصنيف</th><th>الوصف</th><th>الملاحظات</th><th></th></tr></thead><tbody>' +
      shown.map(function (t) {
        var editable = t.src === 'tx' && !t.linked;
        var acts = editable
          ? '<button class="btn icon sm ghost" data-act="editTx" data-id="' + t.id + '" title="تعديل (Enter)" aria-label="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delTx" data-id="' + t.id + '" title="حذف (Delete)" aria-label="حذف">' + icon('trash', 16) + '</button>'
          : '<span class="pill muted" title="' + (t.src === 'sav' ? 'تُعدَّل من صفحة الادخار' : 'مرتبطة بدين أو التزام وتُعدَّل من صفحته') + '">' + (t.src === 'sav' ? 'ادخار' : 'مرتبطة') + '</span>';
        return '<tr tabindex="0"' + (editable ? ' data-row-edit="editTx" data-row-del="delTx" data-id="' + t.id + '"' : '') + '><td>' + numSpan(t.date) + '</td><td class="type-' + t.type + '">' + TYPE_NAME[t.type] + '</td><td class="amt">' + money(t.amount) + '</td><td>' + esc(t.category) + '</td><td class="clip" title="' + esc(t.description) + '">' + esc(t.description) + '</td><td class="clip muted" title="' + esc(t.notes) + '">' + esc(t.notes) + '</td><td class="actions">' + acts + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="7">' + plural(rows.length, 'حركة واحدة', 'حركتان', 'حركات', 'حركة') + ' · الدخل ' + money(inc) + ' · المصروف ' + money(exp) + ' · الصافي ' + money(inc - exp) + '</td></tr></tfoot></table></div>' +
      (rows.length > shown.length ? '<div class="mt" style="text-align:center"><button class="btn" data-act="txMore">عرض المزيد (' + (rows.length - shown.length) + ')</button></div>' : '') + '</div>';
    return h;
  });
};
function txDialog(tx, preset) {
  tx = tx || {}; preset = preset || {};
  var isNew = !tx.id, type = tx.type || preset.type || 'expense';
  return api('listTemplates').then(function (templates) {
    var chips = isNew && templates.length ? '<div class="field"><label>من قالب</label><div class="chips">' + templates.map(function (t) { return '<button type="button" class="chip" data-tpl="' + t.id + '">' + esc(t.name) + ' <small class="num">' + C.fmt(t.amount) + '</small></button>'; }).join('') + '</div></div>' : '';
    formModal({
      title: isNew ? 'إضافة حركة' : 'تعديل حركة',
      fields: [
        { html: chips },
        { name: 'type', label: 'النوع', type: 'seg', value: type, options: [['expense', 'مصروف'], ['income', 'دخل']], required: true },
        { name: 'amount', label: 'المبلغ (ريال)', type: 'amount', value: tx.amount == null ? (preset.amount == null ? '' : preset.amount) : tx.amount, required: true, half: true },
        { name: 'date', label: 'التاريخ', type: 'date', value: tx.date || S.today, required: true, half: true },
        { name: 'categoryId', label: 'التصنيف', type: 'select', value: tx.categoryId || preset.categoryId || '', options: catsOf(type), placeholder: 'اختر التصنيف', required: true },
        { name: 'description', label: 'الوصف', type: 'text', value: tx.description || preset.description || '', placeholder: 'مثال: بنزين، مغسلة…' },
        { name: 'notes', label: 'الملاحظات', type: 'text', value: tx.notes || '' }
      ].concat(isNew ? [{ name: 'asTemplate', label: 'احفظها أيضًا كقالب للإضافة السريعة', type: 'check', value: false }] : []),
      onOpen: function (form) {
        form.elements.type.addEventListener('change', function () {
          var sel = form.elements.categoryId, k = form.elements.type.value;
          sel.innerHTML = '<option value="">اختر التصنيف</option>' + catsOf(k).map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
        });
        form.addEventListener('click', function (e) {
          var b = e.target.closest('[data-tpl]'); if (!b) return;
          var t = templates.filter(function (x) { return String(x.id) === b.getAttribute('data-tpl'); })[0];
          var segBtn = $('[data-seg="type"] [data-val="' + t.type + '"]', form); if (segBtn) segBtn.click();
          form.elements.amount.value = C.fmt(t.amount).replace(/,/g, '');
          form.elements.categoryId.value = t.categoryId;
          form.elements.description.value = t.description || t.name;
        });
      },
      onSubmit: function (v) {
        var args = { id: tx.id, type: v.type, amount: v.amount, date: v.date, categoryId: Number(v.categoryId), description: v.description, notes: v.notes };
        var far = D.diffDays(S.today, v.date) > 30;
        var proceed = far ? confirmDialog('تاريخ الحركة ' + numSpan(v.date) + ' بعيد في المستقبل (أكثر من 30 يومًا). هل التاريخ صحيح؟', { ok: 'نعم، احفظ', title: 'تاريخ مستقبلي' }) : Promise.resolve(true);
        return proceed.then(function (yes) {
          if (!yes) return false;
          return api('saveTransaction', args).then(function (r) {
            var next = v.asTemplate ? api('saveTemplate', { name: v.description || 'قالب', type: v.type, amount: v.amount, categoryId: Number(v.categoryId), description: v.description }).catch(function () { /* optional */ }) : Promise.resolve();
            return next.then(function () { showAlerts(r.alerts); toast(isNew ? 'أُضيفت الحركة: ' + sar(v.amount) : 'حُفظ التعديل'); return refresh(); });
          });
        });
      }
    });
  });
}
function templatesDialog() {
  api('listTemplates').then(function (list) {
    var body = (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>القالب</th><th>النوع</th><th class="amt">المبلغ</th><th>التصنيف</th><th></th></tr></thead><tbody>' + list.map(function (t) {
      return '<tr><td>' + esc(t.name) + '</td><td>' + TYPE_NAME[t.type] + '</td><td class="amt">' + money(t.amount) + '</td><td>' + esc(t.category) + '</td><td class="actions"><button class="btn icon sm ghost" data-act="editTemplate" data-id="' + t.id + '" aria-label="تعديل" title="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delTemplate" data-id="' + t.id + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
    }).join('') + '</tbody></table></div>' : emptyState('bolt', 'لا توجد قوالب', 'القالب حركة جاهزة تضيفها بضغطة: بنزين، مواصلات، قهوة…'));
    openModal({ title: 'قوالب الحركات', wide: true, body: body, footer: '<button class="btn primary" data-act="editTemplate" data-id="">' + icon('plus') + ' قالب جديد</button><button class="btn" data-close>إغلاق</button>' });
  }).catch(oops);
}
function templateForm(t) {
  t = t || {};
  var type = t.type || 'expense';
  formModal({
    title: t.id ? 'تعديل قالب' : 'قالب جديد',
    fields: [
      { name: 'name', label: 'اسم القالب', type: 'text', value: t.name || '', required: true, placeholder: 'مثال: بنزين' },
      { name: 'type', label: 'النوع', type: 'seg', value: type, options: [['expense', 'مصروف'], ['income', 'دخل']], required: true },
      { name: 'amount', label: 'المبلغ (ريال)', type: 'amount', value: t.amount == null ? '' : t.amount, required: true, half: true },
      { name: 'categoryId', label: 'التصنيف', type: 'select', value: t.categoryId || '', options: catsOf(type), placeholder: 'اختر التصنيف', required: true, half: true },
      { name: 'description', label: 'وصف الحركة', type: 'text', value: t.description || '' }
    ],
    onOpen: function (form) {
      form.elements.type.addEventListener('change', function () {
        form.elements.categoryId.innerHTML = '<option value="">اختر التصنيف</option>' + catsOf(form.elements.type.value).map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
      });
    },
    onSubmit: function (v) {
      return api('saveTemplate', { id: t.id, name: v.name, type: v.type, amount: v.amount, categoryId: Number(v.categoryId), description: v.description }).then(function () { closeTopModal(); closeTopModal(); return refresh(); }).then(function () { templatesDialog(); return false; });
    }
  });
}
function categoriesDialog() {
  api('listCategories').then(function (list) {
    function rows(kind) {
      return list.filter(function (c) { return c.kind === kind; }).map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="muted small">' + (c.uses ? plural(Number(c.uses), 'حركة واحدة', 'حركتان', 'حركات', 'حركة') : 'غير مستخدم') + '</td><td class="actions"><button class="btn icon sm ghost" data-act="editCategory" data-id="' + c.id + '" data-name="' + esc(c.name) + '" data-kind="' + c.kind + '" aria-label="إعادة تسمية" title="إعادة تسمية">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delCategory" data-id="' + c.id + '" data-name="' + esc(c.name) + '" data-uses="' + c.uses + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
      }).join('');
    }
    openModal({
      title: 'إدارة التصنيفات', wide: true,
      body: '<div class="grid wide" style="margin:0"><div><div class="between mb"><b>تصنيفات المصروف</b><button class="btn sm" data-act="editCategory" data-id="" data-kind="expense">' + icon('plus', 15) + ' إضافة</button></div><table class="tbl"><tbody>' + rows('expense') + '</tbody></table></div>' +
        '<div><div class="between mb"><b>تصنيفات الدخل</b><button class="btn sm" data-act="editCategory" data-id="" data-kind="income">' + icon('plus', 15) + ' إضافة</button></div><table class="tbl"><tbody>' + rows('income') + '</tbody></table></div></div>',
      footer: '<button class="btn" data-close>إغلاق</button>'
    });
  }).catch(oops);
}

// ---------- debts ----------
VIEW.debts = function () {
  return api('listDebts', { q: S.debts.q || undefined, status: S.debts.status || undefined }).then(function (d) {
    var h = '<div class="grid n3">' + stat('card', 'أصل الديون عليّ', d.totals.principal, 'ريال سعودي · كل الديون المسجلة') + stat('check', 'المسدد', d.totals.paid, 'ريال سعودي · عمليات فعلية') + stat('calendar', 'المتبقي', d.totals.remaining, 'ريال سعودي · حتى اليوم') + '</div>' +
      '<div class="toolbar" data-filter="debts"><input class="input grow" data-f="q" type="search" placeholder="بحث بالاسم…" value="' + esc(S.debts.q) + '" aria-label="بحث في الديون"><select class="input" data-f="status" aria-label="حالة السداد">' + [['', 'كل الديون'], ['open', 'غير مسددة'], ['closed', 'مسددة بالكامل']].map(function (o) { return '<option value="' + o[0] + '"' + (S.debts.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button class="btn primary" data-act="editDebt" data-id="">' + icon('plus') + ' إضافة دين</button></div>';
    if (!d.rows.length) return h + '<div class="card">' + emptyState('folder', S.debts.q || S.debts.status ? 'لا ديون تطابق البحث' : 'لا توجد ديون', S.debts.q || S.debts.status ? 'جرّب تغيير البحث أو الحالة.' : 'أضف دينًا سابقًا، أو سجّل دينًا جديدًا استلمت قيمته نقدًا.', S.debts.q || S.debts.status ? '' : '<div><button class="btn primary" data-act="editDebt" data-id="">' + icon('plus') + ' إضافة دين</button></div>') + '</div>';
    h += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>الجهة أو الشخص</th><th>نوع الدين</th><th class="amt">أصل الدين</th><th class="amt">المسدد</th><th class="amt">المتبقي</th><th class="amt">القسط</th><th>أول استحقاق</th><th style="min-width:110px">التقدم</th><th></th></tr></thead><tbody>' +
      d.rows.map(function (r) {
        var p = r.principal ? Math.round(r.paid * 100 / r.principal) : 0;
        return '<tr tabindex="0" data-row-edit="editDebt" data-row-del="delDebt" data-id="' + r.id + '" data-name="' + esc(r.party) + '"><td>' + esc(r.party) + (r.notes ? '<div class="muted small clip" title="' + esc(r.notes) + '">' + esc(r.notes) + '</div>' : '') + '</td><td>' + (r.kind === 'on_me' ? 'عليّ' : 'لي عند غيري') + '</td><td class="amt">' + money(r.principal) + '</td><td class="amt">' + money(r.paid) + '</td><td class="amt">' + money(r.remaining) + '</td><td class="amt">' + (r.installment ? money(r.installment) : '—') + '</td><td>' + (r.firstDue ? numSpan(r.firstDue) : '—') + '</td><td>' + progress(p, 'plain') + '<div class="small muted num">' + p + '%</div></td>' +
          '<td class="actions">' + (r.remaining > 0 ? '<button class="btn sm primary" data-act="payDebt" data-id="' + r.id + '">' + (r.kind === 'on_me' ? 'تسجيل سداد' : 'تسجيل تحصيل') + '</button> ' : '<span class="pill">مسدد</span> ') +
          '<button class="btn icon sm ghost" data-act="debtLog" data-id="' + r.id + '" data-name="' + esc(r.party) + '" title="سجل السداد" aria-label="سجل السداد">' + icon('history', 16) + '</button><button class="btn icon sm ghost" data-act="editDebt" data-id="' + r.id + '" title="تعديل" aria-label="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delDebt" data-id="' + r.id + '" data-name="' + esc(r.party) + '" title="حذف" aria-label="حذف">' + icon('trash', 16) + '</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return h;
  });
};
function debtForm(d) {
  d = d || {};
  formModal({
    title: d.id ? 'تعديل دين' : 'إضافة دين',
    fields: [
      { name: 'party', label: 'الجهة أو الشخص', type: 'text', value: d.party || '', required: true },
      { name: 'kind', label: 'نوع الدين', type: 'seg', value: d.kind || 'on_me', options: [['on_me', 'دين عليّ'], ['for_me', 'دين لي عند غيري']], required: true },
      { name: 'principal', label: 'أصل الدين (ريال)', type: 'amount', value: d.principal == null ? '' : d.principal, required: true, half: true },
      { name: 'installment', label: 'القسط الشهري (ريال)', type: 'amount', value: d.installment || '', half: true },
      { name: 'firstDue', label: 'تاريخ أول استحقاق', type: 'date', value: d.firstDue || '', hint: 'مع القسط، يُحجز المستحق من المتاح حتى نهاية كل شهر.' },
      { name: 'notes', label: 'ملاحظات', type: 'text', value: d.notes || '' }
    ].concat(d.id ? [] : [{ name: 'cashMoved', label: 'المبلغ دخل نقديتي (أو خرج منها) اليوم — سجّله كحركة', type: 'check', value: false, hint: 'اتركه فارغًا للديون السابقة التي لا تغيّر رصيدك الحالي.' }]),
    onSubmit: function (v) {
      return write('saveDebt', { id: d.id, party: v.party, kind: v.kind, principal: v.principal, installment: v.installment || 0, firstDue: v.firstDue || null, notes: v.notes, cashMoved: !!v.cashMoved, date: S.today });
    }
  });
}
function debtLog(id, name) {
  api('listDebtPayments', { debtId: Number(id) }).then(function (list) {
    openModal({
      title: 'سجل السداد — ' + name, body: list.length ? '<table class="tbl"><thead><tr><th>التاريخ</th><th class="amt">المبلغ</th><th>ملاحظات</th><th></th></tr></thead><tbody>' + list.map(function (p) {
        return '<tr><td>' + numSpan(p.date) + '</td><td class="amt">' + money(p.amount) + '</td><td class="clip">' + esc(p.notes) + '</td><td class="actions"><button class="btn icon sm ghost" data-act="delDebtPayment" data-id="' + p.id + '" aria-label="حذف السداد" title="حذف السداد">' + icon('trash', 16) + '</button></td></tr>';
      }).join('') + '</tbody></table>' : emptyState('history', 'لا توجد عمليات سداد', 'سجّل أول سداد من زر «تسجيل سداد».'),
      footer: '<button class="btn" data-close>إغلاق</button>'
    });
  }).catch(oops);
}

// ---------- obligations ----------
var DUE_TEXT = { paid: 'مسدد', due: 'مستحق', overdue: 'متأخر' };
VIEW.dues = function () {
  return Promise.all([api('listDues', { month: S.month, status: S.dues.status || undefined, q: S.dues.q || undefined }), api('listObligations')]).then(function (r) {
    var d = r[0], obs = r[1];
    var h = '<div class="grid n2">' + stat('calendar', 'غير المسدد حتى الشهر المختار', d.unpaid, 'ريال سعودي · ' + numSpan(S.month)) + stat('info', 'المتأخر قبل اليوم', d.overdue, 'ريال سعودي · دون خصم تلقائي', d.overdue > 0 ? 'late' : '') + '</div>';
    h += '<div class="card block"><h2>مواعيد السداد</h2><div class="sub mb">يشمل الشهر المختار وما قبله. لا تُنشأ مصروفات تلقائيًا عند الاستحقاق — يُسجَّل المصروف عند السداد فقط.</div>' +
      '<div class="toolbar" data-filter="dues"><input class="input grow" data-f="q" type="search" placeholder="بحث باسم الالتزام…" value="' + esc(S.dues.q) + '" aria-label="بحث في الاستحقاقات"><select class="input" data-f="status" aria-label="الحالة">' + [['', 'كل الحالات'], ['due', 'مستحق'], ['overdue', 'متأخر'], ['paid', 'مسدد']].map(function (o) { return '<option value="' + o[0] + '"' + (S.dues.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    if (!d.rows.length) h += emptyState('calendar', obs.length ? 'لا استحقاقات هنا' : 'لا توجد التزامات بعد', obs.length ? 'لا شيء مستحق في ' + monthLabel(S.month) + ' بهذه الفلاتر.' : 'أضف التزاماتك الشهرية الثابتة (إيجار، اشتراك، قسط) لتُحجز من المتاح.');
    else h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الالتزام</th><th>الشهر</th><th>الاستحقاق</th><th class="amt">المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>' + d.rows.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td>' + numSpan(x.month) + '</td><td>' + numSpan(x.dueDate) + '</td><td class="amt">' + money(x.amount) + '</td><td><span class="pill ' + (x.status === 'paid' ? '' : x.status) + '">' + DUE_TEXT[x.status] + (x.paid ? ' · ' + x.paidDate : '') + '</span></td><td class="actions">' +
        (x.paid ? '<button class="btn sm" data-act="unpayDue" data-id="' + x.obligationId + '" data-month="' + x.month + '" data-name="' + esc(x.name) + '">إلغاء السداد</button>' : '<button class="btn sm primary" data-act="payDue" data-id="' + x.obligationId + '" data-month="' + x.month + '" data-amount="' + x.amount + '" data-name="' + esc(x.name) + '">' + icon('check', 15) + ' تسجيل سداد</button>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    h += '</div><div class="card"><div class="between mb"><div><h2>إدارة الالتزامات الشهرية</h2><div class="sub">تعديل المبلغ يطبَّق على الاستحقاقات غير المسددة. الإيقاف لا يلغي المتأخرات.</div></div><button class="btn primary" data-act="editObligation" data-id="">' + icon('plus') + ' إضافة التزام</button></div>';
    if (!obs.length) h += emptyState('calendar', 'لا توجد التزامات', 'مثال: إيجار 1,500 ريال يوم 1 من كل شهر.');
    else h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الالتزام</th><th class="amt">المبلغ</th><th>يوم الاستحقاق</th><th>التصنيف</th><th>من شهر</th><th>الحالة</th><th></th></tr></thead><tbody>' + obs.map(function (o) {
      return '<tr tabindex="0" data-row-edit="editObligation" data-row-del="delObligation" data-id="' + o.id + '" data-name="' + esc(o.name) + '"><td>' + esc(o.name) + '</td><td class="amt">' + money(o.amount) + '</td><td>' + numSpan(o.dueDay) + '</td><td>' + esc(o.category || '—') + '</td><td>' + numSpan(o.startMonth) + '</td><td>' + (o.active ? '<span class="pill">سارٍ</span>' : '<span class="pill muted">موقوف من ' + o.endMonth + '</span>') + '</td><td class="actions">' +
        (o.active ? '<button class="btn sm" data-act="stopObligation" data-id="' + o.id + '" data-name="' + esc(o.name) + '">إيقاف</button>' : '<button class="btn sm" data-act="resumeObligation" data-id="' + o.id + '">إعادة تفعيل</button>') +
        ' <button class="btn icon sm ghost" data-act="editObligation" data-id="' + o.id + '" aria-label="تعديل" title="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delObligation" data-id="' + o.id + '" data-name="' + esc(o.name) + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    return h + '</div>';
  });
};
function obligationForm(o, patch) {
  o = Object.assign({}, o || {}, patch || {});
  formModal({
    title: o.id ? 'تعديل التزام' : 'إضافة التزام',
    fields: [
      { name: 'name', label: 'اسم الالتزام', type: 'text', value: o.name || '', required: true, placeholder: 'مثال: إيجار' },
      { name: 'amount', label: 'المبلغ الشهري (ريال)', type: 'amount', value: o.amount == null ? '' : o.amount, required: true, half: true },
      { name: 'dueDay', label: 'يوم الاستحقاق (1–31)', type: 'number', value: o.dueDay || 1, required: true, half: true },
      { name: 'categoryId', label: 'تصنيف المصروف عند السداد', type: 'select', value: o.categoryId || '', options: catsOf('expense'), placeholder: 'فواتير (افتراضي)' },
      { name: 'startMonth', label: 'يبدأ من شهر', type: 'month', value: o.startMonth || D.monthOf(S.today), required: true, half: true },
      { name: 'endMonth', label: 'آخر شهر', type: 'month', value: o.endMonth || '', half: true }
    ],
    onSubmit: function (v) {
      return write('saveObligation', { id: o.id, name: v.name, amount: v.amount, dueDay: v.dueDay, categoryId: v.categoryId ? Number(v.categoryId) : null, startMonth: v.startMonth, endMonth: v.endMonth || null });
    }
  });
}

// ---------- budget ----------
VIEW.budget = function () {
  var mode = S.settings.budget_mode === 'week' ? 'week' : 'month';
  var head = '<div class="toolbar"><div class="seg" role="tablist" aria-label="نوع الميزانية"><button role="tab" aria-selected="' + (mode === 'month') + '" class="' + (mode === 'month' ? 'on' : '') + '" data-act="budgetMode" data-mode="month">شهري</button><button role="tab" aria-selected="' + (mode === 'week') + '" class="' + (mode === 'week' ? 'on' : '') + '" data-act="budgetMode" data-mode="week">أسبوعي</button></div></div>';
  return (mode === 'month' ? budgetMonth() : budgetWeek()).then(function (h) { return head + h; });
};
function budgetMonth() {
  return api('getBudget', { month: S.month }).then(function (b) {
    var h = '';
    if (b.unbudgeted.length) {
      h += '<div class="banner">' + icon('warn') + '<div class="t"><b>لديك ' + plural(b.unbudgeted.length, 'تصنيف مصروف واحد', 'تصنيفا مصروف', 'تصنيفات مصروف', 'تصنيف مصروف') + ' بلا ميزانية</b><span>' + b.unbudgeted.map(function (u) { return esc(u.name); }).join('، ') + ' — ' + sar(b.outsidePlan) + ' من مصروف الشهر خارج الخطة.</span></div>' +
        '<button class="btn primary" data-act="fillBudgets" data-suggest="0">حدّد ميزانيات للبقية</button><button class="btn" data-act="fillBudgets" data-suggest="1" title="من متوسط آخر 3 أشهر لكل تصنيف">' + icon('bolt') + ' اقترح من متوسط آخر 3 أشهر</button></div>';
    }
    h += '<div class="grid n4">' + stat('calc', 'المخطط', b.planned, 'ريال سعودي · ' + numSpan(b.month)) + stat('swap', 'مصروف التصنيفات المخططة', b.plannedSpent, 'ريال سعودي · حتى اليوم') + stat('chart', 'المتبقي في الخطة', b.remaining, 'ريال سعودي · قد يكون سالبًا عند التجاوز') + stat('warn', 'مصروف خارج الخطة', b.outsidePlan, 'ريال سعودي · تصنيفات بلا ميزانية') + '</div>' +
      '<div class="toolbar"><button class="btn primary" data-act="editBudget" data-cat="">' + icon('plus') + ' تحديد ميزانية</button><button class="btn" data-act="copyBudget"' + (b.hasPrev ? '' : ' disabled title="لا توجد خطة في الشهر السابق"') + '>نسخ خطة الشهر السابق</button></div>';
    if (!b.rows.length) return h + '<div class="card">' + emptyState('calc', 'لا توجد ميزانية لـ' + monthLabel(S.month), 'حدّد سقفًا لكل تصنيف لتعرف المتبقي وتصلك تنبيهات عند 80% و100%.', '<div><button class="btn primary" data-act="editBudget" data-cat="">' + icon('plus') + ' تحديد ميزانية</button></div>') + '</div>';
    h += '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>التصنيف</th><th class="amt">الميزانية</th><th class="amt">المصروف</th><th class="amt">المتبقي</th><th style="min-width:170px">الاستهلاك</th><th>الحالة</th><th></th></tr></thead><tbody>' + b.rows.map(function (r) {
      return '<tr tabindex="0" data-row-edit="editBudget" data-row-del="delBudget" data-id="' + r.id + '" data-cat="' + r.categoryId + '" data-amount="' + r.budget + '" data-name="' + esc(r.name) + '"><td>' + esc(r.name) + '</td><td class="amt">' + money(r.budget) + '</td><td class="amt">' + money(r.spent) + '</td><td class="amt' + (r.remaining < 0 ? ' neg' : '') + '">' + money(r.remaining) + '</td><td><div class="row" style="flex-wrap:nowrap"><div style="flex:1">' + progress(r.pct, r.status) + '</div><span class="num small b">' + r.pct + '%</span></div></td><td>' + statusPill(r.status) + '</td><td class="actions"><button class="btn icon sm ghost" data-act="editBudget" data-cat="' + r.categoryId + '" data-amount="' + r.budget + '" aria-label="تعديل" title="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delBudget" data-id="' + r.id + '" data-name="' + esc(r.name) + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
    }).join('') + '</tbody></table></div><p class="muted small mt">تُقارن الخطة بالمصروف الفعلي وسداد الديون والالتزامات بحسب تصنيفها. الادخار ليس مصروفًا.</p></div>';
    return h;
  });
}
function budgetWeek() {
  return api('getWeek', { date: S.weekDate }).then(function (w) {
    var g = w.items[0], cats = w.items.slice(1);
    var h = '<div class="toolbar"><div class="month-nav" role="group" aria-label="اختيار الأسبوع"><button class="btn icon sm ghost" data-act="week" data-step="-7" aria-label="الأسبوع السابق" title="الأسبوع السابق">' + icon('right', 16) + '</button><span class="label" style="cursor:default;min-width:250px">' + esc(dayName(w.start)) + ' ' + numSpan(w.start) + ' ← ' + esc(dayName(w.end)) + ' ' + numSpan(w.end) + '</span><button class="btn icon sm ghost" data-act="week" data-step="7" aria-label="الأسبوع التالي" title="الأسبوع التالي">' + icon('left', 16) + '</button></div>' +
      (w.start !== D.weekStartOf(S.today, w.weekStart) ? '<button class="btn sm" data-act="weekNow">هذا الأسبوع</button>' : '<span class="pill">الأسبوع الحالي · باقي ' + plural(w.daysLeft, 'يوم واحد', 'يومان', 'أيام', 'يومًا') + '</span>') + '</div>';
    h += '<div class="card block"><div class="between"><div><h2>مصروف حر</h2><div class="sub">كل مصروفك هذا الأسبوع، ما عدا سداد الالتزامات والديون والتصنيفات التي لها ميزانية أسبوعية خاصة.</div></div>' + (g.budget > 0 ? statusPill(g.status) : '') + '</div>';
    if (g.budget > 0) {
      h += '<div class="goal-amt">' + money(g.spent) + ' <small>من</small> ' + money(g.total) + ' <small>ريال</small> <span class="num small muted">(' + g.pct + '%)</span></div>' + progress(g.pct, g.status, true) +
        '<div class="grid mt" style="margin-bottom:0"><div><div class="muted small">المتبقي هذا الأسبوع</div><div class="b' + (g.remaining < 0 ? ' neg' : '') + '" style="font-size:20px">' + sar(g.remaining) + '</div></div>' +
        (w.isCurrent ? '<div><div class="muted small">المسموح يوميًا لباقي الأسبوع</div><div class="b" style="font-size:20px">' + sar(w.dailyAllowance) + '</div></div>' : '') +
        '<div><div class="muted small">ميزانية الأسبوع' + (g.isDefault ? ' (افتراضي: الشهرية ÷ 4)' : '') + '</div><div class="b" style="font-size:20px">' + sar(g.budget) + '</div></div>' +
        (w.rollover ? '<div><div class="muted small">' + (g.carry < 0 ? 'عجز مرحّل من أسابيع سابقة' : w.deficit ? 'مرحّل من أسابيع سابقة' : 'مرحّل من الأسبوع السابق') + '</div><div class="b' + (g.carry < 0 ? ' neg' : '') + '" style="font-size:20px">' + sar(g.carry) + '</div></div>' : '') + '</div>';
    } else {
      h += '<p class="mt">صرفت هذا الأسبوع ' + sar(g.spent) + '. لا توجد ميزانية أسبوعية بعد — الافتراضي هو مجموع ميزانيتك الشهرية ÷ 4، ولم تُحدَّد ميزانية شهرية لهذا الشهر.</p>';
    }
    h += '<div class="row mt"><button class="btn primary" data-act="editWeekly" data-cat="" data-amount="' + (g.isDefault ? '' : g.budget) + '" data-default="' + g.budget + '">' + (g.isDefault ? 'حدّد مبلغًا أسبوعيًا' : 'تعديل المبلغ الأسبوعي') + '</button>' + (g.isDefault ? '' : '<button class="btn" data-act="delWeekly" data-cat="" data-name="مصروف حر">العودة للافتراضي</button>') + '</div></div>';

    h += '<div class="card block"><div class="between mb"><div><h2>ميزانيات أسبوعية للتصنيفات</h2><div class="sub">اختياري: خصّص سقفًا أسبوعيًا لتصنيف بعينه فيُحسب خارج «المصروف الحر».</div></div><button class="btn" data-act="editWeekly" data-cat="new"' + (w.availableCategories.length ? '' : ' disabled') + '>' + icon('plus') + ' إضافة تصنيف</button></div>';
    if (!cats.length) h += emptyState('calc', 'لا ميزانيات أسبوعية للتصنيفات', 'مثال: 150 ريال أسبوعيًا للطعام.');
    else h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>التصنيف</th><th class="amt">الميزانية</th>' + (w.rollover ? '<th class="amt">المرحّل</th>' : '') + '<th class="amt">المصروف</th><th class="amt">المتبقي</th><th style="min-width:160px">الاستهلاك</th><th>الحالة</th><th></th></tr></thead><tbody>' + cats.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td class="amt">' + money(r.budget) + '</td>' + (w.rollover ? '<td class="amt' + (r.carry < 0 ? ' neg' : '') + '">' + money(r.carry) + '</td>' : '') + '<td class="amt">' + money(r.spent) + '</td><td class="amt' + (r.remaining < 0 ? ' neg' : '') + '">' + money(r.remaining) + '</td><td><div class="row" style="flex-wrap:nowrap"><div style="flex:1">' + progress(r.pct, r.status) + '</div><span class="num small b">' + r.pct + '%</span></div></td><td>' + statusPill(r.status) + '</td><td class="actions"><button class="btn icon sm ghost" data-act="editWeekly" data-cat="' + r.categoryId + '" data-amount="' + r.budget + '" data-name="' + esc(r.name) + '" aria-label="تعديل" title="تعديل">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delWeekly" data-cat="' + r.categoryId + '" data-name="' + esc(r.name) + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    h += '</div><div class="card"><h2>خيارات الأسبوع</h2><div class="grid mt" style="margin-bottom:0"><div class="field" style="margin:0"><label for="ws">يوم بداية الأسبوع</label><select class="input" id="ws" data-setting="week_start">' + [6, 0, 1, 2, 3, 4, 5].map(function (i) { return '<option value="' + i + '"' + (w.weekStart === i ? ' selected' : '') + '>' + DAYS[i] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field" style="margin:0"><label class="check" style="margin-top:24px"><input type="checkbox" data-setting="weekly_rollover"' + (w.rollover ? ' checked' : '') + '> <span>ترحيل المتبقي إلى الأسبوع التالي</span></label><div class="hint">ما لم تصرفه من ميزانية الأسبوع يُضاف إلى الأسبوع الذي بعده.</div></div>' +
      '<div class="field" style="margin:0"><label class="check" style="margin-top:24px"><input type="checkbox" data-setting="weekly_deficit"' + (w.deficit ? ' checked' : '') + (w.rollover ? '' : ' disabled') + '> <span>ترحيل العجز أيضًا</span></label><div class="hint">إذا تجاوزت ميزانية أسبوع، يُخصم التجاوز من الأسابيع التالية حتى تعوّضه. مثال: ميزانية 100 وصرفت 150 ← الأسبوع التالي 50. يبدأ الحساب من أسبوع التفعيل.</div></div></div></div>';
    return h;
  });
}
function fillBudgetsDialog(suggest) {
  api('getBudget', { month: S.month }).then(function (b) {
    if (!b.unbudgeted.length) { toast('كل التصنيفات لها ميزانية.'); return; }
    var body = '<p class="muted small mb">' + (suggest ? 'المبالغ مقترحة من متوسط صرفك في آخر 3 أشهر (مقرّبة لأعلى 10 ريالات). عدّل ما تشاء قبل الحفظ.' : 'اكتب ميزانية ' + monthLabel(S.month) + ' لكل تصنيف. اترك الحقل فارغًا لتخطي التصنيف.') + '</p><div class="err" role="alert"></div><table class="tbl"><thead><tr><th>التصنيف</th><th class="amt">صرف هذا الشهر</th><th class="amt">المقترح</th><th style="width:150px">الميزانية (ريال)</th></tr></thead><tbody>' +
      b.unbudgeted.map(function (u) {
        return '<tr><td>' + esc(u.name) + '</td><td class="amt">' + money(u.spent) + '</td><td class="amt">' + money(u.suggested) + '<div class="small muted">' + (u.basis === 'avg3' ? 'متوسط 3 أشهر' : 'من صرف هذا الشهر') + '</div></td><td><input class="input ltr" data-cat="' + u.categoryId + '" inputmode="decimal" placeholder="0.00" aria-label="ميزانية ' + esc(u.name) + '" value="' + (suggest && u.suggested ? C.fmt(u.suggested).replace(/,/g, '') : '') + '"></td></tr>';
      }).join('') + '</tbody></table>';
    openModal({
      title: suggest ? 'ميزانيات مقترحة' : 'حدّد ميزانيات للبقية', wide: true, body: body,
      footer: '<button class="btn primary" data-save>حفظ الميزانيات</button>' + (suggest ? '' : '<button class="btn" data-fill>' + icon('bolt') + ' املأ بالمقترح</button>') + '<button class="btn" data-close>إلغاء</button>',
      onOpen: function (ov, close) {
        var fill = $('[data-fill]', ov);
        if (fill) fill.onclick = function () { b.unbudgeted.forEach(function (u) { var i = $('input[data-cat="' + u.categoryId + '"]', ov); if (!i.value && u.suggested) i.value = C.fmt(u.suggested).replace(/,/g, ''); }); };
        $('[data-save]', ov).onclick = function () {
          var items = [], bad = false;
          $$('input[data-cat]', ov).forEach(function (i) {
            var raw = i.value.trim(); if (!raw) return;
            var a = C.parseAmount(raw);
            if (a == null || a <= 0) bad = true; else items.push({ categoryId: Number(i.getAttribute('data-cat')), amount: a });
          });
          if (bad) { $('.err', ov).textContent = 'اكتب مبالغ صحيحة أكبر من صفر، مثل 500 أو 512.50'; return; }
          if (!items.length) { $('.err', ov).textContent = 'اكتب ميزانية لتصنيف واحد على الأقل.'; return; }
          write('setBudgets', { month: S.month, items: items }).then(function (r) { close(); toast('حُفظت ' + plural(r.saved, 'ميزانية واحدة', 'ميزانيتان', 'ميزانيات', 'ميزانية')); }).catch(function (e) { $('.err', ov).textContent = e.message; });
        };
      }
    });
  }).catch(oops);
}

// ---------- savings ----------
VIEW.savings = function () {
  return api('getSavings', { kind: S.sav.kind || undefined, q: S.sav.q || undefined }).then(function (s) {
    var h = '<div class="grid wide"><div class="card stat hero"><div class="k">' + icon('safe', 17) + '<span>رصيد الادخار الحالي</span></div><div class="v">' + sar(s.total) + '</div><div class="u">الإيداع ينقل من النقدية إلى الادخار، والسحب يعيد إلى النقدية. كلاهما خارج الدخل والمصروف.</div>' +
      '<div class="row mt"><button class="btn primary" data-act="savOp" data-kind="deposit" data-goal="">' + icon('plus') + ' إيداع في الادخار</button><button class="btn" data-act="savOp" data-kind="withdraw" data-goal=""' + (s.total > 0 ? '' : ' disabled') + '>' + icon('swap') + ' سحب من الادخار</button></div></div>';
    if (!s.goals.length) {
      h += '<div class="card">' + emptyState('target', s.total > 0 ? 'رصيدك ' + C.fmt(s.total) + ' ريال — بلا هدف بعد' : 'حدّد هدفك الأول', 'حدّد قيمة تريد الوصول إليها لترى نسبة التقدم وتاريخ الوصول المتوقع.', '<div><button class="btn primary" data-act="editGoal" data-id="">' + icon('target') + ' حدّد هدفًا</button></div>') + '</div></div>';
    } else {
      h += '<div class="card stat"><div class="k">' + icon('wallet', 17) + '<span>النقدية المتاحة للإيداع</span></div><div class="v' + (s.cash < 0 ? ' neg' : '') + '">' + sar(s.cash) + '</div><div class="u">رصيدك النقدي الآن.' + (s.unassigned > 0 ? ' · ادخار غير مخصص لهدف: ' + money(s.unassigned) : '') + '</div></div></div>' +
        '<div class="between mb"><h2 style="font-size:18px">أهداف الادخار</h2><button class="btn" data-act="editGoal" data-id="">' + icon('plus') + ' هدف جديد</button></div><div class="grid wide">' + s.goals.map(function (g) {
          var eta = g.target <= 0 ? 'بلا قيمة مستهدفة — عدّل الهدف لتحديدها.' : g.reached ? 'تحقق الهدف 🎉'.replace(' 🎉', '') + '.' : g.eta ? 'الوصول المتوقع: <b>' + numSpan(g.eta) + '</b> بمعدل ' + sar(g.monthlyRate) + ' شهريًا' : 'لا يمكن توقع تاريخ الوصول بعد — لا إيداعات حديثة.';
          return '<div class="card"><div class="goal-head"><div><h2>' + esc(g.name) + '</h2></div><div class="row" style="gap:2px"><button class="btn icon sm ghost" data-act="editGoal" data-id="' + g.id + '" data-name="' + esc(g.name) + '" data-target="' + g.target + '" aria-label="تعديل الهدف" title="تعديل الهدف">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delGoal" data-id="' + g.id + '" data-name="' + esc(g.name) + '" aria-label="حذف الهدف" title="حذف الهدف">' + icon('trash', 16) + '</button></div></div>' +
            '<div class="goal-amt">' + money(g.balance) + (g.target > 0 ? ' <small>من</small> ' + money(g.target) : '') + ' <small>ريال</small>' + (g.target > 0 ? ' <span class="num small muted">(' + g.pct + '%)</span>' : '') + '</div>' + (g.target > 0 ? progress(g.pct, 'plain', true) : '') +
            '<div class="small muted mt">' + eta + (g.target > 0 && !g.reached ? ' · المتبقي ' + money(g.remaining) : '') + '</div>' +
            '<div class="row mt"><button class="btn sm primary" data-act="savOp" data-kind="deposit" data-goal="' + g.id + '">' + icon('plus', 15) + ' إيداع</button><button class="btn sm" data-act="savOp" data-kind="withdraw" data-goal="' + g.id + '"' + (g.balance > 0 ? '' : ' disabled') + '>سحب</button></div></div>';
        }).join('') + '</div>';
    }
    h += '<div class="card"><h2>سجل الادخار</h2><div class="sub mb">كل إيداع وسحب، مع الهدف المرتبط به.</div><div class="toolbar" data-filter="sav"><input class="input grow" data-f="q" type="search" placeholder="بحث في الملاحظات والأهداف…" value="' + esc(S.sav.q) + '" aria-label="بحث في سجل الادخار"><select class="input" data-f="kind" aria-label="نوع العملية">' + [['', 'كل العمليات'], ['deposit', 'إيداع'], ['withdraw', 'سحب']].map(function (o) { return '<option value="' + o[0] + '"' + (S.sav.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    if (!s.ops.length) h += emptyState('safe', 'لا عمليات ادخار', S.sav.q || S.sav.kind ? 'لا شيء يطابق الفلاتر.' : 'ابدأ بإيداع أول مبلغ، ولو كان صغيرًا.');
    else h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>التاريخ</th><th>العملية</th><th class="amt">المبلغ</th><th>الهدف</th><th>الملاحظات</th><th></th></tr></thead><tbody>' + s.ops.map(function (o) {
      return '<tr tabindex="0" data-row-edit="editSavOp" data-row-del="delSavOp" data-id="' + o.id + '" data-kind="' + o.kind + '" data-amount="' + o.amount + '" data-date="' + o.date + '" data-goal="' + (o.goalId || '') + '" data-notes="' + esc(o.notes) + '"><td>' + numSpan(o.date) + '</td><td>' + (o.kind === 'deposit' ? 'إيداع ادخار' : 'سحب من الادخار') + '</td><td class="amt">' + money(o.amount) + '</td><td>' + esc(o.goal || '—') + '</td><td class="clip muted" title="' + esc(o.notes) + '">' + esc(o.notes) + '</td><td class="actions"><button class="btn icon sm ghost" data-act="editSavOp" data-id="' + o.id + '" data-kind="' + o.kind + '" data-amount="' + o.amount + '" data-date="' + o.date + '" data-goal="' + (o.goalId || '') + '" data-notes="' + esc(o.notes) + '" aria-label="تصحيح" title="تصحيح">' + icon('edit', 16) + '</button><button class="btn icon sm ghost" data-act="delSavOp" data-id="' + o.id + '" aria-label="حذف" title="حذف">' + icon('trash', 16) + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    return h + '</div>';
  });
};
function savOpForm(o) {
  api('getSavings').then(function (s) {
    var goals = s.goals.map(function (g) { return [g.id, g.name + ' — ' + C.fmt(g.balance)]; });
    formModal({
      title: o.id ? 'تصحيح عملية ادخار' : (o.kind === 'deposit' ? 'إيداع في الادخار' : 'سحب من الادخار'),
      intro: o.kind === 'deposit' ? 'النقدية المتاحة الآن: ' + sar(s.cash) : 'رصيد الادخار: ' + sar(s.total),
      fields: [
        { name: 'amount', label: 'المبلغ (ريال)', type: 'amount', value: o.amount == null ? '' : o.amount, required: true, half: true },
        { name: 'date', label: 'التاريخ', type: 'date', value: o.date || S.today, required: true, half: true }
      ].concat(goals.length ? [{ name: 'goalId', label: 'الهدف', type: 'select', value: o.goalId || (goals.length === 1 ? goals[0][0] : ''), options: goals, placeholder: 'بدون هدف محدد' }] : []).concat([{ name: 'notes', label: 'ملاحظات', type: 'text', value: o.notes || '' }]),
      onSubmit: function (v) {
        return write('saveSavingsOp', { id: o.id, kind: o.kind, amount: v.amount, date: v.date, goalId: v.goalId ? Number(v.goalId) : null, notes: v.notes }).then(function () { toast(o.kind === 'deposit' ? 'تم الإيداع: ' + sar(v.amount) : 'تم السحب: ' + sar(v.amount)); });
      }
    });
  }).catch(oops);
}

// ---------- reports ----------
function reportRange() {
  var r = S.report;
  if (r.type === 'year') return { from: S.month.slice(0, 4) + '-01-01', to: S.month.slice(0, 4) + '-12-31', label: 'سنة ' + S.month.slice(0, 4) };
  if (r.type === 'custom' && D.isDate(r.from) && D.isDate(r.to)) return { from: r.from, to: r.to, label: r.from + ' ← ' + r.to };
  return { from: D.monthStart(S.month), to: D.monthEnd(S.month), label: monthLabel(S.month) };
}
VIEW.reports = function () {
  var rg = reportRange();
  return api('report', { from: rg.from, to: rg.to }).then(function (r) {
    S.lastReport = { data: r, label: rg.label };
    var h = '<div class="toolbar" data-filter="report"><select class="input" data-f="type" aria-label="نوع التقرير">' + [['month', 'شهري'], ['year', 'سنوي'], ['custom', 'فترة مخصصة']].map(function (o) { return '<option value="' + o[0] + '"' + (S.report.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      (S.report.type === 'custom' ? '<input class="input" data-f="from" type="date" value="' + esc(rg.from) + '" aria-label="بداية الفترة" title="بداية الفترة"><input class="input" data-f="to" type="date" value="' + esc(rg.to) + '" aria-label="نهاية الفترة" title="نهاية الفترة">' : '<span class="pill muted">' + (S.report.type === 'year' ? esc(rg.label) : numSpan(rg.from) + ' ← ' + numSpan(rg.to)) + '</span>') +
      '<span class="spacer"></span><button class="btn" data-act="exportCsv">' + icon('download') + ' تصدير CSV</button><button class="btn" data-act="exportPdf">' + icon('download') + ' تصدير PDF</button></div>' +
      '<div class="grid n4">' + stat('chart', 'الدخل', r.income, 'ريال سعودي · الفترة المحددة') + stat('swap', 'المصروف', r.expense, 'ريال سعودي · الفترة المحددة') + stat('wallet', 'الصافي', r.net, 'ريال سعودي · الدخل − المصروف') + stat('safe', 'صافي التحويل إلى الادخار', r.saved, 'ريال سعودي · إيداع ناقص سحب') + '</div>';
    var items = groupItems(r.byCategory, 8);
    h += '<div class="grid wide"><div class="card"><h2>توزيع المصروفات</h2><div class="sub mb">' + esc(rg.label) + '</div>' + (items.length ? '<div class="chart-row">' + donut(items, { size: 210 }) + legend(items) + '</div>' : emptyState('chart', 'لا مصروفات في هذه الفترة', 'غيّر الفترة أو سجّل حركاتك.')) + '</div>' +
      '<div class="card"><h2>المقارنة الشهرية</h2><div class="sub mb">الدخل والمصروف لآخر ' + r.months.length + ' أشهر حتى ' + numSpan(r.months[r.months.length - 1].month) + '</div>' +
      (barsCompare(r.months) ? barsCompare(r.months) + '<div class="row small mt"><span class="row" style="gap:6px"><span class="sw" style="width:12px;height:12px;border-radius:3px;background:var(--good);display:inline-block"></span>الدخل</span><span class="row" style="gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--bad);display:inline-block"></span>المصروف</span></div>' : emptyState('chart', 'لا بيانات للمقارنة', 'ستظهر الأعمدة بعد تسجيل الحركات.')) + '</div></div>';
    if (r.byCategory.length) {
      h += '<div class="card"><h2>تفصيل التصنيفات</h2><div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>التصنيف</th><th class="amt">المبلغ</th><th style="min-width:200px">الحصة من المصروف</th></tr></thead><tbody>' + r.byCategory.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="amt">' + money(c.amount) + '</td><td><div class="row" style="flex-wrap:nowrap"><div style="flex:1">' + progress(c.pct, 'plain') + '</div><span class="num small b">' + c.pct + '%</span></div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    }
    return h;
  });
};
function reportHtml(r, label) {
  var ink = '#14242d', o = { grid: '#dbe3e8', incomeColor: '#1c8a5f', expenseColor: '#c2372c' };
  var items = groupItems(r.byCategory, 8), total = r.expense;
  var leg = items.map(function (it, i) { return '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + PALETTE[i % PALETTE.length] + '"></span> ' + esc(it.name) + '</td><td class="n">' + C.fmt(it.amount) + '</td><td class="n">' + (total ? Math.round(it.amount * 100 / total) : 0) + '%</td></tr>'; }).join('');
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:' + ink + ';font-size:12px;margin:0}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #c3d0d8;padding-bottom:4px}.sub{color:#51656f;margin-bottom:10px}table{width:100%;border-collapse:collapse}th,td{padding:5px 7px;border-bottom:1px solid #e3eaee;text-align:right}th{background:#f0f4f6;font-weight:600}.n{direction:ltr;unicode-bidi:isolate;text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}.cards{display:flex;gap:8px}.c{flex:1;border:1px solid #dbe3e8;border-radius:6px;padding:8px 10px}.c b{display:block;font-size:16px;direction:ltr;text-align:right}.two{display:flex;gap:16px;align-items:center}svg text{font-family:inherit;fill:#51656f;font-size:11px}tr{page-break-inside:avoid}</style></head><body>' +
    '<h1>ميزاني — تقرير مالي</h1><div class="sub">' + esc(label) + ' · <span class="n">' + r.from + ' → ' + r.to + '</span> · المبالغ بالريال السعودي</div>' +
    '<div class="cards"><div class="c">الدخل<b>' + C.fmt(r.income) + '</b></div><div class="c">المصروف<b>' + C.fmt(r.expense) + '</b></div><div class="c">الصافي<b>' + C.fmt(r.net) + '</b></div><div class="c">صافي الادخار<b>' + C.fmt(r.saved) + '</b></div></div>' +
    (items.length ? '<h2>توزيع المصروفات</h2><div class="two">' + donut(items, { size: 180, ink: ink }) + '<table><tr><th>التصنيف</th><th class="n">المبلغ</th><th class="n">النسبة</th></tr>' + leg + '</table></div>' : '') +
    '<h2>المقارنة الشهرية</h2>' + barsCompare(r.months, Object.assign({ width: 700 }, o)) +
    '<table><tr><th>الشهر</th><th class="n">الدخل</th><th class="n">المصروف</th><th class="n">الصافي</th></tr>' + r.months.map(function (m) { return '<tr><td class="n" style="text-align:right">' + m.month + '</td><td class="n">' + C.fmt(m.income) + '</td><td class="n">' + C.fmt(m.expense) + '</td><td class="n">' + C.fmt(m.income - m.expense) + '</td></tr>'; }).join('') + '</table>' +
    '<h2>الحركات (' + r.rows.length + ')</h2><table><tr><th>التاريخ</th><th>النوع</th><th class="n">المبلغ</th><th>التصنيف</th><th>الوصف</th></tr>' + r.rows.map(function (t) { return '<tr><td class="n" style="text-align:right">' + t.date + '</td><td>' + TYPE_NAME[t.type] + '</td><td class="n">' + C.fmt(t.amount) + '</td><td>' + esc(t.category) + '</td><td>' + esc(t.description) + '</td></tr>'; }).join('') + '</table></body></html>';
}

// ---------- settings ----------
VIEW.settings = function () {
  return Promise.all([host('info'), api('info'), host('syncStatus')]).then(function (r) {
    var hi = r[0], inf = r[1], sy = r[2], light = S.settings.theme === 'light';
    var keys = [['Ctrl+N', 'إضافة حركة'], ['Ctrl+F', 'البحث الشامل'], ['Ctrl+Z', 'تراجع عن آخر حذف'], ['Ctrl+1 … Ctrl+8', 'التنقل بين الصفحات'], ['Alt+→ / Alt+←', 'الشهر السابق / التالي'], ['Enter', 'تعديل الصف المحدد'], ['Delete', 'حذف الصف المحدد'], ['Esc', 'إغلاق النافذة المفتوحة']];
    var h = (hi.startupNotice ? '<div class="banner bad">' + icon('warn') + '<div class="t"><b>تنبيه عند التشغيل</b><span style="white-space:pre-wrap">' + esc(hi.startupNotice) + '</span></div></div>' : '') +
      '<div class="card block"><h2>مظهر يناسبك</h2><div class="sub mb">يُحفظ اختيارك ويُستخدم عند فتح التطبيق مجددًا.</div><div class="seg"><button class="' + (light ? '' : 'on') + '" data-act="theme" data-theme="dark" aria-pressed="' + !light + '">' + icon('moon', 16) + ' الوضع الداكن</button><button class="' + (light ? 'on' : '') + '" data-act="theme" data-theme="light" aria-pressed="' + light + '">' + icon('sun', 16) + ' الوضع الفاتح</button></div></div>' +
      '<div class="card block"><h2>بياناتك تحت يدك</h2><div class="sub mb">أنشئ نسخة احتياطية بانتظام. الاستعادة تستبدل قاعدة البيانات كاملة بعد التحقق من سلامة الملف، وتحتفظ بنسخة أمان من البيانات الحالية.</div><div class="row"><button class="btn primary" data-act="backupNow">' + icon('folder') + ' إنشاء نسخة احتياطية</button><button class="btn" data-act="restore">' + icon('swap') + ' استعادة نسخة</button></div></div>' +
      '<div class="card block"><h2>المزامنة مع الجوال</h2><div class="sub mb">تُزامَن بياناتك تلقائيًا بين الكمبيوتر والجوال عبر حساب Google الخاص بك (مجلد مخفي لا يراه غير ميزاني).</div>' +
      (!sy.configured ? '<div class="muted">المزامنة غير مفعّلة في هذا الإصدار.</div>' : sy.connected ? '<div class="mb">الحالة: <span class="pill">' + (sy.state.status === 'error' ? 'خطأ' : sy.state.status === 'syncing' ? 'جارٍ المزامنة' : 'متصل') + '</span>' + (sy.state.lastSync ? ' <span class="small muted">آخر مزامنة: <span class="num">' + esc(new Date(sy.state.lastSync).toLocaleString('en-GB')) + '</span></span>' : '') + (sy.state.lastError ? '<div class="small mt" style="color:var(--bad)">' + esc(sy.state.lastError) + '</div>' : '') + '</div><div class="row"><button class="btn primary" data-act="syncNow">زامن الآن</button><button class="btn ghost" data-act="syncOff">فصل الحساب</button></div>' : '<div class="row"><button class="btn primary" data-act="syncOn">ربط حساب Google</button></div>') + '</div>' +
      (hi.web ? '' : '<div class="card block"><h2>نسخ احتياطي تلقائي أسبوعي</h2><div class="sub mb">تُحفظ نسخة كل أسبوع في المجلد الذي تختاره (مثل مجلد OneDrive)، ويُحتفظ بآخر 5 نسخ فقط.</div>' +
      (hi.backupDir ? '<div class="mb">المجلد: <span class="num">' + esc(hi.backupDir) + '</span> ' + (hi.backupDirOk ? '<span class="pill">يعمل</span>' : '<span class="pill over">المجلد غير موجود</span>') + '<div class="small muted mt">آخر نسخة تلقائية: ' + (hi.lastAutoBackup ? numSpan(hi.lastAutoBackup.slice(0, 16).replace('T', ' ')) : 'لم تُنشأ بعد') + ' · النسخ المحفوظة: ' + numSpan(hi.autoBackups.length) + ' من 5</div></div>' : '<div class="mb muted">لم تختر مجلدًا بعد — النسخ التلقائي متوقف.</div>') +
      '<div class="row"><button class="btn' + (hi.backupDir ? '' : ' primary') + '" data-act="chooseBackupDir">' + icon('folder') + ' ' + (hi.backupDir ? 'تغيير المجلد' : 'اختيار المجلد') + '</button>' + (hi.backupDir ? '<button class="btn" data-act="autoBackupNow">انسخ الآن</button><button class="btn ghost" data-act="clearBackupDir">إيقاف النسخ التلقائي</button>' : '') + '</div></div>') +
      '<div class="card block"><h2>اختصارات لوحة المفاتيح</h2><div class="grid mt" style="margin-bottom:0">' + keys.map(function (k) { return '<div class="between"><span>' + k[1] + '</span><kbd>' + k[0] + '</kbd></div>'; }).join('') + '</div></div>' +
      '<div class="card"><h2>عن ميزاني</h2><div class="b mt">الإصدار ' + numSpan(inf.appVersion) + ' • Windows x64</div><div class="sub">يعمل بالكامل دون إنترنت، ودون حساب أو اشتراك. الأرقام بالإنجليزية والقيم بالريال السعودي. المبالغ تُحفظ بالهللة كأعداد صحيحة.</div>' +
      '<div class="small muted mt">موقع قاعدة البيانات</div><div class="num small">' + esc(hi.dbPath) + '</div><div class="row mt">' + (hi.web ? '' : '<button class="btn sm" data-act="openDataDir">' + icon('folder', 15) + ' فتح مجلد البيانات</button>') + '</div>' +
      '<div class="small muted mt">يحتفظ المثبّت بالبيانات عند التحديث، وتُؤخذ نسخة أمان تلقائية قبل أي ترقية لبنية البيانات. إزالة التثبيت تحتفظ بها أيضًا إلا إذا اخترت حذفها صراحةً.' + (hi.legacyFound ? ' بيانات الإصدار 1.0 موجودة كما هي ولم تُمس: <span class="num">' + esc(hi.legacyPath) + '</span>' : '') + '</div></div>';
    return h;
  });
};

// ================= ACTIONS =================
var ACT = {
  go: function (d) { go(d.page); },
  addTx: function () { txDialog().catch(oops); },
  editTx: function (d) { api('listTransactions', {}).then(function (rows) { var t = rows.filter(function (x) { return x.src === 'tx' && String(x.id) === String(d.id); })[0]; if (t) return txDialog(t); }).catch(oops); },
  delTx: function (d) { removeWithUndo('deleteTransaction', { id: Number(d.id) }, 'حذف هذه الحركة؟'); },
  txAll: function () { S.tx.all = !S.tx.all; S.tx.from = ''; S.tx.to = ''; refresh(); },
  txClear: function () { S.tx = { q: '', type: '', categoryId: '', all: false, from: '', to: '', limit: 200 }; $('#q').value = ''; refresh(); },
  txMore: function () { S.tx.limit += 200; refresh(); },
  templates: function () { templatesDialog(); },
  editTemplate: function (d) { api('listTemplates').then(function (l) { templateForm(l.filter(function (t) { return String(t.id) === String(d.id); })[0]); }).catch(oops); },
  delTemplate: function (d) { confirmDialog('حذف هذا القالب؟', { danger: true, ok: 'حذف', title: 'تأكيد الحذف' }).then(function (y) { if (y) api('deleteTemplate', { id: Number(d.id) }).then(function () { closeTopModal(); return refresh(); }).then(templatesDialog).catch(oops); }); },
  useTemplate: function (d) { write('useTemplate', { id: Number(d.id), date: S.today }).then(function () { toast('أُضيفت الحركة بتاريخ اليوم'); }).catch(oops); },
  categories: function () { categoriesDialog(); },
  editCategory: function (d) {
    formModal({ title: d.id ? 'إعادة تسمية تصنيف' : (d.kind === 'income' ? 'تصنيف دخل جديد' : 'تصنيف مصروف جديد'), fields: [{ name: 'name', label: 'اسم التصنيف', type: 'text', value: d.name || '', required: true, maxlength: 40 }],
      onSubmit: function (v) { return api('saveCategory', { id: d.id ? Number(d.id) : undefined, name: v.name, kind: d.kind }).then(function () { closeTopModal(); closeTopModal(); return refresh(); }).then(function () { categoriesDialog(); return false; }); } });
  },
  delCategory: function (d) {
    confirmDialog('حذف التصنيف «' + esc(d.name) + '»؟', { danger: true, ok: 'حذف', title: 'تأكيد الحذف', note: Number(d.uses) ? 'هذا التصنيف مستخدم، لذلك سيُخفى من القوائم فقط وتبقى حركاته كما هي.' : '' }).then(function (y) {
      if (y) api('deleteCategory', { id: Number(d.id) }).then(function () { closeTopModal(); return refresh(); }).then(categoriesDialog).catch(oops);
    });
  },
  month: function (d) { S.month = D.addMonths(S.month, Number(d.step)); S.tx.from = ''; S.tx.to = ''; refresh(); },
  monthNow: function () { S.month = D.monthOf(S.today); S.tx.from = ''; S.tx.to = ''; refresh(); },
  pickMonth: function (d, el) {
    var y = +S.month.slice(0, 4);
    function html() { return '<div class="between"><button class="btn icon sm ghost" data-y="-1" aria-label="السنة السابقة">' + icon('right', 16) + '</button><b class="num">' + y + '</b><button class="btn icon sm ghost" data-y="1" aria-label="السنة التالية">' + icon('left', 16) + '</button></div><div class="months">' + MONTHS.map(function (n, i) { var m = y + '-' + (i < 9 ? '0' : '') + (i + 1); return '<button data-m="' + m + '" class="' + (m === S.month ? 'on' : '') + '">' + n + '</button>'; }).join('') + '</div>'; }
    var pop = openPop(el, html(), { minWidth: 300 });
    if (!pop) return;
    pop.addEventListener('click', function (e) {
      var by = e.target.closest('[data-y]'), bm = e.target.closest('[data-m]');
      if (by) { y += Number(by.getAttribute('data-y')); pop.innerHTML = html(); }
      if (bm) { S.month = bm.getAttribute('data-m'); S.tx.from = ''; S.tx.to = ''; closePop(); refresh(); }
    });
  },
  undo: function () { doUndo(); },
  bell: function (d, el) {
    var h = S.alerts.length ? '<h4>تنبيهات الميزانية</h4>' + S.alerts.map(function (a) {
      return '<button class="item" data-act="go" data-page="budget"><span>' + (a.level === 100 ? 'بلغت الحد' : 'تجاوزت 80%') + ': ' + esc(a.name) + '<small>' + (a.scope === 'week' ? 'ميزانية أسبوعية' : 'ميزانية شهرية') + ' · ' + C.fmt(a.spent) + ' من ' + C.fmt(a.budget) + '</small></span><span class="pill ' + (a.level === 100 ? 'over' : 'near') + ' num">' + a.pct + '%</span></button>';
    }).join('') : '<div class="empty" style="padding:18px">' + icon('check', 26) + '<b>لا تنبيهات</b><div>كل ميزانياتك دون 80%.</div></div>';
    openPop(el, h, { minWidth: 320, alignLeft: true });
  },
  searchTx: function (d) { closePop(); S.tx = { q: d.q, type: '', categoryId: '', all: true, from: '', to: '', limit: 200 }; go('tx'); },
  searchGo: function (d) { closePop(); if (d.page === 'debts') S.debts.q = d.q; if (d.page === 'dues') S.dues.q = d.q; go(d.page); },
  weekly: function () { S.weekDate = S.today; api('setSetting', { key: 'budget_mode', value: 'week' }).then(function () { go('budget'); }).catch(oops); },

  editDebt: function (d) { if (!d.id) return debtForm(); api('listDebts').then(function (r) { debtForm(r.rows.filter(function (x) { return String(x.id) === String(d.id); })[0]); }).catch(oops); },
  delDebt: function (d) { removeWithUndo('deleteDebt', { id: Number(d.id) }, 'حذف الدين «' + esc(d.name) + '» وسجل سداده؟', 'حركات السداد النقدية السابقة تبقى في سجل الحركات. يمكنك التراجع عن الحذف.'); },
  payDebt: function (d) {
    api('listDebts').then(function (r) {
      var x = r.rows.filter(function (y) { return String(y.id) === String(d.id); })[0];
      formModal({ title: (x.kind === 'on_me' ? 'تسجيل سداد — ' : 'تسجيل تحصيل — ') + x.party, intro: 'المتبقي: ' + sar(x.remaining),
        fields: [{ name: 'amount', label: 'المبلغ (ريال)', type: 'amount', value: x.installment && x.installment <= x.remaining ? x.installment : x.remaining, required: true, half: true }, { name: 'date', label: 'التاريخ', type: 'date', value: S.today, required: true, half: true }, { name: 'notes', label: 'ملاحظات', type: 'text', value: '' }],
        onSubmit: function (v) { return write('addDebtPayment', { debtId: x.id, amount: v.amount, date: v.date, notes: v.notes }).then(function () { toast('سُجّل السداد: ' + sar(v.amount)); }); } });
    }).catch(oops);
  },
  debtLog: function (d) { debtLog(d.id, d.name); },
  delDebtPayment: function (d) { confirmDialog('حذف هذا السداد وحركته النقدية؟', { danger: true, ok: 'حذف', title: 'تأكيد الحذف' }).then(function (y) { if (y) api('deleteDebtPayment', { id: Number(d.id) }).then(function () { closeTopModal(); return refresh(); }).then(function () { toast('حُذف السداد', { action: { label: 'تراجع', icon: 'undo', fn: doUndo } }); }).catch(oops); }); },

  editObligation: function (d) { if (!d.id) return obligationForm(); api('listObligations').then(function (l) { obligationForm(l.filter(function (o) { return String(o.id) === String(d.id); })[0]); }).catch(oops); },
  delObligation: function (d) { removeWithUndo('حذف placeholder', {}, '').catch(function () {}); },
  stopObligation: function (d) {
    confirmDialog('إيقاف «' + esc(d.name) + '» بعد ' + esc(monthLabel(D.monthOf(S.today))) + '؟', { ok: 'إيقاف', note: 'لن تُنشأ استحقاقات للأشهر القادمة. المتأخرات والاستحقاقات السابقة تبقى كما هي.' }).then(function (y) {
      if (!y) return;
      api('listObligations').then(function (l) { var o = l.filter(function (x) { return String(x.id) === String(d.id); })[0]; var end = D.monthOf(S.today) < o.startMonth ? o.startMonth : D.monthOf(S.today); return write('saveObligation', { id: o.id, name: o.name, amount: o.amount, dueDay: o.dueDay, categoryId: o.categoryId, startMonth: o.startMonth, endMonth: end }); }).catch(oops);
    });
  },
  resumeObligation: function (d) { api('listObligations').then(function (l) { var o = l.filter(function (x) { return String(x.id) === String(d.id); })[0]; return write('saveObligation', { id: o.id, name: o.name, amount: o.amount, dueDay: o.dueDay, categoryId: o.categoryId, startMonth: o.startMonth, endMonth: null }); }).catch(oops); },
  payDue: function (d) {
    formModal({ title: 'تسجيل سداد — ' + d.name, intro: 'استحقاق ' + numSpan(d.month) + '. يُسجَّل كمصروف بتاريخ السداد.',
      fields: [{ name: 'amount', label: 'المبلغ (ريال)', type: 'amount', value: Number(d.amount), required: true, half: true }, { name: 'date', label: 'تاريخ السداد', type: 'date', value: S.today, required: true, half: true }],
      onSubmit: function (v) { return write('payDue', { obligationId: Number(d.id), month: d.month, amount: v.amount, date: v.date }).then(function () { toast('سُجّل السداد: ' + sar(v.amount)); }); } });
  },
  unpayDue: function (d) { confirmDialog('إلغاء سداد «' + esc(d.name) + '» لشهر ' + numSpan(d.month) + '؟', { danger: true, ok: 'إلغاء السداد', note: 'تُحذف حركة المصروف المرتبطة. يمكنك التراجع.' }).then(function (y) { if (y) write('unpayDue', { obligationId: Number(d.id), month: d.month }).then(function () { toast('أُلغي السداد', { action: { label: 'تراجع', icon: 'undo', fn: doUndo } }); }).catch(oops); }); },

  budgetMode: function (d) { api('setSetting', { key: 'budget_mode', value: d.mode }).then(function () { return refresh(); }).catch(oops); },
  editBudget: function (d) {
    api('getBudget', { month: S.month }).then(function (b) {
      var used = {}; b.rows.forEach(function (r) { used[r.categoryId] = 1; });
      var opts = catsOf('expense').filter(function (c) { return d.cat ? String(c[0]) === String(d.cat) : !used[c[0]]; });
      if (!opts.length) { toast('كل تصنيفات المصروف لها ميزانية في هذا الشهر.'); return; }
      formModal({ title: d.cat ? 'تعديل ميزانية' : 'تحديد ميزانية — ' + monthLabel(S.month),
        fields: [{ name: 'categoryId', label: 'التصنيف', type: 'select', value: d.cat || '', options: opts, placeholder: d.cat ? undefined : 'اختر التصنيف', required: true }, { name: 'amount', label: 'الميزانية الشهرية (ريال)', type: 'amount', value: d.amount ? Number(d.amount) : '', required: true }],
        onSubmit: function (v) { return write('setBudget', { month: S.month, categoryId: Number(v.categoryId), amount: v.amount }); } });
    }).catch(oops);
  },
  delBudget: function (d) { removeWithUndo('deleteBudget', { id: Number(d.id) }, 'حذف ميزانية «' + esc(d.name) + '» لشهر ' + esc(monthLabel(S.month)) + '؟'); },
  copyBudget: function () { write('copyPrevBudget', { month: S.month }).then(function (r) { toast(r.copied ? 'نُسخت ' + plural(r.copied, 'ميزانية واحدة', 'ميزانيتان', 'ميزانيات', 'ميزانية') + ' من الشهر السابق' : 'كل ميزانيات الشهر السابق موجودة بالفعل.'); }).catch(oops); },
  fillBudgets: function (d) { fillBudgetsDialog(d.suggest === '1'); },
  week: function (d) { S.weekDate = D.addDays(S.weekDate, Number(d.step)); refresh(); },
  weekNow: function () { S.weekDate = S.today; refresh(); },
  editWeekly: function (d) {
    api('getWeek', { date: S.weekDate }).then(function (w) {
      var isNew = d.cat === 'new', general = d.cat === '';
      var fields = [];
      if (isNew) fields.push({ name: 'categoryId', label: 'التصنيف', type: 'select', value: '', options: w.availableCategories.map(function (c) { return [c.id, c.name]; }), placeholder: 'اختر التصنيف', required: true });
      fields.push({ name: 'amount', label: 'الميزانية الأسبوعية (ريال)', type: 'amount', value: d.amount ? Number(d.amount) : (general && Number(d.default) ? Number(d.default) : ''), required: true, hint: general ? 'الافتراضي = مجموع الميزانية الشهرية ÷ 4.' : '' });
      formModal({ title: general ? 'ميزانية «مصروف حر» الأسبوعية' : (isNew ? 'ميزانية أسبوعية لتصنيف' : 'ميزانية أسبوعية — ' + d.name), fields: fields,
        onSubmit: function (v) { return write('setWeeklyBudget', { categoryId: general ? null : Number(isNew ? v.categoryId : d.cat), amount: v.amount }); } });
    }).catch(oops);
  },
  delWeekly: function (d) { removeWithUndo('deleteWeeklyBudget', { categoryId: d.cat === '' ? null : Number(d.cat) }, d.cat === '' ? 'العودة للمبلغ الافتراضي (الشهرية ÷ 4)؟' : 'حذف الميزانية الأسبوعية لـ«' + esc(d.name) + '»؟'); },

  savOp: function (d) { savOpForm({ kind: d.kind, goalId: d.goal ? Number(d.goal) : null }); },
  editSavOp: function (d) { savOpForm({ id: Number(d.id), kind: d.kind, amount: Number(d.amount), date: d.date, goalId: d.goal ? Number(d.goal) : null, notes: d.notes }); },
  delSavOp: function (d) { removeWithUndo('deleteSavingsOp', { id: Number(d.id) }, 'حذف عملية الادخار هذه؟'); },
  editGoal: function (d) {
    formModal({ title: d.id ? 'تعديل الهدف' : 'هدف ادخار جديد',
      fields: [{ name: 'name', label: 'اسم الهدف', type: 'text', value: d.name || '', required: true, placeholder: 'مثال: طوارئ، سفر، سيارة', maxlength: 40 }, { name: 'target', label: 'القيمة المستهدفة (ريال)', type: 'amount', value: Number(d.target) || '', hint: 'بتحديدها تظهر نسبة التقدم وتاريخ الوصول المتوقع.' }],
      onSubmit: function (v) { return write('saveGoal', { id: d.id ? Number(d.id) : undefined, name: v.name, target: v.target || 0 }); } });
  },
  delGoal: function (d) { removeWithUndo('deleteGoal', { id: Number(d.id) }, 'حذف الهدف «' + esc(d.name) + '»؟', 'المبلغ المدخر يبقى في الادخار دون هدف. يمكنك التراجع.'); },

  exportCsv: function () { var rg = reportRange(); api('reportCsv', { from: rg.from, to: rg.to }).then(function (text) { return host('exportCsv', { text: text, name: 'mizani-report-' + rg.from + '_' + rg.to + '.csv' }); }).then(exported).catch(oops); },
  exportPdf: function () { var rg = reportRange(); api('report', { from: rg.from, to: rg.to }).then(function (r) { return host('exportPdf', { html: reportHtml(r, rg.label), name: 'mizani-report-' + rg.from + '_' + rg.to + '.pdf' }); }).then(exported).catch(oops); },

  theme: function (d) { api('setSetting', { key: 'theme', value: d.theme }).then(function () { return refresh(); }).catch(oops); },
  backupNow: function () { host('backupNow').then(function (r) { if (!r.canceled) toast('حُفظت النسخة الاحتياطية', { action: { label: 'إظهار الملف', fn: function () { host('showFile', { file: r.file }); } } }); }).catch(oops); },
  restore: function () {
    confirmDialog('الاستعادة تستبدل كل بياناتك الحالية ببيانات النسخة التي تختارها.', { danger: true, ok: 'اختيار ملف النسخة', title: 'استعادة نسخة احتياطية', note: 'تُحفظ نسخة أمان من بياناتك الحالية تلقائيًا قبل الاستبدال.' }).then(function (y) {
      if (y) host('restore').then(function (r) { if (!r.canceled) { toast('تمت الاستعادة. نسخة الأمان محفوظة في مجلد البيانات.'); return refresh(); } }).catch(oops);
    });
  },
  chooseBackupDir: function () { host('chooseBackupDir').then(function (r) { if (r.canceled) return; toast(r.backup && r.backup.ok ? 'فُعّل النسخ التلقائي وأُنشئت أول نسخة.' : 'حُفظ المجلد، لكن تعذر إنشاء النسخة: ' + esc((r.backup && r.backup.error) || ''), { type: r.backup && r.backup.ok ? '' : 'warn' }); return refresh(); }).catch(oops); },
  autoBackupNow: function () { host('autoBackupNow').then(function (r) { toast(r.ok ? 'أُنشئت نسخة تلقائية الآن.' : 'تعذر النسخ: ' + esc(r.error || ''), { type: r.ok ? '' : 'bad' }); return refresh(); }).catch(oops); },
  clearBackupDir: function () { host('clearBackupDir').then(function () { toast('أُوقف النسخ التلقائي. النسخ السابقة باقية في مجلدها.'); return refresh(); }).catch(oops); },
  openDataDir: function () { host('openDataDir').catch(oops); },
  syncOn: function () { toast('سيُفتح المتصفح لتسجيل الدخول…'); host('syncConnect').then(function (r) { toast(r.ok ? 'تم الربط والمزامنة' : 'تم الربط لكن تعذرت المزامنة', { type: r.ok ? '' : 'warn' }); return refresh(); }).catch(oops); },
  syncNow: function () { host('syncNow').then(function (r) { toast(r.ok ? 'تمت المزامنة' : 'تعذرت المزامنة: ' + esc(r.state.lastError || ''), { type: r.ok ? '' : 'warn' }); return refresh(); }).catch(oops); },
  syncOff: function () { host('syncDisconnect').then(function () { toast('فُصل الحساب'); return refresh(); }).catch(oops); }
};
ACT.delObligation = function (d) { removeWithUndo('deleteObligation', { id: Number(d.id) }, 'حذف الالتزام «' + esc(d.name) + '» وسجل سداده؟', 'حركات المصروف المسددة سابقًا تبقى في سجل الحركات. يمكنك التراجع عن الحذف.'); };
function exported(r) { if (r && !r.canceled) toast('تم التصدير', { action: { label: 'إظهار الملف', fn: function () { host('showFile', { file: r.file }); } } }); }

// ================= EVENTS =================
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  var fn = ACT[el.getAttribute('data-act')];
  if (!fn) return;
  if (popState && popState.el.contains(el) && el.getAttribute('data-act') !== 'pickMonth') closePop();
  try { fn(el.dataset, el); } catch (err) { oops(err); }
});
document.addEventListener('dblclick', function (e) {
  var tr = e.target.closest('tr[data-row-edit]');
  if (tr && !e.target.closest('button')) ACT[tr.getAttribute('data-row-edit')](tr.dataset, tr);
});
// filters (debounced text, immediate selects/dates)
var filterTimer = null;
function applyFilter(el) {
  var box = el.closest('[data-filter]'); if (!box) return;
  var key = box.getAttribute('data-filter'), f = el.getAttribute('data-f'), target = { tx: S.tx, debts: S.debts, dues: S.dues, sav: S.sav, report: S.report }[key];
  target[f] = el.value;
  if (key === 'tx' && (f === 'from' || f === 'to')) { if (!S.tx.from) S.tx.from = S.tx.all ? '' : D.monthStart(S.month); if (!S.tx.to) S.tx.to = S.tx.all ? '' : D.monthEnd(S.month); }
  if (key === 'report' && f === 'type' && el.value === 'custom' && !S.report.from) { S.report.from = D.monthStart(S.month); S.report.to = D.monthEnd(S.month); }
  var focusSel = '[data-filter="' + key + '"] [data-f="' + f + '"]', pos = el.selectionStart;
  refresh().then(function () { var n = $(focusSel); if (n && el.type === 'search') { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } });
}
document.addEventListener('input', function (e) {
  var el = e.target;
  if (!el.matches || !el.matches('[data-f]')) return;
  if (el.type === 'search') { clearTimeout(filterTimer); filterTimer = setTimeout(function () { applyFilter(el); }, 220); }
});
document.addEventListener('change', function (e) {
  var el = e.target;
  if (el.matches && el.matches('[data-f]') && el.type !== 'search') applyFilter(el);
  if (el.matches && el.matches('[data-setting]')) {
    api('setSetting', { key: el.getAttribute('data-setting'), value: el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value }).then(function () { return refresh(); }).catch(oops);
  }
});
document.addEventListener('keydown', function (e) {
  var inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName), modal = modalStack.length > 0, ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (popState) { closePop(); e.preventDefault(); return; } if (closeTopModal()) { e.preventDefault(); return; } if (inField && e.target.id === 'q') { e.target.value = ''; e.target.blur(); } return; }
  if (ctrl && !e.altKey) {
    var k = e.key.toLowerCase();
    if ((k === 'n' || k === 'ى') && !modal) { e.preventDefault(); ACT.addTx(); return; }
    if ((k === 'f' || k === 'k' || k === 'ب' || k === 'ن') && !modal) { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
    if ((k === 'z' || k === 'ئ') && !inField && !modal) { e.preventDefault(); doUndo(); return; }
    if (/^[1-8]$/.test(e.key) && !modal) { e.preventDefault(); go(PAGES[Number(e.key) - 1].id); return; }
  }
  if (e.altKey && !ctrl && !modal && pageDef().month && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); ACT.month({ step: e.key === 'ArrowRight' ? -1 : 1 }); return; }
  var tr = e.target.tagName === 'TR' ? e.target : null;
  if (tr && !modal) {
    if (e.key === 'Enter' && tr.getAttribute('data-row-edit')) { e.preventDefault(); ACT[tr.getAttribute('data-row-edit')](tr.dataset, tr); }
    else if (e.key === 'Delete' && tr.getAttribute('data-row-del')) { e.preventDefault(); ACT[tr.getAttribute('data-row-del')](tr.dataset, tr); }
    else if (e.key === 'ArrowDown' && tr.nextElementSibling) { e.preventDefault(); tr.nextElementSibling.focus(); }
    else if (e.key === 'ArrowUp' && tr.previousElementSibling) { e.preventDefault(); tr.previousElementSibling.focus(); }
  }
  if (popState && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && popState.el.contains(e.target)) {
    e.preventDefault();
    var items = $$('.item', popState.el), i = items.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1);
    if (i < 0) $('#q').focus(); else if (items[i]) items[i].focus();
  }
});

// ---------- boot ----------
buildTop();
renderNav();
api('info').then(function (i) { $('#ver').textContent = 'MIZANI / ' + i.appVersion; });
refresh(true);
// keep "today" fresh if the app stays open past midnight
setInterval(function () { if (D.localToday() !== S.today && !modalStack.length) refresh(); }, 60000);
window.__mz = { S: S, go: go, refresh: refresh, ACT: ACT };
