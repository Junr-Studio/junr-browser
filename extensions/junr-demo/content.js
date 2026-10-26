// Marqueur lisible par la page de diagnostic et par le test automatique.
document.documentElement.dataset.junrExt = '1';

window.addEventListener('DOMContentLoaded', () => {
  const badge = document.createElement('div');
  badge.textContent = 'Extension Junr active';
  badge.style.cssText =
    'position:fixed;right:10px;bottom:10px;z-index:2147483647;padding:4px 8px;' +
    'font:12px system-ui,sans-serif;color:#fff;background:#17202bcc;border-radius:4px;pointer-events:none';
  document.body.appendChild(badge);
});
