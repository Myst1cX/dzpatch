// ==UserScript==
// @name        dzpatch remastered
// @namespace   https://uhwotgit.fly.dev/uhwot/dzunlock
// @description Removes advertisements, unlocks streaming the full song length, enables Deezer Hi-Fi features
// @author      uh wot (script author), LuftVerbot (media server owner), Myst1cX (replaced media server link, line 168)
// @version     1.4.6.z
// @license     GPL-3.0-only
// @homepageURL https://github.com/Myst1cX/dzpatch
// @supportURL  https://github.com/Myst1cX/dzpatch/issues
// @updateURL   https://raw.githubusercontent.com/Myst1cX/dzpatch/main/dzpatch-remastered.user.js
// @downloadURL https://raw.githubusercontent.com/Myst1cX/dzpatch/main/dzpatch-remastered.user.js
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

const debug = false;

// Lightweight debug logger wrapper; disabled by default (keeps original behavior)
function log(...args) {
  if (debug) {
    console.log(...args);
  }
}

// Safe console helpers used for realtime info logs
function infoSafe(...args) {
  try { console.info(...args); } catch (e) { try { console.log(...args); } catch (_) {} }
}
function warnSafe(...args) {
  try { console.warn(...args); } catch (e) { try { console.log(...args); } catch (_) {} }
}
function errorSafe(...args) {
  try { console.error(...args); } catch (e) { try { console.log(...args); } catch (_) {} }
}

// Safe CSS to avoid visible flashes upon hiding known promotional elements ---
// Runs at document-start and hides specific elements until the precise remover runs.
(function injectImmediateHide() {
  try {
    const css = `
      /* hide known Deezer promo elements until the precise remover runs */
      [data-testid="conversionBanner"], /* "Upgrade & skip ads free for 1 month banner" */
      [data-testid="alert-StreamingNotAllowed"], /* "You can only listen to 30-second clips. Try Deezer Premium!" banner  */
      h2[data-testid="premium_offer_title"] { visibility: hidden !important; } /* "Try Premium free for 1 month" banner */
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    (document.documentElement || document.head || document).appendChild(styleEl);
    // keep a reference available to the rest of the script
    window.__dzpatch_early_style = styleEl;

    infoSafe('[dzpatch][info][realtime] early CSS injected to proactively hide known promo elements', {
      selectors: '[data-testid="conversionBanner"], [data-testid="alert-StreamingNotAllowed"], h2[data-testid="premium_offer_title"]',
      time: Date.now()
    });
  } catch (e) {
    // swallow errors — nothing critical if style injection fails
  }
})();

// Activation regex controls which pages the script runs on.
const activationRegex = /^https:\/\/www\.deezer\.com\/(?:[a-z]{2}\/)?(?:$|account(?:\/|$|\?|#)|offers(?:\/|$|\?|#)|track|album|artist|playlist|episode|show|profile|channels|podcasts|radio)(?:[\/?#]|$)/;

// Guard so the script only initializes once per page context
if (!window.__dzpatch_init_guard) window.__dzpatch_init_guard = { initialized: false };

function shouldActivate(url) {
  try {
    return activationRegex.test(url);
  } catch (e) {
    return false;
  }
}

// Main script logic ((player token patching, ws/fetch wrappers, popup removers) by uh wot (in original  form) ---
function initDzpatch() {
  if (window.__dzpatch_init_guard.initialized) return;
  window.__dzpatch_init_guard.initialized = true;

  // Encryption key and AES cipher used for player token patching
  const playerTokenKey = [102, 228, 95, 242, 215, 50, 122, 26, 57, 216, 206, 38, 164, 237, 200, 85];
  const cipher = new aesjs.ModeOfOperation.ecb(playerTokenKey);

  const quality_to_format = {
    "standard": "MP3_128",
    "high":     "MP3_320",
    "lossless": "FLAC"
  };

  // Small binary/string helpers
  function str2bin(str) {
    return Array.from(str).map(function (item) { return item.charCodeAt(0); });
  }
  function bin2str(bin) {
    return String.fromCharCode.apply(String, bin);
  }

  function decryptHex(hex) {
    hex = aesjs.utils.hex.toBytes(hex);
    return bin2str(cipher.decrypt(hex)).replace(/\0+$/, ''); // remove zero padding
  }
  function encryptHex(str) {
    if (str.length % 16) {
      str += '\x00'.repeat(16 - str.length % 16);
    }
    return aesjs.utils.hex.fromBytes(cipher.encrypt(str2bin(str)));
  }

  // Patch player token JSON once decrypted: enables higher qualities and removes limits
  function playerTokenPatch(playerToken) {
    playerToken = JSON.parse(decryptHex(playerToken));
    playerToken.audio_qualities.wifi_streaming = ['low', 'standard', 'high', 'lossless'];
    playerToken.streaming = true;
    playerToken.limited = false;
    playerToken.radio_skips = 0;
    log(playerToken);
    return encryptHex(JSON.stringify(playerToken));
  }

  // Patch dzPlayer.setTrackList to mark tracks available in higher formats
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
      } catch (e) {
        // swallow; player might be created later
      }
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => setTimeout(patchFunc, 0));
    } else {
      setTimeout(patchFunc, 50);
    }
  }
  registerSetTrackListPatch();

  // WebSocket proxy to intercept certain subscriptions
  unsafeWindow.WebSocket = new Proxy(unsafeWindow.WebSocket, {
    construct: function (target, args, _) {
      const url = args[0];
      const ws = new target(url);

      if (!url.startsWith('wss://live.deezer.com/ws/')) {
        return ws;
      }

      log('hooking websocket');

      return new Proxy(ws, {
        set: function (target, prop, val) { return target[prop] = val; },
        get: function (target, prop) {
          var val = target[prop];
          if (prop == 'send') val = function (data) {
            const json = JSON.parse(data);
            log(json);
            const [ msgType, subId ] = json;
            if (subId.endsWith('_STREAM')) {
              if (msgType === 'sub') {
                log('preventing play action subscription');
                return;
              }
              if (msgType === 'send') {
                log('preventing play action publish');
                return;
              }
            }
            target.send(data);
          };
          else if (typeof val == 'function') val = val.bind(target);
          return val;
        }
      });
    }
  });

  // Fetch wrapper: redirects media requests when needed, patches getUserData & other endpoints
  let last_track_id = null;
  unsafeWindow.fetch = (function (fetch) {
    return async function (url, init) {
      // if site requests media.deezer get_url, possibly route to external media server
      if (url === 'https://media.deezer.com/v1/get_url') {
        let track;
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
        if (track && track.RIGHTS && track.RIGHTS.STREAM_ADS_AVAILABLE !== true && !is_subbed) {
          is_quality_available = false;
        }

        if (id >= 0 && !is_quality_available) {
          const media_server = GM_getValue('media_server', 'https://lufts-dzmedia.fly.dev');
          // original media server: 'https://dzmedia.fly.dev/'
          url = `${media_server}/get_url`;

          const body = {
            formats: ['FLAC', 'MP3_320', 'MP3_128', 'MP3_64', 'MP3_MISC'],
            ids: [id]
          };

          // Keep only formats up to desired quality
          for (let i = 0; i < body.formats.length; i++) {
            if (body.formats[0] !== quality_to_format[quality]) {
              body.formats.shift();
            } else {
              break;
            }
          }

          init = init || {};
          init.body = JSON.stringify(body);
          init.method = init.method || 'POST';
        }
      }

      let resp = await fetch(url, init);

      // Patch various Deezer AJAX endpoints to remove ads or inject modified tokens
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
          try {
            json.results.PLAYER_TOKEN = playerTokenPatch(json.results.PLAYER_TOKEN);
          } catch (e) {
            log('playerTokenPatch failed', e);
          }
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
          try {
            json.results = playerTokenPatch(json.results);
          } catch (e) {
            log('playerTokenPatch failed for log.listen string', e);
          }
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


  // Precise popup & promotion removers
  (function installPreciseRemovers() {
    try {
      if (window.__dzpatch_precise_installed) return;
      window.__dzpatch_precise_installed = true;

      // append minimal CSS to avoid flashes for known elements
      const style = document.createElement('style');
      style.textContent = `
        [data-testid="conversionBanner"],
        [data-testid="alert-StreamingNotAllowed"],
        h2[data-testid="premium_offer_title"] { visibility: hidden !important; }
        .dzpatch-popup-hidden { display:none !important; }
      `;
      document.documentElement.appendChild(style);

      // helper: return removed node element description
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

      // data structures for logging & deduplication
      window.__dzpatch_blockedPopupInfo = window.__dzpatch_blockedPopupInfo || [];
      window.__dzpatch_foundPopupInfo = window.__dzpatch_foundPopupInfo || [];
      const seenNodes = new WeakSet(); // prevents duplicate handling of the same node object

      // store structured info about removed/handled elements
      function recordRemoved(node, reason) {
        try {
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
          infoSafe('[dzpatch][info][realtime] blocked popup element removed', info);
        } catch (e) {
          warnSafe('[dzpatch] removed node (error recording)', e);
        }
      }

      // store structured info about detections (found but not yet handled)
      function recordFound(node, reason) {
        try {
          const info = {
            time: Date.now(),
            reason: reason || '',
            id: node && node.id ? node.id : null,
            dataTestId: node && node.getAttribute ? node.getAttribute('data-testid') : null,
            description: describe(node),
            outerHTMLSnippet: node && node.outerHTML ? node.outerHTML.slice(0,400) : '',
            pageURL: location.href
          };
          window.__dzpatch_foundPopupInfo.push(info);
          infoSafe('[dzpatch][info][realtime] blocked popup element detected', info);
        } catch (e) {
          warnSafe('[dzpatch] found node (error recording)', e);
        }
      }

      // Remove conversionBanner elements
      function removeConversionBanner(node) {
        try {
          const elements = node ? [node] : Array.from(document.querySelectorAll('[data-testid="conversionBanner"]'));
          elements.forEach(el => {
            if (!el || seenNodes.has(el)) return;
            seenNodes.add(el);
            recordFound(el, 'conversionBanner_found');
            const id = el.id || '(no-id)';
            infoSafe(`[dzpatch][info][realtime] removing conversionBanner id=${id} desc=${describe(el)}`);
            recordRemoved(el, 'conversionBanner');
            el.remove();
          });
        } catch (e) {}
      }

      // Remove streaming-not-allowed alerts
      function removeStreamingAlert(node) {
        try {
          const elements = node ? [node] : Array.from(document.querySelectorAll('[data-testid="alert-StreamingNotAllowed"]'));
          elements.forEach(el => {
            if (!el || seenNodes.has(el)) return;
            seenNodes.add(el);
            recordFound(el, 'alert-StreamingNotAllowed_found');
            const id = el.id || '(no-id)';
            infoSafe(`[dzpatch][info][realtime] removing alert-StreamingNotAllowed id=${id} desc=${describe(el)}`);
            recordRemoved(el, 'alert-StreamingNotAllowed');
            el.remove();
          });
        } catch (e) {}
      }

      // Remove premium offer modal by locating its title or container
      function removePremiumModal(nodeTitle) {
        try {
          const titles = nodeTitle ? [nodeTitle] : Array.from(document.querySelectorAll('h2[data-testid="premium_offer_title"]'));
          titles.forEach(title => {
            if (!title) return;
            const dialog = title.closest('section[role="dialog"], [aria-modal="true"], .chakra-modal__content, .chakra-portal');
            const modalRoot = (dialog && (dialog.closest('.chakra-portal') || dialog)) || title.parentElement;
            const candidate = modalRoot && modalRoot !== document.documentElement && modalRoot.id !== 'dzr-app' ? modalRoot : title.parentElement;
            if (!candidate || seenNodes.has(candidate)) return;
            seenNodes.add(candidate);
            recordFound(candidate, 'premium_modal_found');
            const id = candidate.id || '(no-id)';
            infoSafe(`[dzpatch][info][realtime] removing premium modal id=${id} desc=${describe(candidate)}`);
            recordRemoved(candidate, 'premium_modal');
            candidate.remove();
          });
        } catch (e) {}
      }

      // Unified handler invoked for each added DOM node via MutationObserver
      function handleNode(node) {
        try {
          if (!node || node.nodeType !== 1) return;

          // direct matches
          if (node.matches && node.matches('[data-testid="conversionBanner"]')) {
            removeConversionBanner(node); return;
          }
          if (node.matches && node.matches('[data-testid="alert-StreamingNotAllowed"]')) {
            removeStreamingAlert(node); return;
          }
          if (node.matches && node.matches('h2[data-testid="premium_offer_title"]')) {
            removePremiumModal(node); return;
          }

          // deeper matches inside added subtree
          if (node.querySelector && node.querySelector('[data-testid="conversionBanner"]')) {
            node.querySelectorAll('[data-testid="conversionBanner"]').forEach(el => removeConversionBanner(el));
            return;
          }
          if (node.querySelector && node.querySelector('[data-testid="alert-StreamingNotAllowed"]')) {
            node.querySelectorAll('[data-testid="alert-StreamingNotAllowed"]').forEach(el => removeStreamingAlert(el));
            return;
          }
          if (node.querySelector && node.querySelector('h2[data-testid="premium_offer_title"]')) {
            node.querySelectorAll('h2[data-testid="premium_offer_title"]').forEach(el => removePremiumModal(el));
            return;
          }
        } catch (e) {
          // ignore per-node errors
        }
      }

      // initial pass: handle any existing matches on startup (also logs)
      try {
        removeConversionBanner();
        removePremiumModal();
        removeStreamingAlert();
      } catch (e) {}

      // Observe DOM mutations and handle new nodes in realtime
      const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            try {
              handleNode(node);
            } catch (e) {
              // ignore per-node errors
            }
          }
        }
      });

      observer.observe(document.documentElement || document, { childList: true, subtree: true });

      // expose simple API for debugging and control
      window.__dzpatch_precise = {
        stop: function() { try { observer.disconnect(); } catch(e){} },
        getBlockedInfo: function() { return window.__dzpatch_blockedPopupInfo || []; },
        getFoundInfo: function() { return window.__dzpatch_foundPopupInfo || []; }
      };
    } catch (e) {
      errorSafe('dzpatch precise remover install failed', e);
    }
  })();

} // end initDzpatch

// Activate immediately if current URL matches
try {
  if (shouldActivate(location.href)) {
    initDzpatch();
  }
} catch (e) { /* ignore */ }

// SPA navigation watcher (observing page changes made by clicking around the website - where the user did not refresh the page)
(function () {
  const origPush = history.pushState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
  };
  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
  };
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('hashchange', () => window.dispatchEvent(new Event('locationchange')));

  // fallback: observe DOM mutations to detect SPA router changes that may not emit history events
  const observer = new MutationObserver(() => {
    try {
      if (shouldActivate(location.href)) initDzpatch();
    } catch (e) {}
  });
  try {
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {
    // ignore if observe fails early
  }

  window.addEventListener('locationchange', () => {
    try {
      if (shouldActivate(location.href)) initDzpatch();
    } catch (e) {}
  });
})();
