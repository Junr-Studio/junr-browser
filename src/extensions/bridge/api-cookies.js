'use strict';
// chrome.cookies : lit et écrit les cookies de la partition du client où tourne l'extension (une extension ne voit
// jamais les cookies d'un autre client). Chaque appel exige la permission « cookies » ET une permission d'hôte couvrant le cookie.
const { hostCoversDomain } = require('./match');
const model = require('./model');

const CAUSES = { explicit: 'explicit', overwrite: 'overwrite', expired: 'expired', evicted: 'evicted', 'expired-overwrite': 'expired_overwrite' };

function out(c) {
  const o = {
    name: c.name, value: c.value, domain: c.domain, hostOnly: !!c.hostOnly, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
    sameSite: c.sameSite || 'unspecified', session: !!c.session, storeId: '0',
  };
  if (!c.session && c.expirationDate) o.expirationDate = c.expirationDate;
  return o;
}

const covered = (ctx, domain) => ctx.hosts.some((h) => hostCoversDomain(h, domain));

function needHost(ctx, url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid url'); }
  if (!ctx.hostAllowed(url)) throw new Error(`No host permissions for cookies at url: "${u.href}".`);
  return u;
}

function checkStore(storeId) {
  if (storeId !== undefined && storeId !== '0') throw new Error(`No cookie store exists with ID ${storeId}.`);
}

module.exports = {
  ns: 'cookies',
  permission: 'cookies',
  events: ['onChanged'],
  methods: {
    async get(ctx, details = {}) {
      checkStore(details.storeId);
      needHost(ctx, details.url);
      const list = await ctx.ses.cookies.get({ url: details.url, name: details.name });
      list.sort((a, b) => (b.path || '').length - (a.path || '').length); // le plus spécifique d'abord (comme Chrome)
      return list[0] ? out(list[0]) : null;
    },
    async getAll(ctx, details = {}) {
      checkStore(details.storeId);
      const filter = {};
      for (const k of ['url', 'name', 'domain', 'path', 'secure', 'session']) if (details[k] !== undefined) filter[k] = details[k];
      if (details.url) needHost(ctx, details.url);
      const list = await ctx.ses.cookies.get(filter);
      return list.filter((c) => covered(ctx, c.domain)).map(out);
    },
    async set(ctx, details = {}) {
      checkStore(details.storeId);
      const u = needHost(ctx, details.url);
      const d = { url: details.url, name: details.name || '', value: details.value || '', path: details.path, secure: details.secure, httpOnly: details.httpOnly, sameSite: details.sameSite, expirationDate: details.expirationDate };
      if (details.domain !== undefined) {
        if (!covered(ctx, details.domain)) throw new Error(`No host permissions for cookies at url: "${u.href}".`);
        d.domain = details.domain;
      }
      for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
      try { await ctx.ses.cookies.set(d); } catch (e) { throw new Error(`Failed to parse or set cookie named "${d.name}". ${e.message}`); }
      const list = await ctx.ses.cookies.get({ url: details.url, name: details.name });
      return list[0] ? out(list[0]) : null;
    },
    async remove(ctx, details = {}) {
      checkStore(details.storeId);
      needHost(ctx, details.url);
      await ctx.ses.cookies.remove(details.url, details.name);
      return { url: details.url, name: details.name, storeId: '0' };
    },
    async getAllCookieStores(ctx) {
      return [{ id: '0', tabIds: model.tabsOfSpace(ctx.spaceId).map((t) => t.view.webContents.id) }];
    },
  },
  // Un écouteur par partition : les changements ne sont livrés qu'aux extensions du même client, couvertes par leurs hôtes.
  onSession(ses, spaceId, { emit }) {
    ses.cookies.on('changed', (e, cookie, cause, removed) => {
      emit('cookies.onChanged', (ctx) => (covered(ctx, cookie.domain) ? [{ removed, cookie: out(cookie), cause: CAUSES[cause] || 'explicit' }] : null), { spaceId });
    });
  },
};
