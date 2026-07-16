const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'BR', 'P', 'DIV', 'SPAN',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'FONT',
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-decoration', 'text-align',
]);

function safeStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 0) return null;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!ALLOWED_STYLE_PROPERTIES.has(property)) return null;
      if (!value || /url\s*\(|expression\s*\(|javascript\s*:|[<>]/i.test(value)) return null;
      return `${property}: ${value}`;
    })
    .filter((value): value is string => Boolean(value))
    .join('; ');
}

/** Keep pasted/editor HTML limited to formatting tags and safe presentation attributes. */
export function sanitizeNoteHtml(html: string): string {
  if (typeof document === 'undefined') return '';

  const template = document.createElement('template');
  template.innerHTML = html;

  const walk = (parent: Node) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }

      const element = node as HTMLElement;
      if (!ALLOWED_TAGS.has(element.tagName)) {
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
        return;
      }

      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name === 'style') {
          const style = safeStyle(attribute.value);
          if (style) element.setAttribute('style', style);
          else element.removeAttribute('style');
          return;
        }
        if (element.tagName === 'FONT' && (name === 'color' || name === 'face' || name === 'size')) return;
        element.removeAttribute(attribute.name);
      });

      walk(element);
    });
  };

  walk(template.content);
  return template.innerHTML;
}

export function plainTextFromHtml(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  const container = document.createElement('div');
  container.innerHTML = sanitizeNoteHtml(html);
  return container.textContent ?? '';
}

