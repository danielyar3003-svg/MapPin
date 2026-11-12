/** Сохранение/открытие текстовых файлов: в Electron — системные диалоги, в браузере — загрузка/выбор файла. */
export async function saveTextFile(name: string, text: string, ext: string, label: string): Promise<string | null> {
  if (window.mappin) return window.mappin.saveText(name, text, [{ name: label, extensions: [ext] }]);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function openTextFile(exts: string[], label: string): Promise<{ path: string; text: string } | null> {
  if (window.mappin) return window.mappin.openText([{ name: label, extensions: exts }]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

/** Браузер: выбор папки игры. */
export function pickDirectoryFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.id = 'game-folder-input';
    input.style.display = 'none';
    document.body.append(input);
    input.onchange = () => { const list = input.files ? [...input.files] : null; input.remove(); resolve(list); };
    input.click();
  });
}

export function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
}
