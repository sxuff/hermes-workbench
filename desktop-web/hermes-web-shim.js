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
  function readKept(path) {
    var blob = files.get(path);
    return blob ? dataUrlOf(blob) : Promise.resolve(null);
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
    writeClipboard: function (text) { return navigator.clipboard.writeText(String(text == null ? '' : text)).then(function () { return true; }, function () { return false; }); },
    readClipboard: function () { return navigator.clipboard.readText().catch(function () { return ''; }); },
    requestMicrophoneAccess: function () { return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); return true; }, function () { return false; }); },
    getPathForFile: function (file) { return file ? keep(file, file.name) : ''; },
    selectPaths: function (options) { return pickFiles(options); },
    readFileDataUrl: readKept,
    readFileDataUrlForAttach: readKept,
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

    settings: {
      get: function (key) { return Promise.resolve(store.get(key, undefined)); },
      set: function (key, value) { store.set(key, value); return Promise.resolve(true); },
    },
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
