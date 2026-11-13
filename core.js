/* Mizani core — data + business logic.
 * Isomorphic: runs in Electron's main process (Node) and in a browser page (tests/preview).
 * Money is ALWAYS an integer number of halalas (1 SAR = 100 halalas). No floats are stored.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MizaniCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 2;
  var APP_VERSION = '2.1.0';

  // ---------- pure helpers ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return ymd(parseDate(s)) === s;
  }
  function isMonth(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }
  function addDays(s, n) { var d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function monthOf(s) { return s.slice(0, 7); }
  function addMonths(m, n) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + n;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + pad(mo + 1);
  }
  function daysInMonth(m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); }
  function monthStart(m) { return m + '-01'; }
  function monthEnd(m) { return m + '-' + pad(daysInMonth(m)); }
  function monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
  function weekStartOf(date, ws) { // ws: 0=Sunday .. 6=Saturday
    var dow = parseDate(date).getUTCDay();
    return addDays(date, -((dow - ws + 7) % 7));
  }
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٫': '.', '٬': ',' };
  function toLatinDigits(s) {
    return String(s == null ? '' : s).replace(/[٠-٩۰-۹٫٬]/g, function (c) { return AR_DIGITS[c]; });
  }
  /** Parses user text ("1,000.50", "١٠٠٠٫٥") into halalas using string math only. Returns null if invalid. */
  function parseAmount(text) {
    var s = toLatinDigits(text).replace(/[,\s]/g, '').replace(/ريال|ر\.س|SAR/gi, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split('.');
    var frac = ((parts[1] || '') + '00').slice(0, 2);
    var v = parseInt(parts[0], 10) * 100 + parseInt(frac, 10);
    return Number.isSafeInteger(v) ? v : null;
  }
  /** Formats halalas as "1,234.56" (English digits). */
  function fmt(h) {
    h = Math.round(h || 0);
    var neg = h < 0; if (neg) h = -h;
    var whole = Math.floor(h / 100), frac = h % 100;
    var w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + w + '.' + pad(frac);
  }
  function pct(part, total) { return total > 0 ? Math.round((part * 100) / total) : (part > 0 ? 999 : 0); }
  function statusOf(spent, budget) {
    if (budget <= 0) return spent > 0 ? 'over' : 'ok';
    if (spent > budget) return 'over';
    if (spent * 100 >= budget * 80) return 'near';
    return 'ok';
  }
  function fail(msg) { var e = new Error(msg); e.userError = true; throw e; }

  // ---------- core factory ----------
  function createCore(SQL, bytes, opts) {
    opts = opts || {};
    var today = opts.today || localToday;
    var db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    var dirty = false;
    var undoEntry = null;

    function run(sql, params) { db.run(sql, params || []); }
    function all(sql, params) {
      var st = db.prepare(sql), out = [];
      try { st.bind(params || []); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
      return out;
    }
    function get(sql, params) { var r = all(sql, params); return r.length ? r[0] : null; }
    function val(sql, params) { var r = get(sql, params); if (!r) return null; for (var k in r) return r[k]; }
    function num(sql, params) { return Number(val(sql, params) || 0); }
    function lastId() { return Number(val('SELECT last_insert_rowid()')); }
    function insert(table, row) {
      var keys = Object.keys(row);
      run('INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + keys.map(function () { return '?'; }).join(',') + ')',
        keys.map(function (k) { return row[k] === undefined ? null : row[k]; }));
      return lastId();
    }


    var freshDb = false;
    var SYNC_TABLES = ['categories', 'savings_goals', 'transactions', 'debts', 'debt_payments', 'obligations', 'obligation_payments', 'budgets', 'weekly_budgets', 'templates', 'savings_ops'];
    var SYNC_SETTINGS = ['week_start', 'weekly_rollover', 'weekly_deficit', 'rollover_since', 'budget_mode'];
    function uidExpr(t, p) {
      if (t === 'categories') return "'c:' || " + p + "kind || ':' || " + p + "name";
      if (t === 'budgets') return "'b:' || " + p + "month || ':' || (SELECT uid FROM categories WHERE id = " + p + "category_id)";
      if (t === 'weekly_budgets') return "'w:' || COALESCE((SELECT uid FROM categories WHERE id = " + p + "category_id), 'general')";
      if (t === 'obligation_payments') return "'op:' || (SELECT uid FROM obligations WHERE id = " + p + "obligation_id) || ':' || " + p + "month";
      return "lower(hex(randomblob(10)))";
    }

    // ---------- migrations (never drop user data) ----------
    var MIGRATIONS = [
      function v1() {
        run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
        run('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(name, kind))');
        run('CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, category_id INTEGER, description TEXT NOT NULL DEFAULT \'\', notes TEXT NOT NULL DEFAULT \'\', linked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)');
        run('CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date)');
        run('CREATE TABLE IF NOT EXISTS savings_goals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)');
        run('CREATE TABLE IF NOT EXISTS savings_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, goal_id INTEGER, notes TEXT NOT NULL DEFAULT \'\')');
        run('CREATE TABLE IF NOT EXISTS debts (id INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT NOT NULL, kind TEXT NOT NULL, principal INTEGER NOT NULL, installment INTEGER NOT NULL DEFAULT 0, first_due TEXT, notes TEXT NOT NULL DEFAULT \'\', tx_id INTEGER, created_at TEXT NOT NULL)');
        run('CREATE TABLE IF NOT EXISTS debt_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, debt_id INTEGER NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT \'\', tx_id INTEGER)');
        run('CREATE TABLE IF NOT EXISTS obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount INTEGER NOT NULL, due_day INTEGER NOT NULL, category_id INTEGER, start_month TEXT NOT NULL, end_month TEXT)');
        run('CREATE TABLE IF NOT EXISTS obligation_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, obligation_id INTEGER NOT NULL, month TEXT NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL, tx_id INTEGER, UNIQUE(obligation_id, month))');
        run('CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, category_id INTEGER NOT NULL, amount INTEGER NOT NULL, UNIQUE(month, category_id))');
        run('CREATE TABLE IF NOT EXISTS weekly_budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, amount INTEGER NOT NULL)');
        run('CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_cat ON weekly_budgets(IFNULL(category_id, 0))');
        run('CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, category_id INTEGER, description TEXT NOT NULL DEFAULT \'\')');
        run('CREATE TABLE IF NOT EXISTS alert_log (key TEXT PRIMARY KEY, created_at TEXT NOT NULL)');
        var exp = ['طعام', 'مواصلات', 'مشتريات', 'منزل', 'فواتير', 'صحة', 'ترفيه', 'أخرى'];
        var inc = ['راتب', 'دخل إضافي'];
        exp.forEach(function (n) { run('INSERT OR IGNORE INTO categories (name, kind) VALUES (?, \'expense\')', [n]); });
        inc.forEach(function (n) { run('INSERT OR IGNORE INTO categories (name, kind) VALUES (?, \'income\')', [n]); });
        var defaults = { theme: 'dark', week_start: '6', weekly_rollover: '0', budget_mode: 'month', backup_dir: '', last_auto_backup: '' };
        Object.keys(defaults).forEach(function (k) { run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, defaults[k]]); });

      },
      function v2() {
        // Sync metadata: stable uid + updated_at per row, tombstones for deletes. Triggers keep it
        // up to date without touching business logic. Existing data is preserved.
        var fresh = !!freshDb;
        var NOW = 'CAST((julianday(\'now\') - 2440587.5) * 86400000 AS INTEGER)';
        run('CREATE TABLE IF NOT EXISTS sync_ctl (applying INTEGER NOT NULL)');
        run('INSERT INTO sync_ctl (applying) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM sync_ctl)');
        run('CREATE TABLE IF NOT EXISTS sync_tombstones (tbl TEXT NOT NULL, uid TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (tbl, uid))');
        var GUARD = ' WHEN (SELECT applying FROM sync_ctl) = 0';
        SYNC_TABLES.forEach(function (t) {
          run('ALTER TABLE ' + t + ' ADD COLUMN uid TEXT');
          run('ALTER TABLE ' + t + ' ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
          run('UPDATE ' + t + ' SET uid = ' + uidExpr(t, t + '.') + ' WHERE uid IS NULL');
          run('UPDATE ' + t + ' SET updated_at = ' + (fresh ? '0' : NOW));
          run('CREATE UNIQUE INDEX IF NOT EXISTS ux_' + t + '_uid ON ' + t + '(uid)');
          run('CREATE TRIGGER trg_' + t + '_sync_ai AFTER INSERT ON ' + t + GUARD +
            ' BEGIN UPDATE ' + t + ' SET uid = COALESCE(uid, ' + uidExpr(t, 'NEW.') + '), updated_at = ' + NOW + ' WHERE id = NEW.id; END');
          run('CREATE TRIGGER trg_' + t + '_sync_au AFTER UPDATE ON ' + t + GUARD + ' AND NEW.updated_at IS OLD.updated_at' +
            ' BEGIN UPDATE ' + t + ' SET updated_at = ' + NOW + ' WHERE id = NEW.id; END');
          run('CREATE TRIGGER trg_' + t + '_sync_ad AFTER DELETE ON ' + t + GUARD + ' AND OLD.uid IS NOT NULL' +
            ' BEGIN INSERT OR REPLACE INTO sync_tombstones (tbl, uid, ts) VALUES (\'' + t + '\', OLD.uid, ' + NOW + '); END');
        });
        // settings: track last change time (defaults/unchanged = 0 so they never override another device)
        run('ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
        var defs = { week_start: '6', weekly_rollover: '0', budget_mode: 'month' };
        if (!fresh) all('SELECT key, value FROM settings').forEach(function (r) {
          if (SYNC_SETTINGS.indexOf(r.key) >= 0 && (defs[r.key] === undefined || defs[r.key] !== r.value)) run('UPDATE settings SET updated_at = ' + NOW + ' WHERE key = ?', [r.key]);
        });
        run('CREATE TRIGGER trg_settings_sync_ai AFTER INSERT ON settings' + GUARD + ' BEGIN UPDATE settings SET updated_at = ' + NOW + ' WHERE key = NEW.key; END');
        run('CREATE TRIGGER trg_settings_sync_au AFTER UPDATE ON settings' + GUARD + ' AND NEW.updated_at IS OLD.updated_at AND NEW.value IS NOT OLD.value BEGIN UPDATE settings SET updated_at = ' + NOW + ' WHERE key = NEW.key; END');
      }
    ];
    function migrate() {
      var v = num('PRAGMA user_version');
      freshDb = (v === 0);
      if (v > SCHEMA_VERSION) fail('ملف البيانات أُنشئ بإصدار أحدث من ميزاني. حدّث التطبيق أولًا.');
      var applied = [];
      for (var i = v; i < MIGRATIONS.length; i++) {
        run('BEGIN');
        try { MIGRATIONS[i](); run('PRAGMA user_version = ' + (i + 1)); run('COMMIT'); }
        catch (e) { try { run('ROLLBACK'); } catch (e2) { /* ignore */ } throw e; }
        applied.push(i + 1); dirty = true;
      }
      return { from: v, to: num('PRAGMA user_version'), applied: applied };
    }
    var migration = migrate();

    // ---------- settings ----------
    function setting(k, d) { var v = val('SELECT value FROM settings WHERE key = ?', [k]); return v == null ? d : v; }
    function setSetting(k, v) { run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]); }
    function weekStartDay() { var w = parseInt(setting('week_start', '6'), 10); return w >= 0 && w <= 6 ? w : 6; }

    // ---------- validation ----------
    function needAmount(a, label) {
      if (!Number.isSafeInteger(a) || a <= 0) fail((label || 'المبلغ') + ' يجب أن يكون أكبر من صفر.');
      return a;
    }
    function needDate(d, label) { if (!isDate(d)) fail((label || 'التاريخ') + ' غير صحيح. الصيغة: YYYY-MM-DD'); return d; }
    function needMonth(m) { if (!isMonth(m)) fail('الشهر غير صحيح.'); return m; }
    function needText(t, label) { t = String(t == null ? '' : t).trim(); if (!t) fail(label + ' مطلوب.'); return t; }
    function clean(t) { return String(t == null ? '' : t).trim(); }
    function ensureCategory(name, kind) {
      var id = val('SELECT id FROM categories WHERE name = ? AND kind = ?', [name, kind]);
      if (id != null) { run('UPDATE categories SET archived = 0 WHERE id = ?', [id]); return Number(id); }
      return insert('categories', { name: name, kind: kind });
    }
    function categoryOfKind(id, kind) {
      if (id == null || id === '') return null;
      var c = get('SELECT id, kind FROM categories WHERE id = ?', [id]);
      if (!c) fail('التصنيف غير موجود.');
      if (kind && c.kind !== kind) fail('التصنيف لا يناسب نوع الحركة.');
      return Number(c.id);
    }

    // ---------- money aggregates ----------
    function sumTx(type, from, to, extra, params) {
      return num('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = ? AND date >= ? AND date <= ?' + (extra || ''),
        [type, from, to].concat(params || []));
    }
    function savingsBalance(upTo, goalId) {
      var w = ' WHERE date <= ?', p = [upTo || '9999-12-31'];
      if (goalId !== undefined) { w += goalId == null ? ' AND goal_id IS NULL' : ' AND goal_id = ?'; if (goalId != null) p.push(goalId); }
      return num('SELECT COALESCE(SUM(CASE kind WHEN \'deposit\' THEN amount ELSE -amount END), 0) FROM savings_ops' + w, p);
    }
    function cashBalance(upTo) {
      return sumTx('income', '0000-01-01', upTo) - sumTx('expense', '0000-01-01', upTo) - savingsBalance(upTo);
    }

    // ---------- undo (last delete) ----------
    function setUndo(label, rows) { undoEntry = { label: label, rows: rows }; }
    function snapshot(table, where, params) {
      return all('SELECT * FROM ' + table + ' WHERE ' + where, params).map(function (r) { return { table: table, row: r }; });
    }

    // ---------- alerts ----------
    function activeAlerts(date) {
      var out = [], m = monthOf(date);
      monthBudgetRows(m).rows.forEach(function (r) {
        var lvl = r.spent >= r.budget ? 100 : (r.spent * 100 >= r.budget * 80 ? 80 : 0);
        if (lvl) out.push({ key: 'm:' + m + ':c' + r.categoryId + ':' + lvl, level: lvl, scope: 'month', period: m, name: r.name, spent: r.spent, budget: r.budget, pct: r.pct });
      });
      var w = weekData(date);
      w.items.forEach(function (r) {
        if (r.budget <= 0) return;
        var lvl = r.spent >= r.total ? 100 : (r.spent * 100 >= r.total * 80 ? 80 : 0);
        if (lvl) out.push({ key: 'w:' + w.start + ':' + (r.categoryId == null ? 'g' : 'c' + r.categoryId) + ':' + lvl, level: lvl, scope: 'week', period: w.start, name: r.name, spent: r.spent, budget: r.total, pct: r.pct });
      });
      return out;
    }
    /** Returns alerts that crossed a threshold and were not announced before, and records them. */
    function newAlerts(date) {
      var fresh = [];
      activeAlerts(date).forEach(function (a) {
        if (val('SELECT 1 FROM alert_log WHERE key = ?', [a.key]) == null) {
          run('INSERT INTO alert_log (key, created_at) VALUES (?, ?)', [a.key, today()]);
          // when 100% fires, the 80% one for the same budget is implied
          if (a.level === 100) run('INSERT OR IGNORE INTO alert_log (key, created_at) VALUES (?, ?)', [a.key.replace(/:100$/, ':80'), today()]);
          fresh.push(a);
        }
      });
      return fresh;
    }

    // ---------- budgets (monthly) ----------
    function spentByCategory(from, to) {
      var map = {};
      all('SELECT category_id AS c, SUM(amount) AS s FROM transactions WHERE type = \'expense\' AND date >= ? AND date <= ? GROUP BY category_id', [from, to])
        .forEach(function (r) { map[r.c == null ? 0 : r.c] = Number(r.s); });
      return map;
    }
    function monthBudgetRows(m) {
      var spent = spentByCategory(monthStart(m), monthEnd(m));
      var rows = all('SELECT b.id, b.category_id AS categoryId, b.amount AS budget, c.name FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.month = ? ORDER BY c.name', [m])
        .map(function (r) {
          var s = spent[r.categoryId] || 0;
          return { id: r.id, categoryId: r.categoryId, name: r.name, budget: Number(r.budget), spent: s, remaining: Number(r.budget) - s, pct: pct(s, Number(r.budget)), status: statusOf(s, Number(r.budget)) };
        });
      var planned = 0, plannedSpent = 0;
      rows.forEach(function (r) { planned += r.budget; plannedSpent += r.spent; });
      return { rows: rows, planned: planned, plannedSpent: plannedSpent, spent: spent };
    }
    function suggestionFor(categoryId, m) {
      // average of the previous 3 full months; rounded up to the nearest 10 SAR
      var from = monthStart(addMonths(m, -3)), to = monthEnd(addMonths(m, -1));
      var total = num('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = \'expense\' AND category_id = ? AND date >= ? AND date <= ?', [categoryId, from, to]);
      var months = num('SELECT COUNT(DISTINCT substr(date, 1, 7)) FROM transactions WHERE type = \'expense\' AND date >= ? AND date <= ?', [from, to]);
      var basis = 'avg3';
      var avg = months > 0 ? Math.ceil(total / months) : 0;
      if (avg <= 0) { // no history yet: fall back to this month's spending so far
        avg = num('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = \'expense\' AND category_id = ? AND date >= ? AND date <= ?', [categoryId, monthStart(m), monthEnd(m)]);
        basis = 'current';
      }
      return { amount: Math.ceil(avg / 1000) * 1000, basis: basis, months: months };
    }
    function unbudgeted(m) {
      var have = {};
      all('SELECT category_id FROM budgets WHERE month = ?', [m]).forEach(function (r) { have[r.category_id] = 1; });
      var from3 = monthStart(addMonths(m, -3));
      return all('SELECT c.id, c.name, COALESCE(SUM(CASE WHEN t.date >= ? THEN t.amount ELSE 0 END), 0) AS spent FROM categories c JOIN transactions t ON t.category_id = c.id AND t.type = \'expense\' AND t.date >= ? AND t.date <= ? WHERE c.kind = \'expense\' GROUP BY c.id ORDER BY spent DESC',
        [monthStart(m), from3, monthEnd(m)])
        .filter(function (r) { return !have[r.id]; })
        .map(function (r) { var s = suggestionFor(r.id, m); return { categoryId: r.id, name: r.name, spent: Number(r.spent), suggested: s.amount, basis: s.basis }; })
        .filter(function (r) { return r.spent > 0 || r.suggested > 0; });
    }

    // ---------- budgets (weekly) ----------
    function weekData(date) {
      var ws = weekStartDay(), start = weekStartOf(date, ws), end = addDays(start, 6);
      var rollover = setting('weekly_rollover', '0') === '1';
      var deficit = rollover && setting('weekly_deficit', '0') === '1';
      var defs = all('SELECT w.id, w.category_id AS categoryId, w.amount, c.name FROM weekly_budgets w LEFT JOIN categories c ON c.id = w.category_id');
      var catIds = defs.filter(function (d) { return d.categoryId != null; }).map(function (d) { return Number(d.categoryId); });
      var generalDef = defs.filter(function (d) { return d.categoryId == null; })[0];

      function generalBudget(weekStartDate) {
        if (generalDef) return { amount: Number(generalDef.amount), isDefault: false };
        var planned = num('SELECT COALESCE(SUM(amount), 0) FROM budgets WHERE month = ?', [monthOf(weekStartDate)]);
        return { amount: Math.floor(planned / 4), isDefault: true };
      }
      function spentIn(s, e, categoryId) {
        if (categoryId != null) return num('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = \'expense\' AND category_id = ? AND date >= ? AND date <= ?', [categoryId, s, e]);
        // "free spending": every non-linked expense outside the categories that have their own weekly budget
        var sql = 'SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = \'expense\' AND linked = 0 AND date >= ? AND date <= ?';
        if (catIds.length) sql += ' AND (category_id IS NULL OR category_id NOT IN (' + catIds.join(',') + '))';
        return num(sql, [s, e]);
      }
      // Carry-over. Without deficit carry: last week's unspent amount only.
      // With deficit carry: a running balance since the option was switched on, so overspending
      // one week reduces the next ones until it is made up (and underspending adds to them).
      function carryFor(categoryId, budget) {
        if (!rollover || budget <= 0) return 0;
        var since = setting('rollover_since', '');
        if (!isDate(since)) return 0;
        var first = weekStartOf(since, ws);
        if (!deficit) {
          var ps = addDays(start, -7);
          if (ps < first) return 0;
          var pb = categoryId == null ? generalBudget(ps).amount : budget;
          return Math.max(0, pb - spentIn(ps, addDays(start, -1), categoryId));
        }
        var from = first, limit = addDays(start, -7 * 26); // look back half a year at most
        if (from < limit) from = limit;
        var bal = 0;
        for (var w = from; w < start; w = addDays(w, 7)) {
          var b = categoryId == null ? generalBudget(w).amount : budget;
          bal = b + bal - spentIn(w, addDays(w, 6), categoryId);
        }
        return bal;
      }
      function build(categoryId, name, budget, isDefault) {
        var spent = spentIn(start, end, categoryId), carry = carryFor(categoryId, budget);
        var raw = budget + carry, total = Math.max(0, raw);
        return { categoryId: categoryId, name: name, budget: budget, carry: carry, total: total, spent: spent, remaining: raw - spent, pct: pct(spent, total), status: statusOf(spent, total), isDefault: !!isDefault };
      }
      var g = generalBudget(start);
      var items = [build(null, 'مصروف حر', g.amount, g.isDefault)];
      defs.filter(function (d) { return d.categoryId != null; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ar'); })
        .forEach(function (d) { items.push(build(Number(d.categoryId), d.name, Number(d.amount), false)); });
      var daysLeft = date > end ? 0 : (date < start ? 7 : diffDays(date, end) + 1);
      var general = items[0];
      return {
        start: start, end: end, daysLeft: daysLeft, rollover: rollover, deficit: deficit, weekStart: ws, items: items,
        dailyAllowance: daysLeft > 0 ? Math.max(0, Math.floor(general.remaining / daysLeft)) : 0,
        isCurrent: date >= start && date <= end
      };
    }

    // ---------- obligations ----------
    function obligationDues(upToMonth) {
      var out = [];
      var paid = {};
      all('SELECT * FROM obligation_payments').forEach(function (p) { paid[p.obligation_id + ':' + p.month] = p; });
      all('SELECT o.*, c.name AS category FROM obligations o LEFT JOIN categories c ON c.id = o.category_id ORDER BY o.due_day, o.name').forEach(function (o) {
        var last = o.end_month && o.end_month < upToMonth ? o.end_month : upToMonth;
        for (var m = o.start_month; m <= last; m = addMonths(m, 1)) {
          var p = paid[o.id + ':' + m];
          var day = Math.min(Number(o.due_day), daysInMonth(m));
          out.push({ obligationId: o.id, name: o.name, month: m, dueDate: m + '-' + pad(day), amount: p ? Number(p.amount) : Number(o.amount), paid: !!p, paidDate: p ? p.date : null, category: o.category });
        }
      });
      return out;
    }
    function debtRows() {
      return all('SELECT d.*, COALESCE((SELECT SUM(amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid FROM debts d ORDER BY d.created_at DESC, d.id DESC')
        .map(function (d) {
          return { id: d.id, party: d.party, kind: d.kind, principal: Number(d.principal), installment: Number(d.installment), firstDue: d.first_due, notes: d.notes, paid: Number(d.paid), remaining: Math.max(0, Number(d.principal) - Number(d.paid)) };
        });
    }
    /** Installments of my own debts that should have been paid by the end of `m` and are not yet. */
    function debtDueThrough(m) {
      var total = 0;
      debtRows().forEach(function (d) {
        if (d.kind !== 'on_me' || d.remaining <= 0 || !d.firstDue || d.installment <= 0) return;
        var fm = monthOf(d.firstDue);
        if (fm > m) return;
        var expected = Math.min(d.principal, d.installment * (monthsBetween(fm, m) + 1));
        total += Math.max(0, expected - d.paid);
      });
      return total;
    }
    function reservedThrough(m) {
      var obl = 0;
      obligationDues(m).forEach(function (d) { if (!d.paid) obl += d.amount; });
      return obl + debtDueThrough(m);
    }

    // ---------- forecast ----------
    function forecast(date) {
      var m = monthOf(date), day = +date.slice(8, 10), dim = daysInMonth(m);
      var discretionary = num('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = \'expense\' AND linked = 0 AND date >= ? AND date <= ?', [monthStart(m), date]);
      var avgDaily = Math.round(discretionary / day);
      var daysLeft = dim - day;
      var available = cashBalance(date) - reservedThrough(m);
      var projectedSpend = avgDaily * daysLeft;
      var projectedEnd = available - projectedSpend;
      var depletionDate = null, daysOfCover = null;
      if (avgDaily > 0 && available > 0) { daysOfCover = Math.floor(available / avgDaily); depletionDate = addDays(date, daysOfCover); }
      return {
        avgDaily: avgDaily, daysLeft: daysLeft, available: available, projectedSpend: projectedSpend, projectedEnd: projectedEnd,
        depletionDate: depletionDate, daysOfCover: daysOfCover, monthEnd: monthEnd(m),
        enough: available <= 0 ? false : projectedEnd >= 0, hasData: discretionary > 0
      };
    }

    // ---------- savings ----------
    function savingsSummary() {
      var t = today();
      var from90 = addDays(t, -90);
      function rate(goalId) {
        var w = goalId == null ? '' : ' AND goal_id = ' + Number(goalId);
        var net = num('SELECT COALESCE(SUM(CASE kind WHEN \'deposit\' THEN amount ELSE -amount END), 0) FROM savings_ops WHERE date > ? AND date <= ?' + w, [from90, t]);
        var first = val('SELECT MIN(date) FROM savings_ops WHERE 1 = 1' + w);
        if (!first) return 0;
        var span = Math.min(90, Math.max(30, diffDays(first, t) + 1));
        return Math.max(0, Math.round(net * 30 / span)); // halalas per 30 days
      }
      var goals = all('SELECT * FROM savings_goals ORDER BY id').map(function (g) {
        var bal = savingsBalance(null, g.id), target = Number(g.target), r = rate(g.id);
        var remaining = Math.max(0, target - bal), eta = null;
        if (target > 0 && remaining > 0 && r > 0) eta = addDays(t, Math.ceil(remaining * 30 / r));
        return { id: g.id, name: g.name, target: target, balance: bal, pct: target > 0 ? Math.min(100, pct(bal, target)) : 0, remaining: remaining, monthlyRate: r, eta: eta, reached: target > 0 && bal >= target };
      });
      return { total: savingsBalance(), unassigned: savingsBalance(null, null), goals: goals };
    }


    // ---------- sync (snapshot merge, last-writer-wins per row) ----------
    var SYNC_SPEC = {
      categories:          { cols: ['name', 'kind', 'archived'], refs: {}, nat: ['name', 'kind'] },
      savings_goals:       { cols: ['name', 'target', 'created_at'], refs: {} },
      transactions:        { cols: ['date', 'type', 'amount', 'description', 'notes', 'linked', 'created_at'], refs: { category_id: 'categories' } },
      debts:               { cols: ['party', 'kind', 'principal', 'installment', 'first_due', 'notes', 'created_at'], refs: { tx_id: 'transactions' } },
      debt_payments:       { cols: ['date', 'amount', 'notes'], refs: { debt_id: 'debts', tx_id: 'transactions' } },
      obligations:         { cols: ['name', 'amount', 'due_day', 'start_month', 'end_month'], refs: { category_id: 'categories' } },
      obligation_payments: { cols: ['month', 'date', 'amount'], refs: { obligation_id: 'obligations', tx_id: 'transactions' }, nat: ['obligation_id', 'month'] },
      budgets:             { cols: ['month', 'amount'], refs: { category_id: 'categories' }, nat: ['category_id', 'month'] },
      weekly_budgets:      { cols: ['amount'], refs: { category_id: 'categories' }, nat: ['category_id'] },
      templates:           { cols: ['name', 'type', 'amount', 'description'], refs: { category_id: 'categories' } },
      savings_ops:         { cols: ['date', 'kind', 'amount', 'notes'], refs: { goal_id: 'savings_goals' } }
    };
    function nowMs() { return Date.now(); }
    function deviceId() {
      var d = setting('device_id', '');
      if (!d) { d = 'dev-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); setSetting('device_id', d); }
      return d;
    }
    function uidOf(table, id) { return id == null ? null : (val('SELECT uid FROM ' + table + ' WHERE id = ?', [id]) || null); }
    function idOf(table, uid) { return uid == null ? null : (val('SELECT id FROM ' + table + ' WHERE uid = ?', [uid])); }
    function syncExport() {
      var snap = { v: 1, schema: SCHEMA_VERSION, device: deviceId(), ts: nowMs(), tables: {}, tombstones: [], settings: [] };
      SYNC_TABLES.forEach(function (t) {
        var spec = SYNC_SPEC[t];
        snap.tables[t] = all('SELECT * FROM ' + t).map(function (row) {
          var o = { uid: row.uid, updated_at: row.updated_at };
          spec.cols.forEach(function (c) { o[c] = row[c]; });
          Object.keys(spec.refs).forEach(function (rc) { o[rc + '_uid'] = uidOf(spec.refs[rc], row[rc]); });
          return o;
        });
      });
      snap.tombstones = all('SELECT tbl, uid, ts FROM sync_tombstones');
      SYNC_SETTINGS.forEach(function (k) {
        var r = get('SELECT key, value, updated_at FROM settings WHERE key = ?', [k]);
        if (r) snap.settings.push({ key: r.key, value: r.value, updated_at: r.updated_at });
      });
      return snap;
    }
    function syncImport(snaps) {
      var changed = 0;
      run('UPDATE sync_ctl SET applying = 1');
      try {
        snaps.forEach(function (snap) {
          if (!snap || snap.v !== 1 || !snap.tables) return;
          if (snap.schema > SCHEMA_VERSION) return; // newer app: wait for update
          // tombstones first
          (snap.tombstones || []).forEach(function (tb) {
            if (!SYNC_SPEC[tb.tbl]) return;
            var local = get('SELECT id, updated_at FROM ' + tb.tbl + ' WHERE uid = ?', [tb.uid]);
            if (local && tb.ts > local.updated_at) { run('DELETE FROM ' + tb.tbl + ' WHERE id = ?', [local.id]); changed++; }
            var cur = val('SELECT ts FROM sync_tombstones WHERE tbl = ? AND uid = ?', [tb.tbl, tb.uid]);
            if (cur == null || tb.ts > cur) run('INSERT OR REPLACE INTO sync_tombstones (tbl, uid, ts) VALUES (?, ?, ?)', [tb.tbl, tb.uid, tb.ts]);
          });
          SYNC_TABLES.forEach(function (t) {
            var spec = SYNC_SPEC[t];
            (snap.tables[t] || []).forEach(function (r) {
              if (!r || !r.uid) return;
              var vals = {};
              spec.cols.forEach(function (c) { vals[c] = r[c] === undefined ? null : r[c]; });
              var refMissing = false;
              Object.keys(spec.refs).forEach(function (rc) {
                var u = r[rc + '_uid'];
                var id = u == null ? null : idOf(spec.refs[rc], u);
                if (u != null && id == null) { if (rc === 'tx_id' || rc === 'category_id') id = null; else refMissing = true; }
                vals[rc] = id;
              });
              if (refMissing) return; // parent not here (deleted); skip orphan
              var keys = Object.keys(vals);
              var local = get('SELECT id, updated_at FROM ' + t + ' WHERE uid = ?', [r.uid]);
              if (local) {
                if (r.updated_at > local.updated_at) {
                  run('UPDATE ' + t + ' SET ' + keys.map(function (k) { return k + ' = ?'; }).join(', ') + ', updated_at = ? WHERE id = ?',
                    keys.map(function (k) { return vals[k]; }).concat([r.updated_at, local.id]));
                  changed++;
                }
                return;
              }
              var tomb = val('SELECT ts FROM sync_tombstones WHERE tbl = ? AND uid = ?', [t, r.uid]);
              if (tomb != null && tomb > r.updated_at) return;
              if (spec.nat) { // same natural key created independently on two devices: adopt remote identity
                var w = spec.nat.map(function (k) { return k + ' IS ?'; }).join(' AND ');
                var ex = get('SELECT id, updated_at FROM ' + t + ' WHERE ' + w, spec.nat.map(function (k) { return vals[k]; }));
                if (ex) {
                  run('UPDATE ' + t + ' SET uid = ?' + (r.updated_at > ex.updated_at ? ', ' + keys.map(function (k) { return k + ' = ?'; }).join(', ') + ', updated_at = ?' : '') + ' WHERE id = ?',
                    [r.uid].concat(r.updated_at > ex.updated_at ? keys.map(function (k) { return vals[k]; }).concat([r.updated_at]) : []).concat([ex.id]));
                  changed++; return;
                }
              }
              run('INSERT INTO ' + t + ' (' + keys.concat(['uid', 'updated_at']).join(',') + ') VALUES (' + keys.concat(['uid', 'updated_at']).map(function () { return '?'; }).join(',') + ')',
                keys.map(function (k) { return vals[k]; }).concat([r.uid, r.updated_at]));
              run('DELETE FROM sync_tombstones WHERE tbl = ? AND uid = ?', [t, r.uid]);
              changed++;
            });
          });
          (snap.settings || []).forEach(function (st) {
            if (SYNC_SETTINGS.indexOf(st.key) < 0) return;
            var cur = get('SELECT value, updated_at FROM settings WHERE key = ?', [st.key]);
            if (!cur || st.updated_at > cur.updated_at) {
              run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [st.key, String(st.value), st.updated_at]);
              changed++;
            }
          });
        });
        // orphans left by remote deletes
        run('DELETE FROM debt_payments WHERE debt_id NOT IN (SELECT id FROM debts)');
        run('DELETE FROM obligation_payments WHERE obligation_id NOT IN (SELECT id FROM obligations)');
        // forget very old tombstones
        run('DELETE FROM sync_tombstones WHERE ts < ?', [nowMs() - 120 * 86400000]);
      } finally { run('UPDATE sync_ctl SET applying = 0'); }
      return { changed: changed };
    }

    // ---------- API ----------
    var api = {
      syncExport: function () { return syncExport(); },
      syncImport: function (a) { return syncImport(a.snapshots || []); },
      syncDeviceId: function () { return deviceId(); },
      info: function () {
        return { appVersion: APP_VERSION, schemaVersion: num('PRAGMA user_version'), migration: migration, today: today(),
          counts: { transactions: num('SELECT COUNT(*) FROM transactions'), debts: num('SELECT COUNT(*) FROM debts'), obligations: num('SELECT COUNT(*) FROM obligations') } };
      },
      getSettings: function () { var o = {}; all('SELECT key, value FROM settings').forEach(function (r) { o[r.key] = r.value; }); return o; },
      setSetting: function (a) {
        var allowed = { theme: /^(dark|light)$/, week_start: /^[0-6]$/, weekly_rollover: /^[01]$/, weekly_deficit: /^[01]$/, budget_mode: /^(month|week)$/, backup_dir: /^[\s\S]*$/, last_auto_backup: /^[\s\S]*$/, legacy_import: /^[\s\S]*$/ };
        if (!allowed[a.key] || !allowed[a.key].test(String(a.value))) fail('إعداد غير صالح.');
        // carry-over starts counting from the week it is switched on (no retroactive surprises)
        if ((a.key === 'weekly_rollover' || a.key === 'weekly_deficit') && String(a.value) === '1' && setting(a.key, '0') !== '1') setSetting('rollover_since', weekStartOf(today(), weekStartDay()));
        if (a.key === 'weekly_rollover' && String(a.value) === '0') setSetting('weekly_deficit', '0');
        setSetting(a.key, a.value); return true;
      },

      // ----- categories -----
      listCategories: function (a) {
        return all('SELECT c.id, c.name, c.kind, c.archived, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS uses FROM categories c ' + (a && a.includeArchived ? '' : 'WHERE c.archived = 0 ') + 'ORDER BY c.kind, c.name');
      },
      saveCategory: function (a) {
        var name = needText(a.name, 'اسم التصنيف');
        if (a.kind !== 'expense' && a.kind !== 'income') fail('نوع التصنيف غير صحيح.');
        var dup = val('SELECT id FROM categories WHERE name = ? AND kind = ? AND id != ?', [name, a.kind, a.id || 0]);
        if (dup != null) fail('يوجد تصنيف بهذا الاسم.');
        if (a.id) { run('UPDATE categories SET name = ? WHERE id = ?', [name, a.id]); return a.id; }
        return insert('categories', { name: name, kind: a.kind });
      },
      deleteCategory: function (a) {
        var used = num('SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?1) + (SELECT COUNT(*) FROM budgets WHERE category_id = ?1) + (SELECT COUNT(*) FROM obligations WHERE category_id = ?1) + (SELECT COUNT(*) FROM templates WHERE category_id = ?1) + (SELECT COUNT(*) FROM weekly_budgets WHERE category_id = ?1)', [a.id]);
        if (used > 0) { run('UPDATE categories SET archived = 1 WHERE id = ?', [a.id]); return { archived: true }; }
        run('DELETE FROM categories WHERE id = ?', [a.id]); return { archived: false };
      },

      // ----- transactions -----
      listTransactions: function (a) {
        a = a || {};
        var w = [], p = [];
        var sql = 'SELECT * FROM (' +
          'SELECT t.id AS id, \'tx\' AS src, t.date, t.type, t.amount, t.category_id AS categoryId, COALESCE(c.name, \'\') AS category, t.description, t.notes, t.linked, t.created_at AS createdAt FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ' +
          'UNION ALL ' +
          'SELECT s.id AS id, \'sav\' AS src, s.date, CASE s.kind WHEN \'deposit\' THEN \'save_in\' ELSE \'save_out\' END AS type, s.amount, NULL AS categoryId, \'ادخار\' AS category, CASE s.kind WHEN \'deposit\' THEN \'تحويل إلى الادخار\' ELSE \'سحب من الادخار\' END AS description, s.notes, 1 AS linked, s.date AS createdAt FROM savings_ops s' +
          ') x';
        if (a.from) { w.push('date >= ?'); p.push(a.from); }
        if (a.to) { w.push('date <= ?'); p.push(a.to); }
        if (a.type) { w.push(a.type === 'savings' ? 'src = \'sav\'' : 'type = ?'); if (a.type !== 'savings') p.push(a.type); }
        if (a.categoryId) { w.push('categoryId = ?'); p.push(a.categoryId); }
        if (a.q) { w.push('(description LIKE ?1x OR notes LIKE ?1x OR category LIKE ?1x)'.replace(/\?1x/g, '?')); var q = '%' + clean(toLatinDigits(a.q)) + '%'; p.push(q, q, q); }
        if (w.length) sql += ' WHERE ' + w.join(' AND ');
        sql += ' ORDER BY date DESC, createdAt DESC, id DESC';
        if (a.limit) sql += ' LIMIT ' + Number(a.limit);
        return all(sql, p).map(function (r) { r.amount = Number(r.amount); return r; });
      },
      saveTransaction: function (a) {
        if (a.type !== 'income' && a.type !== 'expense') fail('نوع الحركة غير صحيح.');
        var row = { date: needDate(a.date), type: a.type, amount: needAmount(a.amount), category_id: categoryOfKind(a.categoryId, a.type), description: clean(a.description), notes: clean(a.notes) };
        if (!row.category_id) fail('اختر التصنيف.');
        var id = a.id;
        if (id) {
          var old = get('SELECT linked FROM transactions WHERE id = ?', [id]);
          if (!old) fail('الحركة غير موجودة.');
          if (Number(old.linked)) fail('هذه الحركة مرتبطة بدين أو التزام. عدّلها من صفحته.');
          run('UPDATE transactions SET date = ?, type = ?, amount = ?, category_id = ?, description = ?, notes = ? WHERE id = ?', [row.date, row.type, row.amount, row.category_id, row.description, row.notes, id]);
        } else {
          row.created_at = new Date().toISOString();
          id = insert('transactions', row);
        }
        return { id: id, alerts: a.type === 'expense' ? newAlerts(row.date) : [], farFuture: diffDays(today(), row.date) > 30 };
      },
      deleteTransaction: function (a) {
        var t = get('SELECT * FROM transactions WHERE id = ?', [a.id]);
        if (!t) fail('الحركة غير موجودة.');
        var parent = num('SELECT (SELECT COUNT(*) FROM debt_payments WHERE tx_id = ?1) + (SELECT COUNT(*) FROM obligation_payments WHERE tx_id = ?1) + (SELECT COUNT(*) FROM debts WHERE tx_id = ?1)', [a.id]);
        if (parent > 0) fail('هذه الحركة مرتبطة بدين أو التزام. احذفها من صفحته.');
        setUndo('حركة ' + fmt(Number(t.amount)) + ' ريال', [{ table: 'transactions', row: t }]);
        run('DELETE FROM transactions WHERE id = ?', [a.id]);
        return true;
      },

      // ----- templates -----
      listTemplates: function () {
        return all('SELECT t.id, t.name, t.type, t.amount, t.category_id AS categoryId, COALESCE(c.name, \'\') AS category, t.description FROM templates t LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.name');
      },
      saveTemplate: function (a) {
        if (a.type !== 'income' && a.type !== 'expense') fail('نوع القالب غير صحيح.');
        var row = { name: needText(a.name, 'اسم القالب'), type: a.type, amount: needAmount(a.amount), category_id: categoryOfKind(a.categoryId, a.type), description: clean(a.description) };
        if (!row.category_id) fail('اختر التصنيف.');
        if (a.id) { run('UPDATE templates SET name = ?, type = ?, amount = ?, category_id = ?, description = ? WHERE id = ?', [row.name, row.type, row.amount, row.category_id, row.description, a.id]); return a.id; }
        return insert('templates', row);
      },
      deleteTemplate: function (a) {
        setUndo('قالب', snapshot('templates', 'id = ?', [a.id]));
        run('DELETE FROM templates WHERE id = ?', [a.id]); return true;
      },
      useTemplate: function (a) {
        var t = get('SELECT * FROM templates WHERE id = ?', [a.id]);
        if (!t) fail('القالب غير موجود.');
        return api.saveTransaction({ date: a.date || today(), type: t.type, amount: Number(t.amount), categoryId: t.category_id, description: t.description || t.name, notes: '' });
      },

      // ----- debts -----
      listDebts: function (a) {
        var rows = debtRows(), q = a && a.q ? clean(a.q) : '';
        if (q) rows = rows.filter(function (d) { return d.party.indexOf(q) >= 0 || d.notes.indexOf(q) >= 0; });
        if (a && a.status === 'open') rows = rows.filter(function (d) { return d.remaining > 0; });
        if (a && a.status === 'closed') rows = rows.filter(function (d) { return d.remaining <= 0; });
        var mine = debtRows().filter(function (d) { return d.kind === 'on_me'; });
        var tot = { principal: 0, paid: 0, remaining: 0 };
        mine.forEach(function (d) { tot.principal += d.principal; tot.paid += d.paid; tot.remaining += d.remaining; });
        return { rows: rows, totals: tot };
      },
      saveDebt: function (a) {
        if (a.kind !== 'on_me' && a.kind !== 'for_me') fail('نوع الدين غير صحيح.');
        var row = { party: needText(a.party, 'الجهة أو الشخص'), kind: a.kind, principal: needAmount(a.principal, 'أصل الدين'), installment: a.installment ? needAmount(a.installment, 'القسط') : 0, first_due: a.firstDue ? needDate(a.firstDue, 'أول استحقاق') : null, notes: clean(a.notes) };
        if (a.id) {
          var paid = num('SELECT COALESCE(SUM(amount), 0) FROM debt_payments WHERE debt_id = ?', [a.id]);
          if (row.principal < paid) fail('أصل الدين أقل من المسدد فعليًا (' + fmt(paid) + ').');
          run('UPDATE debts SET party = ?, kind = ?, principal = ?, installment = ?, first_due = ?, notes = ? WHERE id = ?', [row.party, row.kind, row.principal, row.installment, row.first_due, row.notes, a.id]);
          return a.id;
        }
        row.created_at = new Date().toISOString();
        var id = insert('debts', row);
        if (a.cashMoved) { // the loan amount actually entered (or left) my cash now
          var isIn = a.kind === 'on_me';
          var txId = insert('transactions', { date: needDate(a.date || today()), type: isIn ? 'income' : 'expense', amount: row.principal, category_id: ensureCategory('ديون', isIn ? 'income' : 'expense'), description: (isIn ? 'استلام دين من ' : 'إقراض ') + row.party, notes: '', linked: 1, created_at: new Date().toISOString() });
          run('UPDATE debts SET tx_id = ? WHERE id = ?', [txId, id]);
        }
        return id;
      },
      deleteDebt: function (a) {
        var rows = snapshot('debts', 'id = ?', [a.id]).concat(snapshot('debt_payments', 'debt_id = ?', [a.id]));
        if (!rows.length) fail('الدين غير موجود.');
        setUndo('دين «' + rows[0].row.party + '»', rows);
        // cash history (the linked transactions) is kept: the money really moved
        run('DELETE FROM debt_payments WHERE debt_id = ?', [a.id]);
        run('DELETE FROM debts WHERE id = ?', [a.id]);
        return true;
      },
      listDebtPayments: function (a) { return all('SELECT id, date, amount, notes FROM debt_payments WHERE debt_id = ? ORDER BY date DESC, id DESC', [a.debtId]).map(function (r) { r.amount = Number(r.amount); return r; }); },
      addDebtPayment: function (a) {
        var d = debtRows().filter(function (x) { return x.id === Number(a.debtId); })[0];
        if (!d) fail('الدين غير موجود.');
        var amount = needAmount(a.amount);
        if (amount > d.remaining) fail('المبلغ أكبر من المتبقي (' + fmt(d.remaining) + ').');
        var mine = d.kind === 'on_me';
        var txId = insert('transactions', { date: needDate(a.date), type: mine ? 'expense' : 'income', amount: amount, category_id: ensureCategory(mine ? 'سداد ديون' : 'تحصيل ديون', mine ? 'expense' : 'income'), description: (mine ? 'سداد ' : 'تحصيل من ') + d.party, notes: clean(a.notes), linked: 1, created_at: new Date().toISOString() });
        var id = insert('debt_payments', { debt_id: d.id, date: a.date, amount: amount, notes: clean(a.notes), tx_id: txId });
        return { id: id, alerts: mine ? newAlerts(a.date) : [] };
      },
      deleteDebtPayment: function (a) {
        var p = get('SELECT * FROM debt_payments WHERE id = ?', [a.id]);
        if (!p) fail('السداد غير موجود.');
        var rows = [{ table: 'debt_payments', row: p }].concat(snapshot('transactions', 'id = ?', [p.tx_id]));
        setUndo('سداد ' + fmt(Number(p.amount)) + ' ريال', rows);
        run('DELETE FROM transactions WHERE id = ?', [p.tx_id]);
        run('DELETE FROM debt_payments WHERE id = ?', [a.id]);
        return true;
      },

      // ----- obligations -----
      listObligations: function () {
        return all('SELECT o.id, o.name, o.amount, o.due_day AS dueDay, o.category_id AS categoryId, COALESCE(c.name, \'\') AS category, o.start_month AS startMonth, o.end_month AS endMonth FROM obligations o LEFT JOIN categories c ON c.id = o.category_id ORDER BY o.due_day, o.name')
          .map(function (r) { r.amount = Number(r.amount); r.active = !r.endMonth || r.endMonth >= monthOf(today()); return r; });
      },
      saveObligation: function (a) {
        var day = Number(a.dueDay);
        if (!Number.isInteger(day) || day < 1 || day > 31) fail('يوم الاستحقاق بين 1 و31.');
        var row = { name: needText(a.name, 'اسم الالتزام'), amount: needAmount(a.amount), due_day: day, category_id: categoryOfKind(a.categoryId, 'expense'), start_month: needMonth(a.startMonth || monthOf(today())), end_month: a.endMonth ? needMonth(a.endMonth) : null };
        if (row.end_month && row.end_month < row.start_month) fail('شهر الإيقاف قبل شهر البداية.');
        if (a.id) { run('UPDATE obligations SET name = ?, amount = ?, due_day = ?, category_id = ?, start_month = ?, end_month = ? WHERE id = ?', [row.name, row.amount, row.due_day, row.category_id, row.start_month, row.end_month, a.id]); return a.id; }
        return insert('obligations', row);
      },
      deleteObligation: function (a) {
        var rows = snapshot('obligations', 'id = ?', [a.id]).concat(snapshot('obligation_payments', 'obligation_id = ?', [a.id]));
        if (!rows.length) fail('الالتزام غير موجود.');
        setUndo('التزام «' + rows[0].row.name + '»', rows);
        run('DELETE FROM obligation_payments WHERE obligation_id = ?', [a.id]);
        run('DELETE FROM obligations WHERE id = ?', [a.id]);
        return true;
      },
      listDues: function (a) {
        var m = needMonth(a.month), t = today();
        var dues = obligationDues(m);
        var unpaid = 0, overdue = 0;
        dues.forEach(function (d) { if (!d.paid) { unpaid += d.amount; if (d.dueDate < t) overdue += d.amount; } d.status = d.paid ? 'paid' : (d.dueDate < t ? 'overdue' : 'due'); });
        var rows = dues.filter(function (d) { return d.month === m || !d.paid; });
        if (a.status) rows = rows.filter(function (d) { return d.status === a.status; });
        if (a.q) rows = rows.filter(function (d) { return d.name.indexOf(clean(a.q)) >= 0; });
        rows.sort(function (x, y) { return x.dueDate < y.dueDate ? -1 : x.dueDate > y.dueDate ? 1 : 0; });
        return { rows: rows, unpaid: unpaid, overdue: overdue };
      },
      payDue: function (a) {
        var o = get('SELECT * FROM obligations WHERE id = ?', [a.obligationId]);
        if (!o) fail('الالتزام غير موجود.');
        needMonth(a.month);
        if (val('SELECT 1 FROM obligation_payments WHERE obligation_id = ? AND month = ?', [o.id, a.month]) != null) fail('هذا الاستحقاق مسدد بالفعل.');
        var amount = needAmount(a.amount == null ? Number(o.amount) : a.amount);
        var date = needDate(a.date || today());
        var cat = o.category_id || ensureCategory('فواتير', 'expense');
        var txId = insert('transactions', { date: date, type: 'expense', amount: amount, category_id: cat, description: o.name + ' — ' + a.month, notes: '', linked: 1, created_at: new Date().toISOString() });
        insert('obligation_payments', { obligation_id: o.id, month: a.month, date: date, amount: amount, tx_id: txId });
        return { alerts: newAlerts(date) };
      },
      unpayDue: function (a) {
        var p = get('SELECT * FROM obligation_payments WHERE obligation_id = ? AND month = ?', [a.obligationId, a.month]);
        if (!p) fail('لا يوجد سداد مسجل لهذا الاستحقاق.');
        setUndo('سداد التزام', [{ table: 'obligation_payments', row: p }].concat(snapshot('transactions', 'id = ?', [p.tx_id])));
        run('DELETE FROM transactions WHERE id = ?', [p.tx_id]);
        run('DELETE FROM obligation_payments WHERE id = ?', [p.id]);
        return true;
      },

      // ----- budget -----
      getBudget: function (a) {
        var m = needMonth(a.month), b = monthBudgetRows(m), un = unbudgeted(m);
        var totalSpent = sumTx('expense', monthStart(m), monthEnd(m));
        return { month: m, rows: b.rows, planned: b.planned, plannedSpent: b.plannedSpent, remaining: b.planned - b.plannedSpent, totalSpent: totalSpent, outsidePlan: totalSpent - b.plannedSpent, unbudgeted: un,
          hasPrev: num('SELECT COUNT(*) FROM budgets WHERE month = ?', [addMonths(m, -1)]) > 0 };
      },
      setBudget: function (a) {
        var m = needMonth(a.month), cat = categoryOfKind(a.categoryId, 'expense');
        if (!cat) fail('اختر التصنيف.');
        run('INSERT INTO budgets (month, category_id, amount) VALUES (?, ?, ?) ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount', [m, cat, needAmount(a.amount, 'الميزانية')]);
        return { alerts: newAlerts(today()) };
      },
      setBudgets: function (a) {
        var m = needMonth(a.month), n = 0;
        (a.items || []).forEach(function (it) {
          if (!it.amount) return;
          run('INSERT INTO budgets (month, category_id, amount) VALUES (?, ?, ?) ON CONFLICT(month, category_id) DO UPDATE SET amount = excluded.amount', [m, categoryOfKind(it.categoryId, 'expense'), needAmount(it.amount, 'الميزانية')]);
          n++;
        });
        return { saved: n, alerts: newAlerts(today()) };
      },
      deleteBudget: function (a) {
        var rows = snapshot('budgets', 'id = ?', [a.id]);
        if (!rows.length) fail('الميزانية غير موجودة.');
        setUndo('ميزانية', rows);
        run('DELETE FROM budgets WHERE id = ?', [a.id]); return true;
      },
      copyPrevBudget: function (a) {
        var m = needMonth(a.month), prev = addMonths(m, -1);
        var rows = all('SELECT category_id, amount FROM budgets WHERE month = ?', [prev]);
        if (!rows.length) fail('لا توجد خطة في الشهر السابق لنسخها.');
        var n = 0;
        rows.forEach(function (r) {
          if (val('SELECT 1 FROM budgets WHERE month = ? AND category_id = ?', [m, r.category_id]) == null) { insert('budgets', { month: m, category_id: r.category_id, amount: r.amount }); n++; }
        });
        return { copied: n };
      },
      getWeek: function (a) {
        var w = weekData(needDate(a.date || today()));
        var used = {};
        w.items.forEach(function (i) { if (i.categoryId != null) used[i.categoryId] = 1; });
        w.availableCategories = all('SELECT id, name FROM categories WHERE kind = \'expense\' AND archived = 0 ORDER BY name').filter(function (c) { return !used[c.id]; });
        return w;
      },
      setWeeklyBudget: function (a) {
        var cat = a.categoryId == null || a.categoryId === '' ? null : categoryOfKind(a.categoryId, 'expense');
        var amount = needAmount(a.amount, 'الميزانية الأسبوعية');
        var ex = cat == null ? val('SELECT id FROM weekly_budgets WHERE category_id IS NULL') : val('SELECT id FROM weekly_budgets WHERE category_id = ?', [cat]);
        if (ex != null) run('UPDATE weekly_budgets SET amount = ? WHERE id = ?', [amount, ex]);
        else insert('weekly_budgets', { category_id: cat, amount: amount });
        return { alerts: newAlerts(today()) };
      },
      deleteWeeklyBudget: function (a) {
        var where = a.categoryId == null ? 'category_id IS NULL' : 'category_id = ?', p = a.categoryId == null ? [] : [a.categoryId];
        var rows = snapshot('weekly_budgets', where, p);
        if (!rows.length) fail('لا توجد ميزانية أسبوعية محددة هنا.');
        setUndo('ميزانية أسبوعية', rows);
        run('DELETE FROM weekly_budgets WHERE ' + where, p); return true;
      },

      // ----- savings -----
      getSavings: function (a) {
        var s = savingsSummary();
        var w = [], p = [];
        if (a && a.kind) { w.push('o.kind = ?'); p.push(a.kind); }
        if (a && a.q) { w.push('(o.notes LIKE ? OR g.name LIKE ?)'); p.push('%' + clean(a.q) + '%', '%' + clean(a.q) + '%'); }
        s.ops = all('SELECT o.id, o.date, o.kind, o.amount, o.goal_id AS goalId, COALESCE(g.name, \'\') AS goal, o.notes FROM savings_ops o LEFT JOIN savings_goals g ON g.id = o.goal_id' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY o.date DESC, o.id DESC', p)
          .map(function (r) { r.amount = Number(r.amount); return r; });
        s.cash = cashBalance(today());
        return s;
      },
      saveGoal: function (a) {
        var name = needText(a.name, 'اسم الهدف');
        var target = a.target ? needAmount(a.target, 'قيمة الهدف') : 0;
        if (a.id) { run('UPDATE savings_goals SET name = ?, target = ? WHERE id = ?', [name, target, a.id]); return a.id; }
        var id = insert('savings_goals', { name: name, target: target, created_at: new Date().toISOString() });
        // the first goal adopts savings that were not assigned to any goal yet
        if (num('SELECT COUNT(*) FROM savings_goals') === 1) run('UPDATE savings_ops SET goal_id = ? WHERE goal_id IS NULL', [id]);
        return id;
      },
      deleteGoal: function (a) {
        var rows = snapshot('savings_goals', 'id = ?', [a.id]);
        if (!rows.length) fail('الهدف غير موجود.');
        var ops = all('SELECT id FROM savings_ops WHERE goal_id = ?', [a.id]).map(function (r) { return r.id; });
        rows.push({ relink: { table: 'savings_ops', column: 'goal_id', value: a.id, ids: ops } });
        setUndo('هدف «' + rows[0].row.name + '»', rows);
        run('UPDATE savings_ops SET goal_id = NULL WHERE goal_id = ?', [a.id]); // the money stays in savings
        run('DELETE FROM savings_goals WHERE id = ?', [a.id]); return true;
      },
      saveSavingsOp: function (a) {
        if (a.kind !== 'deposit' && a.kind !== 'withdraw') fail('نوع العملية غير صحيح.');
        var amount = needAmount(a.amount), date = needDate(a.date);
        var goal = a.goalId ? Number(a.goalId) : null;
        if (goal && val('SELECT 1 FROM savings_goals WHERE id = ?', [goal]) == null) fail('الهدف غير موجود.');
        var old = a.id ? get('SELECT * FROM savings_ops WHERE id = ?', [a.id]) : null;
        if (a.id && !old) fail('العملية غير موجودة.');
        if (old) run('DELETE FROM savings_ops WHERE id = ?', [a.id]);
        if (a.kind === 'withdraw') {
          var bal = goal ? savingsBalance(null, goal) : savingsBalance(null, null);
          if (amount > bal) fail('المبلغ أكبر من الرصيد المتاح للسحب (' + fmt(bal) + ').');
        }
        var row = { date: date, kind: a.kind, amount: amount, goal_id: goal, notes: clean(a.notes) };
        if (old) row.id = old.id;
        var id = insert('savings_ops', row);
        if (savingsBalance() < 0) fail('لا يمكن أن يصبح رصيد الادخار سالبًا.');
        return id;
      },
      deleteSavingsOp: function (a) {
        var rows = snapshot('savings_ops', 'id = ?', [a.id]);
        if (!rows.length) fail('العملية غير موجودة.');
        run('DELETE FROM savings_ops WHERE id = ?', [a.id]);
        if (savingsBalance() < 0) fail('حذف هذا الإيداع يجعل رصيد الادخار سالبًا. احذف السحب أولًا.');
        setUndo('عملية ادخار ' + fmt(Number(rows[0].row.amount)) + ' ريال', rows);
        return true;
      },

      // ----- dashboard / reports -----
      dashboard: function (a) {
        var t = today(), m = needMonth(a.month), s = monthStart(m), e = monthEnd(m), cur = monthOf(t);
        var income = sumTx('income', s, e), expense = sumTx('expense', s, e);
        var cash = cashBalance(t), reserved = reservedThrough(cur);
        var cats = all('SELECT COALESCE(c.name, \'بدون تصنيف\') AS name, SUM(t.amount) AS amount FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.type = \'expense\' AND t.date >= ? AND t.date <= ? GROUP BY t.category_id ORDER BY amount DESC', [s, e])
          .map(function (r) { return { name: r.name, amount: Number(r.amount) }; });
        var saved = num('SELECT COALESCE(SUM(CASE kind WHEN \'deposit\' THEN amount ELSE -amount END), 0) FROM savings_ops WHERE date >= ? AND date <= ?', [s, e]);
        var debtsLeft = 0; debtRows().forEach(function (d) { if (d.kind === 'on_me') debtsLeft += d.remaining; });
        var b = monthBudgetRows(m);
        return {
          month: m, today: t, isCurrentMonth: m === cur,
          cash: cash, income: income, expense: expense, savings: savingsBalance(), debtsLeft: debtsLeft, reserved: reserved, available: cash - reserved,
          savedThisMonth: saved, savingsRate: income > 0 && saved > 0 ? pct(saved, income) : 0,
          byCategory: cats, week: weekData(t), forecast: forecast(t), alerts: activeAlerts(t),
          budget: { planned: b.planned, plannedSpent: b.plannedSpent, outsidePlan: expense - b.plannedSpent, unbudgetedCount: unbudgeted(m).length },
          templates: api.listTemplates(), empty: num('SELECT COUNT(*) FROM transactions') === 0
        };
      },
      report: function (a) {
        var from = needDate(a.from, 'بداية الفترة'), to = needDate(a.to, 'نهاية الفترة');
        if (to < from) fail('نهاية الفترة قبل بدايتها.');
        var income = sumTx('income', from, to), expense = sumTx('expense', from, to);
        var saved = num('SELECT COALESCE(SUM(CASE kind WHEN \'deposit\' THEN amount ELSE -amount END), 0) FROM savings_ops WHERE date >= ? AND date <= ?', [from, to]);
        var cats = all('SELECT COALESCE(c.name, \'بدون تصنيف\') AS name, SUM(t.amount) AS amount FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.type = \'expense\' AND t.date >= ? AND t.date <= ? GROUP BY t.category_id ORDER BY amount DESC', [from, to])
          .map(function (r) { return { name: r.name, amount: Number(r.amount), pct: pct(Number(r.amount), expense) }; });
        var incCats = all('SELECT COALESCE(c.name, \'بدون تصنيف\') AS name, SUM(t.amount) AS amount FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.type = \'income\' AND t.date >= ? AND t.date <= ? GROUP BY t.category_id ORDER BY amount DESC', [from, to])
          .map(function (r) { return { name: r.name, amount: Number(r.amount), pct: pct(Number(r.amount), income) }; });
        var endM = monthOf(to), months = [];
        var span = Math.min(11, Math.max(5, monthsBetween(monthOf(from), endM)));
        for (var i = span; i >= 0; i--) {
          var mm = addMonths(endM, -i);
          months.push({ month: mm, income: sumTx('income', monthStart(mm), monthEnd(mm)), expense: sumTx('expense', monthStart(mm), monthEnd(mm)) });
        }
        return { from: from, to: to, income: income, expense: expense, net: income - expense, saved: saved, byCategory: cats, incomeByCategory: incCats, months: months,
          rows: api.listTransactions({ from: from, to: to }) };
      },
      reportCsv: function (a) {
        var r = api.report(a), L = [];
        function q(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        function line() { L.push(Array.prototype.map.call(arguments, q).join(',')); }
        var typeName = { income: 'دخل', expense: 'مصروف', save_in: 'إيداع ادخار', save_out: 'سحب ادخار' };
        line('تقرير ميزاني', r.from, r.to);
        line('الدخل', fmt(r.income).replace(/,/g, '')); line('المصروف', fmt(r.expense).replace(/,/g, ''));
        line('الصافي', fmt(r.net).replace(/,/g, '')); line('صافي التحويل إلى الادخار', fmt(r.saved).replace(/,/g, ''));
        L.push(''); line('توزيع المصروفات'); line('التصنيف', 'المبلغ', 'النسبة %');
        r.byCategory.forEach(function (c) { line(c.name, fmt(c.amount).replace(/,/g, ''), c.pct); });
        L.push(''); line('المقارنة الشهرية'); line('الشهر', 'الدخل', 'المصروف');
        r.months.forEach(function (m) { line(m.month, fmt(m.income).replace(/,/g, ''), fmt(m.expense).replace(/,/g, '')); });
        L.push(''); line('الحركات'); line('التاريخ', 'النوع', 'المبلغ', 'التصنيف', 'الوصف', 'الملاحظات');
        r.rows.forEach(function (t) { line(t.date, typeName[t.type] || t.type, fmt(t.amount).replace(/,/g, ''), t.category, t.description, t.notes); });
        return '﻿' + L.join('\r\n') + '\r\n';
      },
      search: function (a) {
        var q = clean(toLatinDigits(a.q));
        if (q.length < 2) return { transactions: [], debts: [], obligations: [], goals: [] };
        var amount = parseAmount(q);
        var tx = api.listTransactions({ q: q, limit: 12 });
        if (amount != null) {
          var seen = {}; tx.forEach(function (t) { seen[t.src + t.id] = 1; });
          api.listTransactions({}).filter(function (t) { return t.amount === amount && !seen[t.src + t.id]; }).slice(0, 8).forEach(function (t) { tx.push(t); });
        }
        return {
          transactions: tx,
          debts: debtRows().filter(function (d) { return d.party.indexOf(q) >= 0 || d.notes.indexOf(q) >= 0; }).slice(0, 6),
          obligations: api.listObligations().filter(function (o) { return o.name.indexOf(q) >= 0; }).slice(0, 6),
          goals: savingsSummary().goals.filter(function (g) { return g.name.indexOf(q) >= 0; }).slice(0, 6)
        };
      },
      alerts: function () { return activeAlerts(today()); },

      // ----- undo -----
      undoInfo: function () { return undoEntry ? { label: undoEntry.label } : null; },
      undo: function () {
        if (!undoEntry) fail('لا يوجد حذف للتراجع عنه.');
        var u = undoEntry;
        u.rows.forEach(function (r) { if (r.table) insert(r.table, r.row); });
        u.rows.forEach(function (r) { if (r.relink && r.relink.ids.length) run('UPDATE ' + r.relink.table + ' SET ' + r.relink.column + ' = ? WHERE id IN (' + r.relink.ids.map(Number).join(',') + ')', [r.relink.value]); });
        undoEntry = null;
        return { label: u.label };
      }
    };

    var READ_ONLY = { syncExport: 1, info: 1, getSettings: 1, listCategories: 1, listTransactions: 1, listTemplates: 1, listDebts: 1, listDebtPayments: 1, listObligations: 1, listDues: 1, getBudget: 1, getWeek: 1, getSavings: 1, dashboard: 1, report: 1, reportCsv: 1, search: 1, alerts: 1, undoInfo: 1 };

    /** Single entry point. Every write runs in a transaction; on any error nothing is saved. */
    function call(method, args) {
      if (!Object.prototype.hasOwnProperty.call(api, method)) return { ok: false, error: 'عملية غير معروفة: ' + method };
      var write = !READ_ONLY[method];
      var prevUndo = undoEntry;
      try {
        if (write) run('BEGIN');
        var data = api[method](args || {});
        if (write) { run('COMMIT'); dirty = true; }
        return { ok: true, data: data === undefined ? null : data };
      } catch (e) {
        if (write) { try { run('ROLLBACK'); } catch (e2) { /* ignore */ } undoEntry = prevUndo; }
        return { ok: false, error: e && e.userError ? e.message : 'حدث خطأ غير متوقع: ' + (e && e.message ? e.message : e) };
      }
    }

    return {
      call: call,
      exportBytes: function () { return db.export(); },
      isDirty: function () { return dirty; },
      clearDirty: function () { dirty = false; },
      migration: migration,
      close: function () { db.close(); },
      _db: db
    };
  }

  /** Checks that a file is a Mizani v2 database before it is used for restore. */
  function validateBackup(SQL, bytes) {
    var db;
    try {
      db = new SQL.Database(bytes);
      var r = db.exec('SELECT COUNT(*) FROM sqlite_master WHERE type = \'table\' AND name IN (\'transactions\', \'categories\', \'settings\', \'savings_ops\', \'budgets\')');
      var v = db.exec('PRAGMA user_version')[0].values[0][0];
      var ok = db.exec('PRAGMA integrity_check')[0].values[0][0] === 'ok';
      if (!ok) return { ok: false, error: 'الملف تالف (فشل فحص السلامة).' };
      if (r[0].values[0][0] !== 5 || v < 1) return { ok: false, error: 'الملف ليس نسخة احتياطية من ميزاني 2.' };
      if (v > SCHEMA_VERSION) return { ok: false, error: 'النسخة من إصدار أحدث من التطبيق.' };
      return { ok: true, version: v };
    } catch (e) { return { ok: false, error: 'تعذر قراءة الملف كقاعدة بيانات.' }; }
    finally { if (db) db.close(); }
  }

  return {
    createCore: createCore, validateBackup: validateBackup, parseAmount: parseAmount, fmt: fmt, toLatinDigits: toLatinDigits,
    SCHEMA_VERSION: SCHEMA_VERSION, APP_VERSION: APP_VERSION,
    dates: { addDays: addDays, addMonths: addMonths, monthOf: monthOf, monthStart: monthStart, monthEnd: monthEnd, daysInMonth: daysInMonth, weekStartOf: weekStartOf, diffDays: diffDays, isDate: isDate, isMonth: isMonth, localToday: localToday }
  };
});
