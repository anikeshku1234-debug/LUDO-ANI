const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Current directory ke static assets serve karega
app.use(express.static(__dirname));

// Safe file delivery helper (root directory aur sub-folder fallback ke sath)
function sendStatic(fileName, mimeType, res) {
  const localPath = path.join(__dirname, fileName);
  const rootPath = path.join(__dirname, '..', fileName);
  const target = fs.existsSync(localPath) ? localPath : rootPath;
  if (mimeType) res.setHeader('Content-Type', mimeType);
  res.sendFile(target);
}

app.get('/', (req, res) => sendStatic('index.html', 'text/html', res));
app.get('/app.js', (req, res) => sendStatic('app.js', 'application/javascript', res));
app.get('/style.css', (req, res) => sendStatic('style.css', 'text/css', res));
app.get('/manifest.json', (req, res) => sendStatic('manifest.json', 'application/manifest+json', res));
app.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  sendStatic('sw.js', 'application/javascript', res);
});
app.get('/logo-192.png', (req, res) => sendStatic('logo-192.png', 'image/png', res));
app.get('/logo-512.png', (req, res) => sendStatic('logo-512.png', 'image/png', res));

app.listen(PORT, () => {
  console.log(`Ludo Server running on port ${PORT}`);
});
