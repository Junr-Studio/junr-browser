'use strict';
// Motifs d'URL des extensions (host_permissions, matches) et filtres webNavigation.

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// "https://*.example.com/path/*", "*://host/*", "<all_urls>"
function matchPattern(pattern, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file):$/.test(u.protocol);
  const m = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)?$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, pathPat = '/*'] = m;
  const proto = u.protocol.slice(0, -1);
  if (scheme === '*' ? !/^(https?|wss?)$/.test(proto) : scheme !== proto) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
    } else if (u.hostname !== host) return false;
  }
  return new RegExp('^' + pathPat.split('*').map(escapeRe).join('.*') + '$').test(u.pathname + u.search);
}

const isHostPattern = (p) => typeof p === 'string' && (p === '<all_urls>' || /^(\*|https?|wss?|ftp|file):\/\//.test(p));

// Domaine d'un cookie ('.example.com' ou 'example.com') contre un motif d'hôte.
function hostCoversDomain(pattern, domain) {
  const d = domain.replace(/^\./, '');
  return matchPattern(pattern, `https://${d}/`) || matchPattern(pattern, `http://${d}/`);
}

function safeRe(src) { try { return new RegExp(src); } catch { return null; } }

// UrlFilter de chrome.events (webNavigation) appliqué à une URL.
function urlFilterMatches(f, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const failed = [
    f.hostEquals !== undefined && u.hostname !== f.hostEquals,
    f.hostContains !== undefined && !u.hostname.includes(f.hostContains),
    f.hostPrefix !== undefined && !u.hostname.startsWith(f.hostPrefix),
    f.hostSuffix !== undefined && !u.hostname.endsWith(f.hostSuffix),
    f.pathEquals !== undefined && u.pathname !== f.pathEquals,
    f.pathContains !== undefined && !u.pathname.includes(f.pathContains),
    f.pathPrefix !== undefined && !u.pathname.startsWith(f.pathPrefix),
    f.pathSuffix !== undefined && !u.pathname.endsWith(f.pathSuffix),
    f.queryEquals !== undefined && u.search.slice(1) !== f.queryEquals,
    f.queryContains !== undefined && !u.search.includes(f.queryContains),
    f.queryPrefix !== undefined && !u.search.slice(1).startsWith(f.queryPrefix),
    f.querySuffix !== undefined && !u.search.endsWith(f.querySuffix),
    f.urlEquals !== undefined && url !== f.urlEquals,
    f.urlContains !== undefined && !url.includes(f.urlContains),
    f.urlPrefix !== undefined && !url.startsWith(f.urlPrefix),
    f.urlSuffix !== undefined && !url.endsWith(f.urlSuffix),
    f.urlMatches !== undefined && !safeRe(f.urlMatches)?.test(url),
    f.originAndPathMatches !== undefined && !safeRe(f.originAndPathMatches)?.test(u.origin + u.pathname),
    f.schemes !== undefined && !f.schemes.includes(u.protocol.slice(0, -1)),
    f.ports !== undefined && !f.ports.some((p) => (Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p)),
  ];
  return !failed.some(Boolean);
}

module.exports = { matchPattern, isHostPattern, hostCoversDomain, urlFilterMatches };
