// ==UserScript==
// @name        dzpatch remaster 
// @namespace   https://uhwotgit.fly.dev/uhwot/dzunlock
// @description Removes advertisements, unlocks streaming the full song length, enables Deezer Hi-Fi features
// @author      uh wot (script author), LuftVerbot (media server owner), Myst1cX (replaced media server link, line 168)
// @version     1.4.6.extra
// @license     GPL-3.0-only
// @homepageURL https://github.com/Myst1cX/dzpatch
// @supportURL  https://github.com/Myst1cX/dzpatch/issues
// @updateURL   https://raw.githubusercontent.com/Myst1cX/dzpatch/main/dzpatch-remaster.user.js
// @downloadURL https://raw.githubusercontent.com/Myst1cX/dzpatch/main/dzpatch-remaster.user.js
// @icon        https://cdns-files.dzcdn.net/cache/images/common/favicon/favicon-96x96.852baf648e79894b668670e115e4a375.png
// @include     /^https:\/\/www\.deezer\.com\/[a-z]{2}\/($|track|album|artist|playlist|episode|show|profile|channels|podcasts|radio|\?|#)/
// @match       https://www.deezer.com/*
// @match       https://www.deezer.com/search/*
// @match       https://www.deezer.com/account/*
// @match       https://www.deezer.com/concert/*
// @match       https://www.deezer.com/smarttracklist/*
// @require     https://cdnjs.cloudflare.com/ajax/libs/aes-js/3.1.2/index.min.js
// @grant       GM_getValue
// @run-at      document-start
// ==/UserScript==

const debug = false
function log(...args){ if (debug) return console.log(...args) }


// Ensure global log array exists and helper to create records in the same format used later
window.__dzpatch_blockedPopupInfo = window.__dzpatch_blockedPopupInfo || [];
function describeForLog(el) {
  if (!el || el.nodeType !== 1) return '';
  const parts = [];
  if (el.id) parts.push('#' + el.id);
  if (el.className && typeof el.className === 'string') {
    const cls = String(el.className).trim().split(/\s+/).slice(0,3).join('.');
    if (cls) parts.push('.' + cls);
  }
  parts.push((el.tagName || '').toLowerCase());
  return parts.join(' ');
}
function pushBlockedInfo(node, reason) {
  try {
    window.__dzpatch_blockedPopupInfo = window.__dzpatch_blockedPopupInfo || [];
    const info = {
      time: Date.now(),
      reason: reason || '',
      id: node && node.id ? node.id : null,
      dataTestId: node && node.getAttribute ? node.getAttribute('data-testid') : null,
      description: describeForLog(node),
      outerHTMLSnippet: node && node.outerHTML ? node.outerHTML.slice(0,400) : '',
      pageURL: location.href
    };
    window.__dzpatch_blockedPopupInfo.push(info);
    console.warn('[dzpatch] removed node:', info);
  } catch (e) {
    console.warn('[dzpatch] removed node (error recording)', e);
  }
}

function removeModalRootFromTitle(titleNode) {
    try {
      const dialog = titleNode.closest('section[role="dialog"], [aria-modal="true"], .chakra-modal__content, .chakra-portal');
      const modalRoot = (dialog && (dialog.closest('.chakra-portal') || dialog)) || titleNode.parentElement;
      if (modalRoot && modalRoot.id !== 'dzr-app') {
        const id = modalRoot.id || '(no-id)';
        console.info(`[dzpatch] removing premium modal id=${id} desc=${describeForLog(modalRoot)}`);
        pushBlockedInfo(modalRoot, 'early_premium_modal');
        modalRoot.remove();
        return true;
      }
      // fallback: hide title
      console.info(`[dzpatch] hiding premium title desc=${describeForLog(titleNode)}`);
      pushBlockedInfo(titleNode, 'early_premium_title_hidden');
      titleNode.classList.add('dzpatch-popup-hidden');
      return true;
    } catch (e) {}
    return false;
  }


(function injectImmediateHideAndLog() {
  try {
    // create early style element but don't assume head exists
    const css = `
      /* hide known Deezer promo elements until the precise remover runs */
      [data-testid="conversionBanner"],
      [data-testid="alert-StreamingNotAllowed"],
      h2[data-testid="premium_offer_title"] { visibility: hidden !important; }
      .dzpatch-popup-hidden { display:none !important; }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    // store reference early; append when documentElement or head becomes available
    window.__dzpatch_early_style = s;
  } catch (e) {}

  // ensure global log store exists
  window.__dzpatch_blockedPopupInfo = window.__dzpatch_blockedPopupInfo || [];

  function safeAppendEarlyStyle() {
    try {
      const s = window.__dzpatch_early_style;
      if (!s) return;
      if (document.documentElement) {
        // prefer head if available to keep styles central
        const target = document.head || document.documentElement;
        if (!target.contains(s)) target.appendChild(s);
      }
    } catch (e) {}
  }

  // helper - describe node succinctly
  function describeNode(el) {
    if (!el || el.nodeType !== 1) return '';
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string') ? '.' + String(el.className).trim().split(/\s+/).slice(0,3).join('.') : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function recordEarly(node, reason) {
    try {
      const info = {
        time: Date.now(),
        reason: reason || '',
        id: node && node.id ? node.id : null,
        dataTestId: node && node.getAttribute ? node.getAttribute('data-testid') : null,
        description: describeNode(node),
        outerHTMLSnippet: node && node.outerHTML ? node.outerHTML.slice(0,400) : '',
        pageURL: location.href,
        early: true
      };
      window.__dzpatch_blockedPopupInfo.push(info);
      console.info('[dzpatch early] removed node', info);
    } catch (e) {
      try { console.info('[dzpatch early] removed node (error recording)', e); } catch(e2){}
    }
  }

  // selectors that we target early
  const SELECTORS = [
    '[data-testid="conversionBanner"]',
    '[data-testid="alert-StreamingNotAllowed"]',
    'h2[data-testid="premium_offer_title"]'
  ];

  // perform immediate scan when documentElement exists; if not, wait for it
  function immediateScanAndRemove() {
    try {
      safeAppendEarlyStyle();
    } catch (e) {}

    let didRemove = false;
    try {
      for (const sel of SELECTORS) {
        const nodes = Array.from(document.querySelectorAll(sel || ''));
        for (const node of nodes) {
          try {
            if (!node || node.nodeType !== 1) continue;
            if (sel.startsWith('h2')) {
              // target premium modal: remove modal root if found
              const dialog = node.closest('section[role="dialog"], [aria-modal="true"], .chakra-modal__content, .chakra-portal');
              const modalRoot = (dialog && (dialog.closest('.chakra-portal') || dialog)) || node.parentElement;
              if (modalRoot && modalRoot.id !== 'dzr-app') {
                recordEarly(modalRoot, 'early_premium_modal');
                modalRoot.remove();
                didRemove = true;
                continue;
              }
              // fallback: hide the title
              recordEarly(node, 'early_premium_title_hidden');
              node.classList.add('dzpatch-popup-hidden');
              didRemove = true;
            } else {
              recordEarly(node, 'early_banner_or_alert_removed');
              node.remove();
              didRemove = true;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // if something was removed, auto-remove early style (so we don't keep hidden state)
    if (didRemove) {
      try {
        const s = window.__dzpatch_early_style;
        if (s && s.parentNode) {
          s.parentNode.removeChild(s);
          window.__dzpatch_early_style_removed = true;
          console.info('[dzpatch early] removed early style after first removal');
        }
      } catch (e) {}
    }
    return didRemove;
  }

  // wait for documentElement if necessary (very early script execution)
  if (!document.documentElement) {
    const deInt = setInterval(() => {
      if (document.documentElement) {
        clearInterval(deInt);
        try { immediateScanAndRemove(); } catch(e){}
      }
    }, 8);
    // safety timeout
    setTimeout(() => { try { clearInterval(deInt); } catch(e){} }, 3000);
  } else {
    // run immediately
    try { immediateScanAndRemove(); } catch(e){}
  }

  // short-lived observer (6s) to catch elements that appear soon after initial render
  try {
    const shortObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          try {
            if (!added || added.nodeType !== 1) continue;
            for (const sel of SELECTORS) {
              try {
                // added node matches selector or contains matching subtree
                const matched = (added.matches && added.matches(sel)) ? added : (added.querySelector && added.querySelector(sel));
                if (!matched) continue;
                if (sel.startsWith('h2')) {
                  const title = matched;
                  const dialog = title.closest('section[role="dialog"], [aria-modal="true"], .chakra-modal__content, .chakra-portal');
                  const modalRoot = (dialog && (dialog.closest('.chakra-portal') || dialog)) || title.parentElement;
                  if (modalRoot && modalRoot.id !== 'dzr-app') {
                    recordEarly(modalRoot, 'short-observer_premium_modal');
                    modalRoot.remove();
                  } else {
                    recordEarly(title, 'short-observer_premium_title_hidden');
                    title.classList.add('dzpatch-popup-hidden');
                  }
                } else {
                  const el = matched;
                  recordEarly(el, 'short-observer_banner_alert');
                  if (el && el.remove) el.remove();
                }
                // after any removal, remove early style to restore normal rendering
                try {
                  const s = window.__dzpatch_early_style;
                  if (s && s.parentNode) {
                    s.parentNode.removeChild(s);
                    window.__dzpatch_early_style_removed = true;
                    console.info('[dzpatch early] removed early style after observer removal');
                  }
                } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    });
    shortObserver.observe(document.documentElement || document, { childList: true, subtree: true });
    setTimeout(() => {
      try { shortObserver.disconnect(); } catch (e) {}
    }, 6000);
  } catch (e) {}

})();

// Activation regex:
const activationRegex = /^https:\/\/www\.deezer\.com\/(?:[a-z]{2}\/)?(?:$|account(?:\/|$|\?|#)|offers(?:\/|$|\?|#)|track|album|artist|playlist|episode|show|profile|channels|podcasts|radio)(?:[\/?#]|$)/;

// Guard to prevent double initialization in one page context
if (!window.__dzpatch_init_guard) window.__dzpatch_init_guard = { initialized: false };

function shouldActivate(url) {
  try {
    return activationRegex.test(url);
  } catch (e) {
    return false;
  }
}

// The main init function (keeps previous precise removers, token patches, fetch override)
function initDzpatch() {
  if (window.__dzpatch_init_guard.initialized) return;
  window.__dzpatch_init_guard.initialized = true;

  // If early style still exists (unlikely after early removal), remove it now
  try {
    const s = window.__dzpatch_early_style;
    if (s && s.parentNode) {
      s.parentNode.removeChild(s);
      window.__dzpatch_early_style_removed = true;
    }
  } catch (e) {}

  const playerTokenKey = [102, 228, 95, 242, 215, 50, 122, 26, 57, 216, 206, 38, 164, 237, 200, 85];
  const cipher = new aesjs.ModeOfOperation.ecb(playerTokenKey);

  const quality_to_format = {
    "standard": "MP3_128",
    "high": "MP3_320",
    "lossless": "FLAC"
  };

  function str2bin(str) { return Array.from(str).map(i=>i.charCodeAt(0)); }
  function bin2str(bin) { return String.fromCharCode.apply(String, bin); }

  function decryptHex(hex) {
    hex = aesjs.utils.hex.toBytes(hex);
    return bin2str(cipher.decrypt(hex)).replace(/\0+$/, '');
  }

  function encryptHex(str) {
    if (str.length % 16) str += '\x00'.repeat(16 - str.length % 16);
    return aesjs.utils.hex.fromBytes(cipher.encrypt(str2bin(str)));
  }

  function playerTokenPatch(playerToken) {
    playerToken = JSON.parse(decryptHex(playerToken));
    playerToken.audio_qualities.wifi_streaming = ['low', 'standard', 'high', 'lossless'];
    playerToken.streaming = true;
    playerToken.limited = false;
    playerToken.radio_skips = 0;
    log(playerToken);
    return encryptHex(JSON.stringify(playerToken));
  }

  // setTrackList patch registration (unchanged)
  function registerSetTrackListPatch() {
    const patchFunc = function () {
      try {
        if (!unsafeWindow.dzPlayer || !unsafeWindow.dzPlayer.setTrackList) return;
        if (unsafeWindow.dzPlayer.__dzpatch_setTrackList_patched) return;
        unsafeWindow.dzPlayer.setTrackList = (function (old) {
          return function (data, ...args) {
            for (let i = 0; i < data.data.length; i++) {
              const id = parseInt(data.data[i].SNG_ID);
              if (id >= 0) {
                data.data[i].FILESIZE_MP3_320 = '1';
                data.data[i].FILESIZE_FLAC = '1';
              }
            }
            log(data);
            return old(data, ...args);
          };
        })(unsafeWindow.dzPlayer.setTrackList);
        unsafeWindow.dzPlayer.__dzpatch_setTrackList_patched = true;
      } catch (e) {}
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => { setTimeout(patchFunc, 0); });
    } else {
      setTimeout(patchFunc, 50);
    }
  }

  registerSetTrackListPatch();

  // WebSocket proxy & fetch wrapper (kept same behavior as before)
  unsafeWindow.WebSocket = new Proxy(unsafeWindow.WebSocket, {
    construct(target, args, _) {
      const url = args[0];
      const ws = new target(url);
      if (!url.startsWith('wss://live.deezer.com/ws/')) return ws;
      log('hooking websocket');
      return new Proxy(ws, {
        set(t, prop, val) { return t[prop] = val; },
        get(t, prop) {
          var val = t[prop];
          if (prop == 'send') val = function (data) {
            const json = JSON.parse(data);
            log(json);
            const [msgType, subId] = json;
            if (subId && subId.endsWith && subId.endsWith('_STREAM')) {
              if (msgType === 'sub') return;
              if (msgType === 'send') return;
            }
            t.send(data);
          };
          else if (typeof val == 'function') val = val.bind(t);
          return val;
        }
      });
    }
  });

  let last_track_id = null;

  unsafeWindow.fetch = (function (fetch) {
    return async function (url, init) {
      if (url === 'https://media.deezer.com/v1/get_url') {
        let track = null;
        try {
          if (last_track_id !== unsafeWindow.dzPlayer.getSongId()) {
            track = unsafeWindow.dzPlayer.getCurrentSong();
          } else {
            track = unsafeWindow.dzPlayer.getNextSong();
          }
        } catch (e) {}
        if (track && track.SNG_ID) last_track_id = track.SNG_ID;
        const quality = (unsafeWindow.dzPlayer && unsafeWindow.dzPlayer.control && unsafeWindow.dzPlayer.control.getAudioQuality && unsafeWindow.dzPlayer.control.getAudioQuality()) || 'standard';
        const id = track ? parseInt(track.SNG_ID) : -1;
        let is_subbed = !(unsafeWindow.dzPlayer && unsafeWindow.dzPlayer.user_status && unsafeWindow.dzPlayer.user_status.can_subscribe === true);
        let is_quality_available = unsafeWindow.dzPlayer && unsafeWindow.dzPlayer.user_status && unsafeWindow.dzPlayer.user_status.audio_qualities && Array.isArray(unsafeWindow.dzPlayer.user_status.audio_qualities.wifi_download) && unsafeWindow.dzPlayer.user_status.audio_qualities.wifi_download.includes(quality);
        if (track && track.RIGHTS && track.RIGHTS.STREAM_ADS_AVAILABLE !== true && !is_subbed) is_quality_available = false;
        if (id >= 0 && !is_quality_available) {
          const media_server = GM_getValue('media_server', 'https://lufts-dzmedia.fly.dev');
          url = `${media_server}/get_url`;
          const body = { formats: ['FLAC', 'MP3_320', 'MP3_128', 'MP3_64', 'MP3_MISC'], ids: [id] };
          for (let i = 0; i < body.formats.length; i++) {
            if (body.formats[0] !== quality_to_format[quality]) body.formats.shift();
            else break;
          }
          init = init || {};
          init.body = JSON.stringify(body);
          init.method = init.method || 'POST';
        }
      }

      let resp = await fetch(url, init);

      if (url.startsWith('https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData')) {
        const json = await resp.json();
        if (json.results && json.results.USER) {
          json.results.USER.ENTRYPOINTS = {};
          json.results.OFFER_ID = 600;
          if (json.results.USER.OPTIONS) {
            json.results.USER.OPTIONS.ads_display = false;
            json.results.USER.OPTIONS.ads_audio = false;
          }
        }
        if (json.results && json.results.PLAYER_TOKEN) {
          try { json.results.PLAYER_TOKEN = playerTokenPatch(json.results.PLAYER_TOKEN); } catch (e) { log('playerTokenPatch failed', e); }
        }
        log(json);
        resp = new Response(JSON.stringify(json), resp);
      } else if (url.startsWith('https://www.deezer.com/ajax/gw-light.php?method=deezer.userMenu')) {
        const json = await resp.json();
        delete json.results.MARKETING_PUSH;
        delete json.results.MARKETING_PUSH_DATA;
        resp = new Response(JSON.stringify(json), resp);
      } else if (url.startsWith('https://www.deezer.com/ajax/gw-light.php?method=log.listen')) {
        const json = await resp.json();
        if (typeof json.results === 'string') {
          try { json.results = playerTokenPatch(json.results); } catch (e) { log('playerTokenPatch failed for log.listen string', e); }
        }
        resp = new Response(JSON.stringify(json), resp);
      } else if (url.startsWith('https://www.deezer.com/ajax/gw-light.php?method=appcusto.getData')) {
        const json = await resp.json();
        if (json.results) json.results.events = {};
        resp = new Response(JSON.stringify(json), resp);
      }

      return resp;
    };
  })(unsafeWindow.fetch);

  // === precise popup & promo removers (replaces old 30s text-search removal) ===
  (function installPreciseRemovers() {
    try {
      if (window.__dzpatch_precise_installed) return;
      window.__dzpatch_precise_installed = true;

      // minimal CSS while we remove
      const style = document.createElement('style');
      style.textContent = `
        [data-testid="conversionBanner"],
        [data-testid="alert-StreamingNotAllowed"],
        h2[data-testid="premium_offer_title"] { visibility: hidden !important; }
        .dzpatch-popup-hidden { display:none !important; }
      `;
      document.documentElement.appendChild(style);

      function describe(el) {
        if (!el || el.nodeType !== 1) return '';
        const parts = [];
        if (el.id) parts.push('#' + el.id);
        if (el.className) {
          const cls = String(el.className).trim().split(/\s+/).slice(0,3).join('.');
          if (cls) parts.push('.' + cls);
        }
        parts.push(el.tagName.toLowerCase());
        return parts.join(' ');
      }

      function recordRemoved(node, reason) {
        try {
          window.__dzpatch_blockedPopupInfo = window.__dzpatch_blockedPopupInfo || [];
          const info = {
            time: Date.now(),
            reason: reason || '',
            id: node && node.id ? node.id : null,
            dataTestId: node && node.getAttribute ? node.getAttribute('data-testid') : null,
            description: describe(node),
            outerHTMLSnippet: node && node.outerHTML ? node.outerHTML.slice(0,400) : '',
            pageURL: location.href
          };
          window.__dzpatch_blockedPopupInfo.push(info);
          console.warn('[dzpatch] removed node:', info);
        } catch (e) {
          console.warn('[dzpatch] removed node (error recording)', e);
        }
      }

      function removeConversionBanner() {
        try {
          document.querySelectorAll('[data-testid="conversionBanner"]').forEach(el => {
            const id = el.id || '(no-id)';
            console.info(`[dzpatch] removing conversionBanner id=${id} desc=${describe(el)}`);
            recordRemoved(el, 'conversionBanner');
            el.remove();
          });
        } catch (e) {}
      }

      function removeStreamingAlert() {
        try {
          document.querySelectorAll('[data-testid="alert-StreamingNotAllowed"]').forEach(el => {
            const id = el.id || '(no-id)';
            console.info(`[dzpatch] removing alert-StreamingNotAllowed id=${id} desc=${describe(el)}`);
            recordRemoved(el, 'alert-StreamingNotAllowed');
            el.remove();
          });
        } catch (e) {}
      }

      function removePremiumModal() {
        try {
          document.querySelectorAll('h2[data-testid="premium_offer_title"]').forEach(title => {
            const dialog = title.closest('section[role="dialog"], [aria-modal="true"], .chakra-modal__content, .chakra-portal');
            const modalRoot = (dialog && (dialog.closest('.chakra-portal') || dialog)) || title.parentElement;
            if (modalRoot && modalRoot !== document.documentElement && modalRoot.id !== 'dzr-app') {
              const id = modalRoot.id || '(no-id)';
              console.info(`[dzpatch] removing premium modal id=${id} desc=${describe(modalRoot)}`);
              recordRemoved(modalRoot, 'premium_modal');
              modalRoot.remove();
            } else {
              const parent = title.parentElement;
              if (parent && parent.id !== 'dzr-app') {
                const id2 = parent.id || '(no-id)';
                console.info(`[dzpatch] removing premium modal fallback parent id=${id2} desc=${describe(parent)}`);
                recordRemoved(parent, 'premium_modal_fallback');
                parent.remove();
              }
            }
          });
        } catch (e) {}
      }

      // initial cleanup
      try {
        removeConversionBanner();
        removePremiumModal();
        removeStreamingAlert();
      } catch (e) {}

      const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            try {
              if (!node || node.nodeType !== 1) continue;
              if (node.matches && node.matches('[data-testid="conversionBanner"]')) {
                removeConversionBanner();
                continue;
              }
              if (node.matches && node.matches('[data-testid="alert-StreamingNotAllowed"]')) {
                removeStreamingAlert();
                continue;
              }
              if (node.querySelector && node.querySelector('h2[data-testid="premium_offer_title"]')) {
                removePremiumModal();
                continue;
              }
              if (node.matches && node.matches('h2[data-testid="premium_offer_title"]')) {
                removePremiumModal();
                continue;
              }
            } catch (e) {}
          }
        }
      });

      observer.observe(document.documentElement || document, { childList: true, subtree: true });

      window.__dzpatch_precise = {
        stop: function() { try { observer.disconnect(); } catch(e){} },
        getBlockedInfo: function() { return window.__dzpatch_blockedPopupInfo || []; }
      };
    } catch (e) {
      console.error('dzpatch precise remover install failed', e);
    }
  })();

} // end initDzpatch

// Activate immediately if current URL matches
try {
  if (shouldActivate(location.href)) {
    initDzpatch();
  }
} catch (e) {}

// SPA navigation watcher: history hooks + popstate + hashchange (page changes without refreshing)
(function () {
  const origPush = history.pushState;
  history.pushState = function (...args) { origPush.apply(this, args); window.dispatchEvent(new Event('locationchange')); };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) { origReplace.apply(this, args); window.dispatchEvent(new Event('locationchange')); };
  window.addEventListener('popstate', () => { window.dispatchEvent(new Event('locationchange')); });
  window.addEventListener('hashchange', () => { window.dispatchEvent(new Event('locationchange')); });

  // fallback observer to trigger initDzpatch when SPA changes URLs without history hooks
  const observer = new MutationObserver(() => {
    try { if (shouldActivate(location.href)) initDzpatch(); } catch (e) {}
  });
  try { observer.observe(document.documentElement || document, { childList: true, subtree: true }); } catch (e) {}

  window.addEventListener('locationchange', () => {
    try { if (shouldActivate(location.href)) initDzpatch(); } catch (e) {}
  });
})();