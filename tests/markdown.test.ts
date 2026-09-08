import { describe, expect, it } from 'vitest';

import { excerpt, extractMentions, isSafeUrl, renderMarkdown } from '@/lib/domain/markdown';

/**
 * The security tests come FIRST and are the reason this module exists. If the
 * formatting tests below fail the forum looks wrong; if these fail, one user
 * can run script in another user's session.
 */
/**
 * The tags this module is allowed to emit. Anything else in the output is, by
 * definition, something the input smuggled through.
 */
const ALLOWED_TAGS = new Set([
  'p', 'strong', 'em', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h3', 'h4', 'a', 'span',
]);

/**
 * Every real tag in the output — that is, every `<...>` that survived escaping.
 *
 * This is the assertion that matters. Searching the whole output string for
 * `onerror=` is the wrong test: in `&lt;img onerror=alert(1)&gt;` that text is
 * inert paragraph content, not an attribute. What actually has to hold is that
 * the only MARKUP present is markup this module wrote.
 */
function tagsIn(html: string): { name: string; attrs: string }[] {
  // Opening tags only — a closing tag carries no attributes and counting it
  // would double every element.
  return [...html.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g)].map((m) => ({
    name: m[1].toLowerCase(),
    attrs: m[2],
  }));
}

describe('XSS resistance', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload=alert(1)>',
    '"><script>alert(1)</script>',
    "'-alert(1)-'",
    '<a href="javascript:alert(1)">click</a>',
    '<style>body{display:none}</style>',
    '<object data="data:text/html,<script>alert(1)</script>">',
    '<!--<script>alert(1)</script>-->',
    '<math><mtext><script>alert(1)</script>',
  ];

  for (const attack of attacks) {
    it(`neutralises: ${attack.slice(0, 40)}`, () => {
      const html = renderMarkdown(attack);

      // Every tag present must be one this module writes itself. Since every
      // `<` in the input became `&lt;`, any tag here came from us.
      for (const tag of tagsIn(html)) {
        expect(ALLOWED_TAGS.has(tag.name), `unexpected tag <${tag.name}>`).toBe(true);
        // And no emitted tag may carry an event handler.
        expect(tag.attrs).not.toMatch(/on\w+\s*=/i);
      }

      // The attack text survives as visible, inert content rather than being
      // silently dropped. (Only checked where there was markup to escape —
      // one of the payloads is a pure quote-breakout with no angle brackets.)
      if (attack.includes('<')) expect(html).toContain('&lt;');
    });
  }

  it('escapes the angle brackets rather than dropping the text', () => {
    // Stripping tags loses information; escaping preserves what was written.
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not let a code fence smuggle markup through', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    // The quotes in the URL became `&quot;`, so the whole thing stays INSIDE
    // the href value — a browser reads one attribute containing literal quote
    // characters, not a second attribute called onmouseover. The literal text
    // `onmouseover=` in the value is inert; what matters is that no new
    // attribute was created.
    const html = renderMarkdown('[x](/a"onmouseover="alert(1))');
    const anchors = tagsIn(html).filter((t) => t.name === 'a');
    expect(anchors).toHaveLength(1);
    // Exactly one attribute — href — and nothing else.
    expect(anchors[0].attrs.trim()).toBe('href="/a&quot;onmouseover=&quot;alert(1"');
  });

  it('emits only allowlisted tags for a rich but benign post', () => {
    const html = renderMarkdown(
      '# Title\n\n**bold** *it* `c`\n\n- one\n- two\n\n> quote\n\n```\ncode\n```\n\n[l](https://x.edu)',
    );
    for (const tag of tagsIn(html)) {
      expect(ALLOWED_TAGS.has(tag.name), `unexpected tag <${tag.name}>`).toBe(true);
    }
  });
});

describe('URL scheme allowlist', () => {
  it('accepts the schemes a school forum needs', () => {
    expect(isSafeUrl('https://example.edu/page')).toBe(true);
    expect(isSafeUrl('http://example.edu')).toBe(true);
    expect(isSafeUrl('mailto:registrar@geu.edu')).toBe(true);
    expect(isSafeUrl('/courses/CSC101')).toBe(true);
  });

  it('rejects script-bearing schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    // data:text/html executes in the document's origin — as dangerous as
    // javascript:, and far more often forgotten.
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('data:image/png;base64,iVBOR')).toBe(false);
  });

  it('rejects whitespace smuggling', () => {
    // A browser strips the tab before resolving the scheme, so a naive prefix
    // check would see something harmless and then the URL would execute.
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
  });

  it('rejects protocol-relative URLs, which look relative but are not', () => {
    expect(isSafeUrl('//evil.example/steal')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });

  it('leaves an unsafe link as literal text rather than rendering an anchor', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('[click]');
  });
});

describe('link rendering', () => {
  it('marks external links noopener, so the target cannot reach back', () => {
    const html = renderMarkdown('[docs](https://example.edu)');
    expect(html).toContain('href="https://example.edu"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('keeps internal links in the same tab and unadorned', () => {
    const html = renderMarkdown('[timetable](/offerings)');
    expect(html).toContain('href="/offerings"');
    expect(html).not.toContain('target="_blank"');
  });

  it('autolinks a bare URL', () => {
    const html = renderMarkdown('See https://example.edu/handbook for detail.');
    expect(html).toContain('<a href="https://example.edu/handbook"');
  });

  it('preserves an ampersand in a query string', () => {
    // The URL is HTML-escaped before the scheme is judged, so the check must
    // decode it or a legitimate query string would be rejected.
    const html = renderMarkdown('[x](https://example.edu/a?b=1&c=2)');
    expect(html).toContain('<a href="https://example.edu/a?b=1&amp;c=2"');
  });
});

describe('block grammar', () => {
  it('renders paragraphs', () => {
    expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one two</p>');
  });

  it('renders headings, capped at h3 so the page outline survives', () => {
    expect(renderMarkdown('# Title')).toBe('<h3>Title</h3>');
    expect(renderMarkdown('### Deep')).toContain('<h4>');
    // No h1 or h2 can be produced by an author, at any depth of #.
    expect(renderMarkdown('# a\n## b\n### c')).not.toMatch(/<h[12]>/);
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('starts a new list when the kind changes', () => {
    const html = renderMarkdown('- a\n1. b');
    expect(html).toContain('<ul><li>a</li></ul>');
    expect(html).toContain('<ol><li>b</li></ol>');
  });

  it('renders block quotes', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('renders fenced code without applying inline formatting inside it', () => {
    const html = renderMarkdown('```\nconst x = **not bold**;\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>');
  });

  it('closes an unterminated fence rather than losing the post', () => {
    const html = renderMarkdown('```\nunclosed');
    expect(html).toContain('<pre><code>unclosed</code></pre>');
  });

  it('renders an empty body as an empty string', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });
});

describe('inline formatting', () => {
  it('renders bold, italic and code', () => {
    expect(renderMarkdown('**b**')).toContain('<strong>b</strong>');
    expect(renderMarkdown('*i*')).toContain('<em>i</em>');
    expect(renderMarkdown('`c`')).toContain('<code>c</code>');
  });

  it('does not format inside a code span', () => {
    const html = renderMarkdown('`**not bold**`');
    expect(html).toContain('<code>**not bold**</code>');
    expect(html).not.toContain('<strong>');
  });

  it('handles several code spans in one line', () => {
    const html = renderMarkdown('`a` and `b`');
    expect(html).toContain('<code>a</code>');
    expect(html).toContain('<code>b</code>');
  });

  it('renders a mention as a marker, never as a link', () => {
    const html = renderMarkdown('cc @a.okafor@geu.edu please');
    expect(html).toContain('<span class="mention">@a.okafor@geu.edu</span>');
    // A link built from unverified text would advertise whether an account
    // exists.
    expect(html).not.toContain('<a ');
  });
});

describe('mention extraction', () => {
  it('finds mentions in the raw text', () => {
    expect(extractMentions('cc @a.okafor@geu.edu and @registrar')).toEqual([
      'a.okafor@geu.edu',
      'registrar',
    ]);
  });

  it('lowercases and de-duplicates', () => {
    expect(extractMentions('@Bob and @bob')).toEqual(['bob']);
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractMentions('ask @registrar.')).toEqual(['registrar']);
    expect(extractMentions('(@bursary)')).toEqual(['bursary']);
  });

  it('ignores an email address written mid-word', () => {
    expect(extractMentions('write to me@example.edu')).toEqual([]);
  });

  it('caps the fan-out', () => {
    const many = Array.from({ length: 50 }, (_, i) => `@user${i}`).join(' ');
    expect(extractMentions(many, 5)).toHaveLength(5);
  });

  it('returns nothing for text with no mentions', () => {
    expect(extractMentions('an ordinary sentence')).toEqual([]);
  });
});

describe('excerpt', () => {
  it('flattens markup to plain text', () => {
    expect(excerpt('**bold** and `code` and [a link](https://x.edu)')).toBe(
      'bold and code and a link',
    );
  });

  it('drops fenced code entirely', () => {
    expect(excerpt('before\n```\ncode here\n```\nafter')).toBe('before after');
  });

  it('truncates with an ellipsis', () => {
    const out = excerpt('x'.repeat(300), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short text alone', () => {
    expect(excerpt('short')).toBe('short');
  });
});
