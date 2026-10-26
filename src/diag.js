'use strict';
// Page de diagnostic locale : même adresse dans tous les espaces, pour constater l'étanchéité des clients.
const http = require('node:http');

const DIAG_HTML = `<!doctype html><meta charset="utf-8"><title>Diagnostic</title>
<style>body{font:15px system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1b2430}
input{padding:6px 8px;width:260px}button{padding:6px 10px}pre{background:#eef1f4;padding:12px;border-radius:4px}</style>
<h1>Diagnostic de l'espace</h1>
<p>Cette page a la même adresse dans tous les espaces. Ce que tu enregistres ici ne doit apparaître que dans l'espace courant.</p>
<input id="v" placeholder="Écris une note"> <button id="s">Enregistrer</button>
<pre id="out"></pre>
<script>
const out=document.getElementById('out');
function show(){out.textContent=JSON.stringify({
  note_localStorage: localStorage.getItem('note'),
  cookie: document.cookie || null,
  extension: document.documentElement.dataset.junrExt ? 'active' : 'absente'},null,2)}
document.getElementById('s').onclick=()=>{
  const v=document.getElementById('v').value;
  localStorage.setItem('note',v);
  document.cookie='note='+encodeURIComponent(v)+';path=/;max-age=31536000';show()};
show(); setTimeout(show,600);
</script>`;

function startDiagServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DIAG_HTML);
    });
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}/`));
    srv.unref();
  });
}

module.exports = { startDiagServer };
