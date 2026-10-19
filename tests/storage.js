// Start test frames from an empty workbench and restore existing browser data afterwards.
(() => {
  const localKeys = ['chengyi-app-v1', 'chengyi-settings-v1'];
  const savedLocal = localKeys.map(key => [key, localStorage.getItem(key)]);
  const appSessionKeys = () => Object.keys(sessionStorage).filter(key => key.startsWith('chengyi-'));
  const savedSession = appSessionKeys().map(key => [key, sessionStorage.getItem(key)]);
  localKeys.forEach(key => localStorage.removeItem(key));
  appSessionKeys().forEach(key => sessionStorage.removeItem(key));
  let restored = false;
  window.restoreTestStorage = () => {
    if (restored) return;
    restored = true;
    for (const [key, value] of savedLocal) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    appSessionKeys().forEach(key => sessionStorage.removeItem(key));
    for (const [key, value] of savedSession) sessionStorage.setItem(key, value);
  };
  addEventListener('beforeunload', window.restoreTestStorage);
})();
