// Runs at document_start - injects script tag into page to patch XHR in MAIN world
(function() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const _orig = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (name === 'Authorization' && value && value.startsWith('Bearer ')) {
          window.__freefit_cx_token = value;
          window.dispatchEvent(new CustomEvent('__freefit_token', { detail: value }));
        }
        return _orig.apply(this, arguments);
      };
      console.log('[FreeFit] XHR interceptor active ✓');
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
})();
