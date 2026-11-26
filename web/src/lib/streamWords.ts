import { renderMarkdown } from './markdown';

/**
 * Soft streaming for a reply that is still being written.
 *
 * Instead of replacing the rendered HTML on every chunk, the element keeps its DOM and
 * only appends what is new. Each new word is wrapped in `<span class="w fresh">` so CSS can
 * fade it in. The markup always comes from `renderMarkdown` (sanitized); the only nodes this
 * module adds on top are those spans and one plain `<span>` per text node that holds words
 * (whitespace-only text stays a text node, so `:last-child` still finds the last block).
 *
 * Usage: `<div use:streamMarkdown={text}></div>`
 */
export function streamMarkdown(node: HTMLElement, text: string) {
  let previous: Node = document.createElement('template').content;
  const update = (next: string) => {
    // A <template> parses into an inert fragment: nothing in it loads or runs.
    const template = document.createElement('template');
    template.innerHTML = renderMarkdown(next);
    sync(node, previous, template.content);
    previous = template.content;
  };
  update(text);
  return { update };
}

const TEXT = 3;
const ELEMENT = 1;

/**
 * Brings `live` from the state rendered from `prev` to the one in `next`. Every text node of
 * the rendered markup lives in `live` as one wrapper span at the same position.
 */
function sync(live: Node, prev: Node, next: Node): void {
  const nextKids = Array.from(next.childNodes);
  const prevKids = Array.from(prev.childNodes);
  nextKids.forEach((n, i) => {
    const p = prevKids[i];
    const l = live.childNodes[i];
    if (!p || !l) {
      live.appendChild(build(n, true));
      return;
    }
    if (n.nodeType === TEXT && p.nodeType === TEXT) {
      const now = n.textContent ?? '';
      const before = p.textContent ?? '';
      if (now === before) return;
      if (now.startsWith(before) && l.nodeType === ELEMENT) appendWords(l, now.slice(before.length), true);
      else live.replaceChild(buildText(now, commonPrefix(now, before)), l);
      return;
    }
    if (n.nodeType === ELEMENT && p.nodeType === ELEMENT && (n as Element).tagName === (p as Element).tagName) {
      syncAttributes(l as Element, n as Element);
      sync(l, p, n);
      return;
    }
    // The structure changed (for example `**bold` became <strong>): show it without fading again.
    live.replaceChild(build(n, false), l);
  });
  while (live.childNodes.length > nextKids.length) live.lastChild!.remove();
}

function build(node: Node, fresh: boolean): Node {
  if (node.nodeType === TEXT) {
    const text = node.textContent ?? '';
    return buildText(text, fresh ? 0 : text.length);
  }
  const copy = node.cloneNode(false);
  node.childNodes.forEach((child) => copy.appendChild(build(child, fresh)));
  return copy;
}

/** A wrapper span for one text node; everything from `freshFrom` on fades in. */
function buildText(text: string, freshFrom: number): Node {
  if (!text.trim()) return document.createTextNode(text);
  const span = document.createElement('span');
  appendWords(span, text.slice(0, freshFrom), false);
  appendWords(span, text.slice(freshFrom), true);
  return span;
}

function appendWords(target: Node, text: string, fresh: boolean): void {
  if (!text) return;
  if (!fresh) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      target.appendChild(document.createTextNode(part));
      continue;
    }
    const word = document.createElement('span');
    word.className = 'w fresh';
    word.textContent = part;
    target.appendChild(word);
  }
}

function syncAttributes(live: Element, next: Element): void {
  for (const { name } of Array.from(live.attributes)) if (!next.hasAttribute(name)) live.removeAttribute(name);
  for (const { name, value } of Array.from(next.attributes)) if (live.getAttribute(name) !== value) live.setAttribute(name, value);
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}
