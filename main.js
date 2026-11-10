// CS Arena - application Windows (Electron) : lance le serveur du jeu et l'ouvre dans une fenêtre plein écran.
// Autres joueurs du même réseau : navigateur sur http://TON-IP:3000 (le port est affiché dans le titre).
// Pour jouer sur un serveur distant au lieu du serveur local : CS_URL=https://mon-serveur.fly.dev (ou argument --url=...).
const { app, BrowserWindow, Menu } = require('electron');
const net = require('net');

const remote = process.env.CS_URL || (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);

function freePort(pref) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => { const t = net.createServer(); t.listen(0, () => { const p = t.address().port; t.close(() => resolve(p)); }); });
    s.listen(pref, () => s.close(() => resolve(pref)));
  });
}

async function start() {
  let url = remote;
  if (!url) {
    const port = await freePort(parseInt(process.env.PORT, 10) || 3000);
    process.env.PORT = String(port);
    require('./server.js');
    url = 'http://localhost:' + port;
  }
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 760, fullscreen: true, autoHideMenuBar: true, backgroundColor: '#000000', title: 'CS Arena',
    webPreferences: { backgroundThrottling: false }
  });
  // le jeu demande confirmation avant de quitter : en application, on ferme directement
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.loadURL(url);
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
