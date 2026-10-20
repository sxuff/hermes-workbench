// Browser stand-in for the Hermes desktop app's Electron bridge (`window.hermesDesktop`).
// The desktop renderer runs in a same-origin iframe inside the dashboard; auth, REST and
// the gateway socket are delegated to the parent dashboard's plugin SDK, which handles both
// loopback-token and OAuth-gated dashboards. Electron-only features become safe no-ops.
// Members not listed below resolve to harmless stubs; `window.__hermesWebShimMissing` lists
// the non-subscription ones that were called, for debugging.
(function () {
  'use strict';
  var parentWin = window.parent !== window ? window.parent : null;
  var sdk = parentWin && parentWin.__HERMES_PLUGIN_SDK__;
  var params = new URLSearchParams(location.search);
  var profile = params.get('profile') || 'default';
  var missing = new Set();
  window.__hermesWebShimMissing = missing;
  if (!sdk) console.error('[hermes-web] No dashboard SDK in the parent frame; open this through /workbench.');

  var origin = location.origin;
  var noop = function () {};
  var asyncNoop = function () { return Promise.resolve(undefined); };
  var unsubscribe = function () { return noop; };
  var unsupported = function (what) { return function () { return Promise.resolve({ ok: false, error: what + ' is not available in the browser' }); }; };

  // The desktop renderer rewrites navigator.clipboard.writeText to route it through this bridge
  // (apps/desktop/src/lib/clipboard.ts -> installClipboardShim). Reading writeText lazily therefore
  // made the bridge and the override call each other until the stack blew up (RangeError: maximum
  // call stack size exceeded), and a click on the chat's copy icon silently left the clipboard
  // untouched. Capture the real methods here, before the app boots: Electron's own bridge writes
  // unconditionally, and so must this one.
  var clipboardApi = navigator.clipboard || null;
  var nativeWriteText = clipboardApi && clipboardApi.writeText ? clipboardApi.writeText.bind(clipboardApi) : null;
  var nativeReadText = clipboardApi && clipboardApi.readText ? clipboardApi.readText.bind(clipboardApi) : null;

  function withProfile(path, p) {
    if (!p || p === 'default') return path;
    return path + (path.indexOf('?') < 0 ? '?' : '&') + 'profile=' + encodeURIComponent(p);
  }

  async function wsUrl() {
    return await sdk.buildWsUrl('/api/ws');
  }

  function connection(p) {
    return wsUrl().then(function (url) {
      var token = parentWin && parentWin.__HERMES_SESSION_TOKEN__ || '';
      return {
        // 'remote': the browser cannot touch the backend's disk, which is exactly the desktop's
        // remote-gateway model: attachments upload bytes, file trees and git go through REST.
        baseUrl: origin, token: token, wsUrl: url, mode: 'remote', remoteKind: 'url', remoteHost: location.host,
        authMode: 'token',
        isFullscreen: false, nativeOverlayWidth: 0, logs: [], source: 'local',
        profile: p || profile, connectionId: 'local',
      };
    });
  }

  // Mirrors electron/api-transport fetchJson: parsed JSON, or an Error "status: detail" with statusCode.
  async function api(request) {
    var req = request || {};
    var init = { method: req.method || 'GET', headers: {} };
    if (req.upload) {
      var form = new FormData();
      form.append('file', new Blob([req.upload.bytes], { type: req.upload.contentType || 'application/octet-stream' }), req.upload.filename);
      init.body = form;
    } else if (req.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    var res = await sdk.authedFetch(withProfile(req.path, req.profile), init);
    var text = await res.text();
    if (!res.ok) {
      var error = new Error(res.status + ': ' + text.slice(0, 2000));
      error.statusCode = res.status;
      throw error;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function dataUrlOf(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  // Virtual files: the desktop attaches by path (Electron writes pastes/drops to disk). Here the
  // bytes stay in memory under an opaque path; remote mode then uploads them via image/file.attach.
  var files = new Map();
  var fileSeq = 0;
  function keep(blob, name) {
    var safe = String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file';
    var path = '/hermes-web/' + (++fileSeq) + '-' + Date.now().toString(36) + '/' + safe;
    files.set(path, blob);
    return path;
  }
  // An image from the transcript (a MEDIA delivery, an artifact thumbnail) has two paths through
  // this bridge. The renderer treats our connection id 'local' — the registry's primary connection —
  // as "this machine's disk, use the Electron bridge" (lib/media.ts resolveMediaDisplaySrc,
  // markdown-text.tsx useOpenMediaFile), and the two members it reaches for could not answer:
  //   readFileDataUrl — only knew the blobs THIS browser kept (attachments), so any path on the
  //     backend's disk answered null and the row fell through to its failure line ("Couldn't load
  //     <name>." over an Open image button that did nothing);
  //   saveGatewayFile — absent, and the catch-all stub resolves undefined, so the download settled
  //     into nothing: no file, no toast, no error.
  // Both now go through the REST routes the renderer itself uses in remote mode.
  function backendPath(path) {
    return String(path == null ? '' : path).replace(/^file:\/\//, '');
  }

  function readFile(path) {
    var blob = files.get(path);
    if (blob) return dataUrlOf(blob);
    return api({ path: '/api/fs/read-data-url?path=' + encodeURIComponent(backendPath(path)), profile: profile }).then(function (result) {
      var dataUrl = typeof result === 'string' ? result : result && result.dataUrl;
      if (!dataUrl) throw new Error('Backend returned no file data for ' + path);
      return dataUrl;
    });
  }

  // Electron opens a save dialog and writes the bytes; a browser has neither, so the bytes are
  // handed to the browser's own download. Same result shape as the IPC handler, so the renderer's
  // saved/failed toasts keep working.
  function saveGatewayFile(payload) {
    var path = payload && payload.path;
    if (!path) return Promise.reject(new Error('Missing gateway file path'));
    var name = String((payload && payload.suggestedName) || backendPath(path).split('/').filter(Boolean).pop() || 'download');
    return sdk.authedFetch(withProfile('/api/fs/download?path=' + encodeURIComponent(backendPath(path)), (payload && payload.profile) || profile))
      .then(function (res) {
        if (!res.ok) throw new Error(res.status + ': ' + (res.statusText || 'download failed'));
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        return { path: path, saved: true };
      });
  }
  function pickFiles(options) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.multiple = !(options && options.multiple === false);
      var exts = [];
      ((options && options.filters) || []).forEach(function (f) { (f.extensions || []).forEach(function (e) { if (e !== '*') exts.push('.' + e); }); });
      if (exts.length) input.accept = exts.join(',');
      input.style.display = 'none';
      input.onchange = function () { var picked = Array.from(input.files || []).map(function (f) { return keep(f, f.name); }); input.remove(); resolve(picked); };
      input.addEventListener('cancel', function () { input.remove(); resolve([]); });
      document.body.appendChild(input);
      input.click();
    });
  }
  var EXT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

  var store = {
    get: function (key, fallback) { try { var v = localStorage.getItem('hermes-web:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set: function (key, value) { try { localStorage.setItem('hermes-web:' + key, JSON.stringify(value)); } catch (e) {} },
  };

  // Settings -> Sessions ("Default project directory") and the boot-time workspace seeding both
  // read `settings.getDefaultProjectDir()`. Shapes mirror Electron's ipc handlers (electron/main.ts):
  // get -> { defaultLabel, dir, resolvedCwd }, set -> { dir }, pick -> { canceled, dir }.
  //
  // Electron's picker is a native dialog, and a browser has no equivalent. The path that matters
  // here is a path on the BACKEND, where sessions actually run, so the picker browses the backend's
  // disk over the dashboard REST API (/api/fs/list) — the same data the app's own remote folder
  // picker shows — and an unreadable path is refused instead of stored.
  var DEFAULT_PROJECT_DIR_KEY = 'defaultProjectDir';
  var defaultProjectDir = store.get(DEFAULT_PROJECT_DIR_KEY, '') || '';

  function backendCwd() {
    return api({ path: '/api/fs/default-cwd' }).then(
      function (result) { return (result && result.cwd) || ''; },
      function () { return ''; }
    );
  }

  function listBackendDirs(path) {
    return api({ path: '/api/fs/list?path=' + encodeURIComponent(path) }).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      return ((result && result.entries) || []).filter(function (entry) { return entry.isDirectory; });
    });
  }

  function getDefaultProjectDir() {
    return backendCwd().then(function (cwd) {
      return {
        defaultLabel: cwd,
        dir: defaultProjectDir || null,
        // Electron resolves `dir` against the local home; the backend's own cwd is the equivalent
        // floor here.
        resolvedCwd: defaultProjectDir || cwd,
      };
    });
  }

  function setDefaultProjectDir(dir) {
    var next = typeof dir === 'string' && dir.trim() ? dir.trim() : null;

    if (!next) {
      defaultProjectDir = '';
      store.set(DEFAULT_PROJECT_DIR_KEY, '');
      return Promise.resolve({ dir: null });
    }

    // Electron mkdir -p's the path. Over REST the best we can do is prove it reads as a directory;
    // a bad path is refused rather than stored, so a new chat cannot be pinned to a folder that
    // sessions cannot start in.
    return listBackendDirs(next).then(function () {
      defaultProjectDir = next;
      store.set(DEFAULT_PROJECT_DIR_KEY, next);
      return { dir: next };
    }, function (error) {
      throw new Error('Not a readable directory on the backend: ' + next + ' (' + (error && error.message || error) + ')');
    });
  }

  function parentDir(path) {
    var value = String(path || '/').replace(/\/+$/, '') || '/';

    if (value === '/') return '/';

    var cut = value.lastIndexOf('/');

    return cut <= 0 ? '/' : value.slice(0, cut);
  }

  // Metric and token parity with the app's own folder dialog (right-sidebar/files/remote-picker.tsx
  // over its Dialog shell): the same theme tokens, the same size, the same layer from the app's
  // z-index ladder instead of a literal. Styles live in one injected sheet, so rows and buttons get
  // real :hover states without a listener per element.
  var PICKER_CSS =
    '[data-hermes-web-folder-picker] .wb-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;font-size:12px;line-height:16px;color:var(--ui-text-secondary,inherit);cursor:pointer}' +
    '[data-hermes-web-folder-picker] .wb-row:hover{background:var(--ui-row-hover-background,rgba(127,127,127,0.16));color:var(--ui-text-primary,inherit)}' +
    '[data-hermes-web-folder-picker] .wb-btn{border:none;border-radius:2.5px;font-family:inherit;font-size:12px;line-height:16px;font-weight:500;padding:4px 10px;cursor:pointer;white-space:nowrap}' +
    '[data-hermes-web-folder-picker] .wb-ghost{background:transparent;color:var(--ui-text-secondary,inherit)}' +
    '[data-hermes-web-folder-picker] .wb-ghost:hover{background:var(--chrome-action-hover,rgba(127,127,127,0.14));color:var(--ui-text-primary,inherit)}' +
    '[data-hermes-web-folder-picker] .wb-primary{background:var(--color-primary,var(--dt-primary,#3b6ef5));color:var(--color-primary-foreground,var(--dt-primary-foreground,#fcfcfc))}' +
    '[data-hermes-web-folder-picker] .wb-primary:hover{filter:brightness(1.08)}';

  function pickerStyles() {
    if (document.getElementById('hermes-web-folder-picker-styles')) return;

    var tag = document.createElement('style');

    tag.id = 'hermes-web-folder-picker-styles';
    tag.textContent = PICKER_CSS;
    document.head.appendChild(tag);
  }

  // The app ships the Codicon font with its own stylesheet, so its folder glyphs are available here.
  function codicon(name) {
    var icon = document.createElement('i');

    icon.className = 'codicon codicon-' + name;
    icon.style.cssText = 'font-size:14px;line-height:1;flex:none';
    return icon;
  }

  function pickerButton(label, onClick, primary) {
    var el = document.createElement('button');

    el.type = 'button';
    el.className = primary ? 'wb-btn wb-primary' : 'wb-btn wb-ghost';
    el.textContent = label;
    el.onclick = onClick;
    return el;
  }

  // Minimal folder browser over the backend's disk. There is no native OS dialog in a browser, and
  // the app's own remote picker (right-sidebar/files/remote-picker.tsx) is not reachable from this
  // bridge — this is the smallest thing that lets the setting be CHOSEN rather than typed. Copy,
  // dimensions and tokens mirror that dialog so it reads as one of the app's windows.
  function pickBackendFolder(start) {
    return new Promise(function (resolve) {
      var current = String(start || '/').trim() || '/';
      var done = false;
      var overlay = document.createElement('div');
      var panel = document.createElement('div');
      var header = document.createElement('div');
      var title = document.createElement('div');
      var desc = document.createElement('div');
      var pathLine = document.createElement('div');
      var list = document.createElement('div');
      var footer = document.createElement('div');

      function close(dir) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(dir);
      }

      function onKey(event) {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close(null);
      }

      function row(label, onClick, dim, icon) {
        var item = document.createElement('div');

        item.className = 'wb-row';
        if (dim) item.style.opacity = '0.5';
        if (icon) item.appendChild(codicon(icon));
        item.appendChild(document.createTextNode(label));
        if (onClick) item.onclick = onClick;
        return item;
      }

      function load() {
        pathLine.textContent = current;
        pathLine.title = current;
        list.textContent = '';
        list.appendChild(row('..', current === '/' ? null : function () { current = parentDir(current); load(); }, true, 'folder'));
        listBackendDirs(current).then(function (dirs) {
          dirs.sort(function (a, b) { return a.name.localeCompare(b.name); });
          if (!dirs.length) list.appendChild(row('This folder is empty.', null, true));
          for (var i = 0; i < dirs.length; i++) {
            (function (entry) {
              list.appendChild(row(entry.name, function () { current = entry.path; load(); }, false, 'folder'));
            })(dirs[i]);
          }
        }, function (error) {
          list.appendChild(row('Could not read this folder (' + (error && error.message || error) + ').', null, true));
        });
      }

      pickerStyles();
      overlay.setAttribute('data-hermes-web-folder-picker', '');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:var(--z-modal,130);display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.22);backdrop-filter:blur(2px)';
      overlay.onclick = function (event) { if (event.target === overlay) close(null); };
      panel.style.cssText = 'display:flex;flex-direction:column;width:100%;max-width:32rem;height:min(36rem,calc(100vh - 4rem));overflow:hidden;border:1px solid var(--stroke-nous,rgba(127,127,127,0.25));border-radius:var(--radius-xl,12px);background:var(--ui-chat-bubble-background,var(--ui-bg-elevated,#1c1c1f));color:var(--ui-text-primary,inherit);box-shadow:0 24px 64px rgba(0,0,0,0.28);font-family:inherit;font-size:13px;line-height:1.45';
      header.style.cssText = 'flex:none;padding:12px 16px;border-bottom:1px solid var(--ui-stroke-secondary,rgba(127,127,127,0.25))';
      title.textContent = 'Choose remote folder';
      title.style.cssText = 'font-size:13px;font-weight:600';
      desc.textContent = 'Browse folders on the connected backend. The choice becomes the default project directory for new sessions.';
      desc.style.cssText = 'margin-top:4px;font-size:12px;color:var(--ui-text-secondary,inherit)';
      pathLine.style.cssText = 'flex:none;padding:8px 12px;border-bottom:1px solid var(--ui-stroke-secondary,rgba(127,127,127,0.25));font-size:12px;color:var(--ui-text-secondary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      list.setAttribute('data-hermes-web-folder-picker-list', '');
      list.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:8px';
      footer.style.cssText = 'flex:none;display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--ui-stroke-secondary,rgba(127,127,127,0.25))';

      footer.appendChild(pickerButton('Cancel', function () { close(null); }));
      footer.appendChild(pickerButton('Select folder', function () { close(current); }, true));
      header.appendChild(title);
      header.appendChild(desc);
      panel.appendChild(header);
      panel.appendChild(pathLine);
      panel.appendChild(list);
      panel.appendChild(footer);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKey, true);
      load();
    });
  }

  // The app-wide default profile route. In Electron it lives in active-profile.json
  // (electron/desktop-profile.ts -> createDesktopProfilePreferences); the renderer reads it at boot
  // (use-gateway-boot -> desktop.profile.getDefault) and watches the $defaultProfileRoute mirror for
  // its new-session target (new-session-route.ts). Storage and validation follow Electron's
  // requireDesktopProfileRoute: same shape, same name rule, and an invalid or missing entry reads as
  // null. Electron's extra check that the connection exists in its registry is dropped here — every
  // route in the web build resolves through this one bridge connection.
  var PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  var DEFAULT_PROFILE_KEY = 'defaultProfileRoute';
  var defaultProfileWatchers = new Set();

  function requireProfileRoute(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A connection and profile route is required.');

    var connectionId = value.connectionId;
    var name = value.profile;

    if (typeof name !== 'string' || !PROFILE_NAME_RE.test(name)) throw new Error('Invalid profile name.');
    if (connectionId !== null && (typeof connectionId !== 'string' || !connectionId || connectionId.trim() !== connectionId)) {
      throw new Error('Invalid connection id.');
    }

    return { connectionId: connectionId, profile: name };
  }

  function getDefaultProfileRoute() {
    try {
      return requireProfileRoute(store.get(DEFAULT_PROFILE_KEY, null));
    } catch (e) {
      return null;
    }
  }

  function setDefaultProfileRoute(value) {
    var route = requireProfileRoute(value);

    store.set(DEFAULT_PROFILE_KEY, route);
    defaultProfileWatchers.forEach(function (watcher) {
      // A subscriber must never make a stored preference look like a failed write.
      try { watcher(route); } catch (e) {}
    });

    return route;
  }

  var bridge = {
    glassSupported: false, translucencySupported: false, localModelsEnabled: false,
    guestOnboardingEnabled: false, skipIntro: true,

    // Read SYNCHRONOUSLY during theme bootstrap, before any Proxy fallback can help: the renderer
    // treats the value as `{skin: {name}, profile}` and calls `.trim()` on `skin.name`. Left
    // undefined, the catch-all Proxy handed back a function stub, the `.trim()` call threw
    // `(e ?? "").trim is not a function` and the interface never finished booting. An explicit null
    // short-circuits the Proxy, and bootstrap falls back to its built-in themes.
    localSkin: null,

    // Settings reads and writes this pair as `get()/set()` returning `{maxMb}` — the Electron
    // shape; a bare number left the size field without a value to show.
    dataUrlReadMax: {
      get: function () { return Promise.resolve({ maxMb: 16 }); },
      set: function (maxMb) { return Promise.resolve({ maxMb: maxMb }); },
    },

    getConnection: function (p) { return connection(p); },
    getConnectionFor: function (payload) { return connection(payload && payload.profile); },
    getGatewayWsUrl: function () { return wsUrl().then(function (url) { return { ok: true, wsUrl: url }; }, function (e) { return { ok: false, error: String(e && e.message || e) }; }); },
    getGatewayWsUrlFor: function () { return bridge.getGatewayWsUrl(); },
    revalidateConnection: function () { return connection(); },
    touchBackend: asyncNoop,
    getProfileRoutes: function () { return Promise.resolve({}); },
    getPoolLimits: function () { return Promise.resolve({}); },
    setPoolLimits: asyncNoop,
    getAgentRoster: function () { return Promise.resolve([]); },
    getBootProgress: function () { return Promise.resolve({ phase: 'ready', percent: 100 }); },
    api: api,
    getVersion: function () {
      // Empty appVersion: the status bar hides the desktop-client version item instead of showing "vweb".
      return Promise.resolve({ appVersion: '', electronVersion: '', nodeVersion: '', platform: navigator.platform || 'web', hermesRoot: '' });
    },
    // The renderer's fire-and-forget diagnostic line. Electron clamps it (electron/main.ts,
    // hermes:logs:renderer-line) and appends it to desktop.log; the notifyError path posts the full
    // stack of an error toast here, because the toast itself shows only the summarized copy, and the
    // onboarding kickoff machine posts its transitions. A browser has no log file, so the frame
    // console IS the log — same clamp, error level so the line survives the DevTools default filter.
    logLine: function (line) {
      var text = typeof line === 'string' ? line.slice(0, 6000) : '';

      if (text) console.error('[hermes-web] ' + text);
    },
    // In-app updates swap the Electron app; in the browser, update Hermes with `hermes update`.
    updates: namespace('updates', {
      check: function () { return Promise.resolve({ supported: false, reason: 'web', message: 'Update Hermes with `hermes update`.' }); },
      apply: unsupported('In-app updates'),
      getBranch: function () { return Promise.resolve({ branch: '' }); },
      setBranch: function () { return Promise.resolve({ branch: '' }); },
      onProgress: unsubscribe,
    }),

    notify: function (payload) {
      try {
        if (!('Notification' in window)) return Promise.resolve(false);
        var show = function () { new Notification((payload && payload.title) || 'Hermes', { body: (payload && payload.body) || '' }); return true; };
        if (Notification.permission === 'granted') return Promise.resolve(show());
        return Notification.requestPermission().then(function (p) { return p === 'granted' ? show() : false; });
      } catch (e) { return Promise.resolve(false); }
    },
    openExternal: function (url) { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve(true); },
    // Use the captured native methods: the page's own override of navigator.clipboard.writeText
    // must not be re-entered from here.
    writeClipboard: function (text) {
      if (!nativeWriteText) return Promise.resolve(false);
      return nativeWriteText(String(text == null ? '' : text)).then(function () { return true; }, function () { return false; });
    },
    readClipboard: function () {
      if (!nativeReadText) return Promise.resolve('');
      return nativeReadText().catch(function () { return ''; });
    },
    requestMicrophoneAccess: function () { return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); return true; }, function () { return false; }); },
    getPathForFile: function (file) { return file ? keep(file, file.name) : ''; },
    selectPaths: function (options) { return pickFiles(options); },
    // Kept blobs first (attachments are virtual paths this browser owns), then the backend's disk
    // over REST — see readFile above. readFileText keeps its old shape: the facade only reaches the
    // native reader in local mode, which the browser never reports.
    readFileDataUrl: readFile,
    readFileDataUrlForAttach: readFile,
    saveGatewayFile: saveGatewayFile,
    readFileText: function (path) { var b = files.get(path); return b ? b.text() : Promise.resolve(null); },
    saveImageBuffer: function (data, ext, name) {
      var type = EXT_TYPES[String(ext || '').toLowerCase()] || 'image/png';
      return Promise.resolve(keep(new Blob([data], { type: type }), name || ('pasted' + (ext || '.png'))));
    },
    saveClipboardImage: function () {
      if (!navigator.clipboard || !navigator.clipboard.read) return Promise.resolve(null);
      return navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var type = items[i].types.find(function (t) { return t.indexOf('image/') === 0; });
          if (type) return items[i].getType(type).then(function (blob) { return keep(blob, 'clipboard.' + type.split('/')[1]); });
        }
        return null;
      }).catch(function () { return null; });
    },
    savePastedText: function (text) { return Promise.resolve(keep(new Blob([String(text)], { type: 'text/plain' }), 'pasted.txt')); },

    // Native OS windows and overlays have no browser equivalent here.
    openSessionWindow: unsupported('Separate windows'),
    openSessionInTerminal: unsupported('Opening a terminal'),
    openWindow: unsupported('Separate windows'),
    openBrowserWindow: unsupported('Browser pop-out'),
    onBrowserPopoutClosed: unsubscribe,
    claimAmbientCue: function () { return Promise.resolve(true); },
    setActiveWork: noop, setTitleBarTheme: noop, setNativeTheme: noop, setTranslucency: noop,
    setKeepAwake: asyncNoop, setPreviewShortcutActive: noop,
    fetchLinkTitle: function () { return Promise.resolve(null); },
    resolveFavicon: function () { return Promise.resolve(null); },
    // Same shape as Electron's: the browser can't check the backend's disk, so the path passes through.
    sanitizeWorkspaceCwd: function (cwd) { return Promise.resolve({ cwd: typeof cwd === 'string' ? cwd.trim() : '', sanitized: false }); },
    readPluginSource: function () { return Promise.resolve(null); },
    // The renderer's journal of uncertain sends. Electron keeps it in a file
    // (`preparedSubmissions.read/update/compareAndSet`); the renderer has a localStorage fallback for
    // when the member is absent — `native ? await native.read() : localStorage`. Declared null so
    // the catch-all Proxy answers null instead of a stub: a stub is truthy, its `read()` resolves to
    // undefined, and `JSON.parse(undefined)` raised "Restore image draft: undefined is not valid
    // JSON" on every chat open.
    preparedSubmissions: null,

    settings: namespace('settings', {
      get: function (key) { return Promise.resolve(store.get(key, undefined)); },
      set: function (key, value) { store.set(key, value); return Promise.resolve(true); },
      // The three members the renderer reads and writes for the default project directory.
      getDefaultProjectDir: getDefaultProjectDir,
      setDefaultProjectDir: setDefaultProjectDir,
      pickDefaultProjectDir: function () {
        return pickBackendFolder(defaultProjectDir || '/').then(function (dir) {
          return dir ? { canceled: false, dir: dir } : { canceled: true, dir: null };
        });
      },
    }),
    // `onDefaultChanged` returns an unsubscribe like every other subscription here, and fires for
    // the other readers in this frame; reads never throw, matching Electron's getDefault, which
    // answers null for an invalid entry too.
    profile: namespace('profile', {
      getDefault: function () { return Promise.resolve(getDefaultProfileRoute()); },
      setDefault: function (route) {
        try { return Promise.resolve(setDefaultProfileRoute(route)); }
        catch (e) { return Promise.reject(e); }
      },
      onDefaultChanged: function (callback) {
        if (typeof callback !== 'function') return noop;

        defaultProfileWatchers.add(callback);

        return function () { defaultProfileWatchers.delete(callback); };
      },
    }),
    // Shapes taken from the renderer: Settings reads `zoom.get().percent`, subscribes with
    // `zoom.onChanged(cb)` and drags the slider through `zoom.setPercent(n)`; the app's overlay
    // path asks for `zoom.factor()`.
    zoom: namespace('zoom', {
      get: function () { return Promise.resolve({ percent: 100, factor: 1 }); },
      set: asyncNoop,
      setPercent: asyncNoop,
      factor: function () { return 1; },
      onChange: unsubscribe,
      onChanged: unsubscribe,
    }),
    wakeIndicator: namespace('wakeIndicator', {
      getState: function () { return Promise.resolve({}); }, setState: noop, onState: unsubscribe,
    }),
    // Native OS windows are gone in the browser, so these stay no-ops — but the renderer calls
    // `control`/`setBounds`/`pushState` and subscribes with `onControl`/`onState`.
    petOverlay: namespace('petOverlay', {}),
    introReveal: namespace('introReveal', {
      open: asyncNoop, close: asyncNoop, skip: noop, ready: noop, onSkip: unsubscribe,
    }),
    chatOnboarding: namespace('chatOnboarding', { grow: noop, soloBoot: noop }),
    // `hud.windowing` is read as a plain data object (nativeDrag/controlDrag/solid/...).
    hud: namespace('hud', { windowing: {} }),

    // The terminal pane (use-terminal-session.ts) reads `window.hermesDesktop.terminal` and calls
    // `start()` first. The Proxy used to answer with a stub, so `start()` resolved to undefined and
    // the pane died with "Cannot read properties of undefined (reading 'id')" — the renderer's own
    // `if (!terminalApi)` guard never fires, because a stub is truthy.
    //
    // There is nothing to fall back on: this pane runs a shell on the computer where the app is
    // installed (node-pty in the Electron main process), and the backend has no interactive-shell
    // endpoint — `/api/pty` runs `hermes --tui` for the chat tab, `/api/console` takes one command at
    // a time. Refuse with a readable reason instead of a TypeError.
    terminal: namespace('terminal', {
      start: function () {
        return Promise.reject(new Error(
          'not available in the browser build — this pane opens a shell on the computer where ' +
            'the app is installed, and the web build runs on the server. Use the desktop app ' +
            '(hermes desktop) for a local terminal.',
        ));
      },
    }),
  };

  // The namespaces the renderer reaches into (`zoom.onChanged`, `petOverlay.control`,
  // `chatOnboarding.size`, ...). A plain object hands back `undefined` for any member that is not
  // listed, and the renderer calls the result immediately — a TypeError inside its error boundary,
  // with the whole section gone. Unknown members go through the same stub() the top-level bridge
  // uses: `on*` names become unsubscribe factories, everything else resolves to undefined.
  function namespace(name, members) {
    return new Proxy(members, {
      get: function (target, key) {
        if (key in target) return target[key];
        if (typeof key !== 'string' || key === 'then') return undefined;
        return stub(name + '.' + key);
      },
    });
  }

  // Anything else: functions resolve to undefined (the renderer treats that as "not available"),
  // `on*` subscriptions return an unsubscribe, namespaces recurse.
  function stub(path) {
    var subscription = /(^|\.)on[A-Z]/.test(path);
    var fn = function () {
      if (!subscription) missing.add(path);
      return subscription ? noop : Promise.resolve(undefined);
    };
    return new Proxy(fn, {
      // `then` stays undefined: a stubbed member that the renderer awaits must not look thenable,
      // or the await never settles.
      get: function (_t, key) { return typeof key === 'string' && key !== 'then' ? stub(path + '.' + key) : undefined; },
    });
  }
  window.hermesDesktop = new Proxy(bridge, {
    get: function (target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string' || key === 'then') return undefined;
      return stub(key);
    },
  });
})();
