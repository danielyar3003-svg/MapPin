type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function dialog(title: string, body: Node[], buttons: { label: string; primary?: boolean; onClick?: (close: () => void) => void }[]): HTMLDialogElement {
  const d = h('dialog');
  const close = () => { d.close(); d.remove(); };
  d.append(
    h('header', {}, title),
    h('div', { class: 'body' }, ...body),
    h('footer', {}, ...buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => (b.onClick ? b.onClick(close) : close()) }, b.label))),
  );
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}
