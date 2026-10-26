'use strict';
// Hôte de messagerie native de test (protocole de Chrome : longueur sur 4 octets little-endian + JSON, sur stdin/stdout).
let buf = Buffer.alloc(0);
function send(m) {
  const body = Buffer.from(JSON.stringify(m));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}
function handle(m) {
  if (m && m.cmd === 'exit') process.exit(0);
  if (m && m.cmd === 'later') { setTimeout(() => send({ late: true }), 150); return; }
  send({ echo: m, origin: process.argv[2], pid: process.pid });
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    const m = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
    buf = buf.subarray(4 + n);
    handle(m);
  }
});
process.stdin.on('end', () => process.exit(0));
