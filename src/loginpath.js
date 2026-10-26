'use strict';
// Chemins qui ressemblent à une page de connexion : sert au test de portabilité du partage (src/share.js)
// et à la détection d'une connexion demandée dans un outil (src/signals.js).
const LOGIN_PATH = /(^|[/_-])(log-?in|sign-?in|sign-?on|sso|auth(orize|enticate)?|connexion|connect|identification)([/_.?-]|$)/i;

// Vrai si `url` est une page de connexion alors que `reference` (l'adresse de l'outil) n'en est pas une.
function isLoginRedirect(url, reference) {
  try {
    const u = new URL(url), r = new URL(reference);
    return LOGIN_PATH.test(u.pathname) && !LOGIN_PATH.test(r.pathname);
  } catch { return false; }
}

module.exports = { LOGIN_PATH, isLoginRedirect };
