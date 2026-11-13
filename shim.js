/* Mizani web (phone) shell: runs the same core in the page, stores data in IndexedDB, syncs through Google Drive. */
(function () {
  'use strict';
  var CFG = window.MIZANI_CFG || {};
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var core = null, dirty = false, saveTimer = null;

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('mizani', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function kv(mode, fn) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('kv', mode), st = t.objectStore('kv'), q = fn(st); t.oncomplete = function () { res(q && q.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function load() { return kv('readonly', function (s) { return s.get('db'); }); }
  function save() { if (!core || !dirty) return Promise.resolve(); var b = core.exportBytes(); dirty = false; core.clearDirty && core.clearDirty(); return kv('readwrite', function (s) { return s.put(b, 'db'); }); }
  function touch() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 80); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
  window.addEventListener('pagehide', function () { save(); });

  // ---- Google sign-in (token flow, appData scope only) ----
  var tok = null, tokExp = 0, tokClient = null;
  function connected() { try { return localStorage.getItem('mz_google') === '1'; } catch (e) { return false; } }
  function gis() {
    return new Promise(function (res, rej) {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('تعذر الاتصال بخدمة Google.')); };
      document.head.appendChild(s);
    });
  }
  function requestToken(prompt) {
    return gis().then(function () {
      return new Promise(function (res, rej) {
        var done = false, to = setTimeout(function () { if (!done) { done = true; rej(new Error('يلزم تسجيل الدخول من جديد: افتح الإعدادات واضغط «ربط حساب Google».')); } }, 15000);
        tokClient = google.accounts.oauth2.initTokenClient({
          client_id: CFG.webClientId, scope: SCOPE, prompt: prompt,
          callback: function (r) { if (done) return; done = true; clearTimeout(to); if (r.error) rej(new Error(r.error)); else { tok = r.access_token; tokExp = Date.now() + (r.expires_in - 120) * 1000; res(tok); } },
          error_callback: function (e) { if (done) return; done = true; clearTimeout(to); rej(new Error((e && e.type) || 'popup')); }
        });
        tokClient.requestAccessToken({ prompt: prompt });
      });
    });
  }
  function getToken() {
    if (!connected()) return Promise.resolve(null);
    if (tok && Date.now() < tokExp) return Promise.resolve(tok);
    return requestToken('');
  }

  var sync = null, syncState = { status: 'off' }, changedCbs = [];
  function setupSync() {
    sync = MizaniSync.createSync({
      call: function (m, a) { var r = core.call(m, a); if (m === 'syncImport') touch(); return r; },
      transport: MizaniSync.driveTransport(getToken),
      isConnected: function () { return !!CFG.webClientId && connected(); },
      onState: function (s) { syncState = s; },
      onChanged: function () { touch(); changedCbs.forEach(function (f) { f(); }); }
    });
    sync.start();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync.syncNow(); });
    window.addEventListener('online', function () { sync.syncNow(); });
  }

  function download(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }

  var READ = /^(get|list|info|dashboard|report|search|alerts|undoInfo|sync)/;
  var HOST = {
    info: function () { return { web: true, dbPath: 'على هذا الجهاز (داخل التطبيق)', dataDir: '', version: core.call('info').data.appVersion, platform: 'Web', backupDir: '', backupDirOk: false, lastAutoBackup: '', autoBackups: [], legacyFound: false, startupNotice: null }; },
    syncStatus: function () { return { configured: !!CFG.webClientId, connected: connected(), state: sync.state() }; },
    syncConnect: function () {
      return save().then(function () { return requestToken('consent'); }).then(function () { localStorage.setItem('mz_google', '1'); sync.reset(); return sync.syncNow(); }).then(function (ok) { return { ok: ok, state: sync.state() }; });
    },
    syncNow: function () { return sync.syncNow().then(function (ok) { return { ok: ok, state: sync.state() }; }); },
    syncDisconnect: function () { try { localStorage.removeItem('mz_google'); } catch (e) { /* ignore */ } tok = null; sync.reset(); return Promise.resolve(true); },
    backupNow: function () { return save().then(function () { download('mizani-backup-' + stamp() + '.db', new Blob([core.exportBytes()])); return { file: 'التنزيلات' }; }); },
    restore: function () {
      return new Promise(function (res, rej) {
        var i = document.createElement('input'); i.type = 'file'; i.accept = '.db';
        i.onchange = function () {
          var f = i.files[0]; if (!f) return res({ canceled: true });
          f.arrayBuffer().then(function (ab) {
            var bytes = new Uint8Array(ab), chk = MizaniCore.validateBackup(SQLMOD, bytes);
            if (!chk.ok) throw new Error(chk.error);
            var next = MizaniCore.createCore(SQLMOD, bytes); core.close(); core = next; dirty = true; return save();
          }).then(function () { res({ restored: true, safety: null }); }, rej);
        };
        i.click();
      });
    },
    exportCsv: function (a) { download(a.name || 'mizani.csv', new Blob(['﻿' + a.text], { type: 'text/csv;charset=utf-8' })); return Promise.resolve({ file: a.name }); },
    exportPdf: function (a) { var w = window.open('', '_blank'); if (!w) throw new Error('اسمح بالنوافذ المنبثقة ثم أعد المحاولة.'); w.document.write(a.html); w.document.close(); setTimeout(function () { w.print(); }, 500); return Promise.resolve({ file: 'طباعة' }); },
    showFile: function () { return true; }, openDataDir: function () { return true; },
    chooseBackupDir: function () { return { canceled: true }; }, clearBackupDir: function () { return true; }, autoBackupNow: function () { return { ok: false }; }
  };
  function wrap(fn) { return new Promise(function (res) { try { Promise.resolve(fn()).then(function (d) { res({ ok: true, data: d }); }, function (e) { res({ ok: false, error: String(e && e.message ? e.message : e) }); }); } catch (e) { res({ ok: false, error: String(e && e.message ? e.message : e) }); } }); }

  window.mizani = {
    call: function (m, a) { var r = core.call(String(m), a || {}); if (r.ok && !READ.test(m)) { touch(); if (sync) sync.kick(); } return Promise.resolve(r); },
    host: function (n, a) { if (!HOST[n]) return Promise.resolve({ ok: false, error: 'عملية غير معروفة' }); return wrap(function () { return HOST[n](a || {}); }); },
    onChanged: function (f) { changedCbs.push(f); }
  };

  var SQLMOD = null;
  window.__mizaniReady = initSqlJs({ locateFile: function (f) { return f; } }).then(function (SQL) {
    SQLMOD = SQL;
    return load().then(function (bytes) {
      core = MizaniCore.createCore(SQL, bytes ? new Uint8Array(bytes) : null);
      dirty = true; return save();
    });
  }).then(function () { setupSync(); });
})();
