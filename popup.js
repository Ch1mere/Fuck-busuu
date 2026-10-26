function updateStatus() {
  chrome.storage.sync.get(['enabled', 'consent'], v => {
    const s = document.getElementById('status');
    const e = !!v.enabled;
    const c = !!v.consent;
    s.textContent = e && c ? 'Actif sur busuu.com' : 'Inactif';
  });
}

function init() {
  const enabled = document.getElementById('enabled');
  const consent = document.getElementById('consent');
  const semiAuto = document.getElementById('semiAuto');
  const delayMode = document.getElementById('delayMode');
  const debug = document.getElementById('debug');
  chrome.storage.sync.get(['enabled', 'consent', 'semiAuto', 'delayMode', 'debug'], v => {
    enabled.checked = !!v.enabled;
    consent.checked = !!v.consent;
    semiAuto.checked = !!v.semiAuto;
    delayMode.checked = !!v.delayMode;
    debug.checked = !!v.debug;
    updateStatus();
  });
  enabled.addEventListener('change', () => {
    chrome.storage.sync.get(['consent'], v => {
      const c = !!v.consent;
      if (!c && enabled.checked) {
        enabled.checked = false;
      }
      chrome.storage.sync.set({ enabled: enabled.checked });
      updateStatus();
    });
  });
  consent.addEventListener('change', () => {
    chrome.storage.sync.set({ consent: consent.checked }, () => {
      if (!consent.checked) {
        enabled.checked = false;
        chrome.storage.sync.set({ enabled: false });
      }
      updateStatus();
    });
  });
  semiAuto.addEventListener('change', () => {
    if (semiAuto.checked) {
      delayMode.checked = false;
      chrome.storage.sync.set({ delayMode: false });
    }
    chrome.storage.sync.set({ semiAuto: semiAuto.checked });
  });
  delayMode.addEventListener('change', () => {
    if (delayMode.checked) {
      semiAuto.checked = false;
      chrome.storage.sync.set({ semiAuto: false });
    }
    chrome.storage.sync.set({ delayMode: delayMode.checked });
  });
  debug.addEventListener('change', () => {
    chrome.storage.sync.set({ debug: debug.checked });
  });
}

document.addEventListener('DOMContentLoaded', init);
