'use strict';
// Enveloppe le service worker d'une extension installée : `junr-sw.js` charge d'abord le shim (sw-shim.js) puis le
// script d'origine. Idempotent et réversible ; piloté par le réglage `extensionShims` (et JUNR_NO_SHIM pour les mesures).
// L'enveloppe est posée dans le MÊME dossier que le script d'origine : `importScripts('a.js')` se résout par rapport à l'adresse du
// service worker, pas à celle du script qui l'appelle (sinon une extension dont le SW est dans un sous-dossier ne trouve plus ses fichiers).
const fs = require('node:fs');
const path = require('node:path');
const { state } = require('../state');

const WRAPPER = 'junr-sw.js';
const SHIM = 'junr-shim.js';
const ORIG = '.junr-orig-sw';

const enabled = () => !!state.store?.data.settings.extensionShims && !process.env.JUNR_NO_SHIM;
const isWrapper = (p) => path.posix.basename(String(p)) === WRAPPER;

function apply(dir) {
  const mfile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mfile, 'utf8').replace(/^﻿/, ''));
  const bg = manifest.background;
  if (!bg?.service_worker) return 'no-service-worker';
  const wrapped = isWrapper(bg.service_worker);
  // Script d'origine (relatif à la racine de l'extension), retrouvé dans le fichier mémoire quand l'enveloppe est déjà posée.
  const orig = wrapped ? fs.readFileSync(path.join(dir, ORIG), 'utf8').trim() : bg.service_worker.replace(/^\.?\//, '');
  const wrapperRel = path.posix.join(path.posix.dirname(orig), WRAPPER);
  if (enabled()) {
    // Enveloppe absente, ou posée à l'ancien emplacement (racine) : on la (re)pose à côté du script d'origine.
    if (bg.service_worker !== wrapperRel) {
      if (wrapped) fs.rmSync(path.join(dir, bg.service_worker), { force: true });
      fs.writeFileSync(path.join(dir, wrapperRel), bg.type === 'module' ? `import '/${SHIM}';\nimport '/${orig}';\n` : `importScripts('/${SHIM}', '/${orig}');\n`);
      fs.writeFileSync(path.join(dir, ORIG), orig);
      bg.service_worker = wrapperRel;
      fs.writeFileSync(mfile, JSON.stringify(manifest, null, 2));
    }
    fs.writeFileSync(path.join(dir, SHIM), require('./bridge').shimSource()); // toujours la version courante, spécification des API pontées en tête
    return 'wrapped';
  }
  if (wrapped) {
    fs.rmSync(path.join(dir, bg.service_worker), { force: true });
    bg.service_worker = orig;
    fs.writeFileSync(mfile, JSON.stringify(manifest, null, 2));
    for (const f of [SHIM, ORIG]) fs.rmSync(path.join(dir, f), { force: true });
  }
  return 'plain';
}

module.exports = { apply, enabled };
