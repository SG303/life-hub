import MarkdownIt from 'markdown-it';

/**
 * Markdown renderer for untrusted assistant replies:
 * - raw HTML is escaped, never rendered;
 * - images are disabled (no remote image requests / data exfiltration);
 * - links must be absolute `http:`/`https:` and open in a new tab without referrer.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
md.disable(['image']);

md.validateLink = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer nofollow');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}
