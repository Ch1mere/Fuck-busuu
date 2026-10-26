(function() {
  if (window.__busuu_helper_injected) return;
  window.__busuu_helper_injected = true;
  const WS = window.WebSocket;
  function WSWrap(url, protocols) {
    const ws = protocols ? new WS(url, protocols) : new WS(url);
    try { ws.addEventListener('open', function() { window.postMessage({ __busuu_helper__: true, type: 'ws_open' }, '*'); }); } catch {}
    ws.addEventListener('message', function(e) {
      try {
        const d = e.data;
        if (typeof d === 'string') {
          let txt = d;
          const idx = Math.min(...[txt.indexOf('{'), txt.indexOf('[')].filter(i => i >= 0));
          if (idx >= 0) txt = txt.slice(idx);
          let obj;
          try { obj = JSON.parse(txt); } catch {}
          if (obj) window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj }, '*');
        } else if (d && typeof d === 'object' && typeof d.text === 'function') {
          d.text().then(txt => {
            try {
              const obj = JSON.parse(txt);
              window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj }, '*');
            } catch {}
          });
        } else if (d && (d instanceof ArrayBuffer)) {
          try {
            const td = new TextDecoder('utf-8');
            const txt = td.decode(new Uint8Array(d));
            const idx = Math.min(...[txt.indexOf('{'), txt.indexOf('[')].filter(i => i >= 0));
            const slice = idx >= 0 ? txt.slice(idx) : txt;
            const obj = JSON.parse(slice);
            window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj }, '*');
          } catch {}
        }
      } catch {}
    });
    return ws;
  }
  WSWrap.prototype = WS.prototype;
  Object.getOwnPropertyNames(WS).forEach(k => { try { WSWrap[k] = WS[k]; } catch {} });
  WSWrap.__busuu_helper_wrap__ = true;
  window.WebSocket = WSWrap;
  setInterval(() => {
    try {
      if (!window.WebSocket.__busuu_helper_wrap__) {
        window.WebSocket = WSWrap;
      }
    } catch {}
  }, 1500);

  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = '';
    let op = '';
    try {
      if (input instanceof Request) {
        url = input.url || '';
        input.clone().text().then(txt => {
          try { const j = JSON.parse(txt); op = j.operationName || ''; } catch {}
        });
      } else {
        url = String(input || '');
        if (init && typeof init.body === 'string') {
          try { const j = JSON.parse(init.body); op = j.operationName || ''; } catch {}
        }
      }
    } catch {}
    return origFetch(input, init).then(res => {
      try {
        const c = res.clone();
        return c.json().then(obj => {
          window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj, op, url }, '*');
          return res;
        }).catch(() => c.text().then(txt => {
          try {
            const obj = JSON.parse(txt);
            window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj, op, url }, '*');
          } catch {}
          return res;
        }).catch(() => res));
      } catch {
        return res;
      }
    });
  };

  const XHR = window.XMLHttpRequest;
  const sendOrig = XHR.prototype.send;
  const openOrig = XHR.prototype.open;
  XHR.prototype.open = function(method, url, async, user, password) {
    this.__busuu_helper_url = url;
    return openOrig.apply(this, arguments);
  };
  XHR.prototype.send = function(body) {
    this.addEventListener('readystatechange', function() {
      try {
        if (this.readyState === 4) {
          const ct = this.getResponseHeader && this.getResponseHeader('content-type') || '';
          if (typeof this.responseText === 'string' && /json/i.test(ct)) {
            let obj;
            try { obj = JSON.parse(this.responseText); } catch {}
            if (obj) {
              window.postMessage({ __busuu_helper__: true, type: 'ws_message', data: obj }, '*');
            }
          }
        }
      } catch {}
    });
    return sendOrig.apply(this, arguments);
  };
})();
