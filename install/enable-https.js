#!/usr/bin/env node
'use strict';
// Turns on HTTPS for an existing installation without reinstalling.
//   node install/enable-https.js                 (self-signed certificate, port 8443)
//   node install/enable-https.js --port=443
//   node install/enable-https.js --cert=company.crt --key=company.key
//   node install/enable-https.js --address=192.168.1.20
const fs = require('fs');
const path = require('path');
const { paths, loadConfig, saveConfig } = require('../server/config');
const { generateCert } = require('./cert');
const { writeClientInstallers } = require('./client-installers');

const args = Object.fromEntries(process.argv.slice(2).map((a) => /^--([^=]+)=?(.*)$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2]]));
const cfg = loadConfig();
if (!cfg) { console.error('Install the server first: node install/install-server.js'); process.exit(1); }

(async () => {
  const address = args.address || cfg.address || 'localhost';
  let https;
  if (args.cert && args.key) {
    if (!fs.existsSync(args.cert) || !fs.existsSync(args.key)) { console.error('Certificate or key file not found.'); process.exit(1); }
    fs.mkdirSync(paths.CERTS, { recursive: true });
    fs.copyFileSync(args.cert, path.join(paths.CERTS, 'cert.pem'));
    fs.copyFileSync(args.key, path.join(paths.CERTS, 'key.pem'));
    https = { enabled: true, certFile: 'config/certs/cert.pem', keyFile: 'config/certs/key.pem', selfSigned: false };
    console.log('Using your certificate.');
  } else {
    const made = await generateCert(address);
    if (!made) {
      console.error('Could not create a certificate. Run "npm install" in the app folder first, then try again.');
      process.exit(1);
    }
    https = { enabled: true, certFile: made.certFile, keyFile: made.keyFile, selfSigned: true };
    console.log(`Self-signed certificate created using ${made.how}.`);
  }
  const port = parseInt(args.port || (cfg.port === 8080 ? 8443 : cfg.port), 10);
  Object.assign(cfg, { address, port, https, publicUrl: `https://${address}:${port}` });
  saveConfig(cfg);
  writeClientInstallers(cfg.publicUrl);
  console.log(`HTTPS is on. Restart the server, then open ${cfg.publicUrl}/admin`);
  console.log('Client installers in installers/ were updated with the new address.');
})();
