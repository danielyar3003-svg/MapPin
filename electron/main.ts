import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

let win: BrowserWindow | null = null;
/** Папки игры, которые пользователь сам выбрал. Читать можно только внутри них. */
const allowedRoots = new Set<string>();
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function readSettings(): Promise<Record<string, unknown>> {
  try { return JSON.parse(await fs.readFile(settingsFile(), 'utf8')); } catch { return {}; }
}

async function writeSettings(s: Record<string, unknown>) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(s, null, 2));
}

/** Путь внутри корня игры без учёта регистра (на Windows не нужно, на Linux/Wine — нужно). */
const dirCache = new Map<string, Map<string, string>>();
async function resolveInRoot(root: string, rel: string): Promise<string | null> {
  if (!allowedRoots.has(root)) throw new Error('Папка не выбрана пользователем');
  const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error('Недопустимый путь');
  let cur = root;
  for (const part of parts) {
    let entries = dirCache.get(cur);
    if (!entries) {
      entries = new Map();
      try { for (const e of await fs.readdir(cur)) entries.set(e.toLowerCase(), e); } catch { return null; }
      dirCache.set(cur, entries);
    }
    const real = entries.get(part.toLowerCase());
    if (!real) return null;
    cur = path.join(cur, real);
  }
  return cur;
}

function setup() {
  ipcMain.handle('pickGameFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Папка GTA San Andreas', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    allowedRoots.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('exists', async (_e, root: string, rel: string) => (await resolveInRoot(root, rel)) !== null);
  ipcMain.handle('readFile', async (_e, root: string, rel: string) => {
    const p = await resolveInRoot(root, rel);
    if (!p) throw new Error(`Файл не найден: ${rel}`);
    return new Uint8Array(await fs.readFile(p));
  });
  ipcMain.handle('readRange', async (_e, root: string, rel: string, offset: number, length: number) => {
    const p = await resolveInRoot(root, rel);
    if (!p) throw new Error(`Файл не найден: ${rel}`);
    const fh = await fs.open(p, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally { await fh.close(); }
  });
  ipcMain.handle('saveText', async (_e, defaultName: string, text: string, filters) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, text, 'utf8');
    return r.filePath;
  });
  ipcMain.handle('openText', async (_e, filters) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('getSetting', async (_e, key: string) => {
    const v = (await readSettings())[key];
    // Сохранённая папка игры снова разрешается для чтения.
    if (key === 'gameFolder' && typeof v === 'string') allowedRoots.add(v);
    return v;
  });
  ipcMain.handle('setSetting', async (_e, key: string, value: unknown) => {
    const s = await readSettings();
    s[key] = value;
    await writeSettings(s);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'MapPin',
    backgroundColor: '#1d2026',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => { setup(); createWindow(); });
app.on('window-all-closed', () => app.quit());
