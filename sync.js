/* Mizani sync engine. Isomorphic (Electron main + browser).
 * Each device writes ONE file of its own (mizani-sync-<device>.json) and reads the others', so two devices
 * never write the same file. Merging is done by core.syncImport (per-row last-writer-wins + tombstones).
 * Transport is injectable: Google Drive (hidden appDataFolder in the user's own Drive) or memory (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MizaniSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'mizani-sync-';

  // ---------- Google Drive transport (appDataFolder: invisible to the user, private to this app) ----------
  function driveTransport(getToken, fetchFn) {
    var f = fetchFn || fetch;
    function auth(extra) {
      return getToken().then(function (tok) {
        if (!tok) throw new Error('غير متصل بحساب Google.');
        var h = { Authorization: 'Bearer ' + tok };
        for (var k in extra) h[k] = extra[k];
        return h;
      });
    }
    function check(res) {
      if (res.ok) return res;
      return res.text().then(function (t) { var e = new Error('Drive ' + res.status + ': ' + t.slice(0, 200)); e.status = res.status; throw e; });
    }
    return {
      list: function () {
        var url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=100&fields=' +
          encodeURIComponent('files(id,name,modifiedTime)') + '&q=' + encodeURIComponent("name contains '" + PREFIX + "' and trashed = false");
        return auth({}).then(function (h) { return f(url, { headers: h }); }).then(check).then(function (r) { return r.json(); }).then(function (j) { return j.files || []; });
      },
      read: function (id) {
        return auth({}).then(function (h) { return f('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', { headers: h }); }).then(check).then(function (r) { return r.text(); });
      },
      write: function (name, text, existingId) {
        if (existingId) {
          return auth({ 'Content-Type': 'application/json' }).then(function (h) {
            return f('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(existingId) + '?uploadType=media&fields=id', { method: 'PATCH', headers: h, body: text });
          }).then(check).then(function (r) { return r.json(); }).then(function (j) { return j.id; });
        }
        var boundary = 'mizani' + Math.random().toString(36).slice(2);
        var meta = JSON.stringify({ name: name, parents: ['appDataFolder'], mimeType: 'application/json' });
        var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
        return auth({ 'Content-Type': 'multipart/related; boundary=' + boundary }).then(function (h) {
          return f('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: h, body: body });
        }).then(check).then(function (r) { return r.json(); }).then(function (j) { return j.id; });
      }
    };
  }

  // ---------- in-memory transport (tests) ----------
  function memoryTransport(store) {
    store = store || { files: {}, n: 0 };
    return {
      store: store,
      list: function () { return Promise.resolve(Object.keys(store.files).map(function (id) { return { id: id, name: store.files[id].name, modifiedTime: store.files[id].mt }; })); },
      read: function (id) { return Promise.resolve(store.files[id].text); },
      write: function (name, text, existingId) {
        var id = existingId || ('f' + (++store.n));
        store.files[id] = { name: name, text: text, mt: String(Date.now()) + ':' + (++store.n) };
        return Promise.resolve(id);
      }
    };
  }

  function hashOf(snap) { // content hash ignoring the export timestamp
    var c = { v: snap.v, schema: snap.schema, tables: snap.tables, tombstones: snap.tombstones, settings: snap.settings };
    var s = JSON.stringify(c), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h) + ':' + s.length;
  }

  /** opts: { call(method,args)->{ok,data,error}, transport, onChanged(n), onState(state), isConnected()->bool, intervalMs } */
  function createSync(opts) {
    var state = { status: 'off', lastSync: null, lastError: null, devices: 0, changedTotal: 0 };
    var seen = {};         // fileId -> modifiedTime already merged
    var ownFileId = null, lastHash = null, running = false, again = false, timer = null, debounce = null;

    function set(patch) { for (var k in patch) state[k] = patch[k]; if (opts.onState) opts.onState(JSON.parse(JSON.stringify(state))); }
    function need(r) { if (!r.ok) throw new Error(r.error || 'خطأ'); return r.data; }

    function once() {
      var me = need(opts.call('syncDeviceId'));
      var ownName = PREFIX + me + '.json';
      return opts.transport.list().then(function (files) {
        var others = files.filter(function (f) { return f.name !== ownName; });
        var mine = files.filter(function (f) { return f.name === ownName; })[0];
        ownFileId = mine ? mine.id : null;
        var fresh = others.filter(function (f) { return seen[f.id] !== f.modifiedTime; });
        return Promise.all(fresh.map(function (f) { return opts.transport.read(f.id).then(function (t) { return { f: f, snap: JSON.parse(t) }; }); })).then(function (got) {
          var snaps = got.map(function (g) { return g.snap; });
          var res = snaps.length ? need(opts.call('syncImport', { snapshots: snaps })) : { changed: 0 };
          got.forEach(function (g) { seen[g.f.id] = g.f.modifiedTime; });
          set({ devices: others.length + 1 });
          if (res.changed > 0) { state.changedTotal += res.changed; if (opts.onChanged) opts.onChanged(res.changed); }
          var snap = need(opts.call('syncExport'));
          var h = hashOf(snap);
          if (h === lastHash && ownFileId) return null;
          return opts.transport.write(ownName, JSON.stringify(snap), ownFileId).then(function (id) { ownFileId = id; lastHash = h; });
        });
      });
    }

    function run() {
      if (!opts.isConnected()) { set({ status: 'off' }); return Promise.resolve(false); }
      if (running) { again = true; return Promise.resolve(false); }
      running = true; set({ status: 'syncing', lastError: null });
      return once().then(function () {
        set({ status: 'idle', lastSync: new Date().toISOString() });
        return true;
      }).catch(function (e) {
        set({ status: 'error', lastError: e && e.message ? e.message : String(e) });
        return false;
      }).then(function (ok) {
        running = false;
        if (again) { again = false; setTimeout(run, 500); }
        return ok;
      });
    }

    return {
      state: function () { return JSON.parse(JSON.stringify(state)); },
      syncNow: run,
      /** call after every local write: syncs shortly after the last change */
      kick: function () { if (!opts.isConnected()) return; clearTimeout(debounce); debounce = setTimeout(run, 2500); },
      start: function () { if (timer) return; timer = setInterval(run, opts.intervalMs || 60000); setTimeout(run, 800); },
      stop: function () { clearInterval(timer); timer = null; clearTimeout(debounce); },
      reset: function () { seen = {}; ownFileId = null; lastHash = null; set({ status: 'off', devices: 0, lastSync: null }); }
    };
  }

  return { createSync: createSync, driveTransport: driveTransport, memoryTransport: memoryTransport, hashOf: hashOf, PREFIX: PREFIX };
});
