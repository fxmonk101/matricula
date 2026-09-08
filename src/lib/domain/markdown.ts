/**
 * =============================================================================
 * SAFE MARKDOWN SUBSET
 * =============================================================================
 *
 * Forum posts are the first place in this system where one user's text is
 * rendered in another user's browser. That makes this module a security
 * boundary, not a formatting convenience.
 *
 * THE DESIGN, AND WHY
 * -------------------
 * The usual approach is parse-then-sanitise: run a full markdown parser, let it
 * emit HTML including whatever raw HTML the author wrote, then strip the
 * dangerous parts with a sanitiser. That is sound only if the sanitiser is
 * perfect, and sanitisers are perfect only until the next mutation-XSS or
 * namespace-confusion bug. It is a denylist wearing an allowlist's clothes.
 *
 * This module inverts it: **escape first, then transform.**
 *
 *   1. Every `& < > " '` in the input becomes an entity. After this step the
 *      string contains no markup at all — it is inert text.
 *   2. Transforms then introduce ONLY tags this module writes itself, from a
 *      fixed vocabulary. No input character can become a tag delimiter,
 *      because there are no `<` characters left to become one.
 *
 * The failure mode of a bug here is ugly output, not script execution. That is
 * a categorically better place to be wrong.
 *
 * THE ONE REMAINING VECTOR is the link, `[text](url)`, where a URL the author
 * controls lands in an `href`. Escaping does not help — `javascript:alert(1)`
 * contains no markup. So schemes are allowlisted explicitly below. That
 * function is the part of this file to read twice.
 *
 * Pure: no DOM, no I/O. Runs identically on server and client, which matters
 * because the preview a user sees while typing must be the thing that gets
 * stored and shown to everyone else.
 */

/**
 * Control characters are stripped before anything else.
 *
 * They are never legitimate in a forum post, and they are the mechanism behind
 * several scheme-smuggling tricks: a browser strips a NUL or a newline out of
 * `java\0script:` before resolving the scheme, so a prefix check against the
 * raw string sees something harmless. Removing them up front means the string
 * this module reasons about is the string the browser will see.
 *
 * Tab and newline survive — they carry meaning in the block grammar below.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Escaped first, so no input character can ever become a tag delimiter. */
function escapeHtml(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Schemes a link may use. An allowlist, never a denylist.
 *
 * `javascript:` is the obvious attack. `data:` is the less obvious one — a
 * `data:text/html` URL can execute in the document's origin, so it is every bit
 * as dangerous. Enumerating what is permitted means a scheme nobody has thought
 * of yet is refused by default rather than admitted by default.
 */
const SAFE_SCHEMES = ['http://', 'https://', 'mailto:'] as const;

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') return false;

  // Any internal whitespace is a smuggling attempt, not a URL. Browsers strip
  // it before resolving the scheme, so `java\tscript:alert(1)` would pass a
  // naive prefix check and then execute. Reject rather than try to normalise.
  if (/\s/.test(trimmed)) return false;

  // Protocol-relative: looks relative, goes off-site.
  if (trimmed.startsWith('//')) return false;
  // Genuinely relative, within this app.
  if (trimmed.startsWith('/')) return true;

  const lower = trimmed.toLowerCase();
  return SAFE_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/**
 * Mentions, as `@name` or `@local@domain.tld`.
 *
 * Extracted from the RAW text, before rendering, because the caller needs the
 * identities in order to notify — and needs them whether or not the body
 * renders cleanly.
 *
 * A mention must follow a word boundary, so an email address written plainly
 * mid-sentence does not silently become a mention.
 */
const MENTION_RE = /(?:^|[\s(])@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;

export function extractMentions(raw: string, limit = 20): string[] {
  const out = new Set<string>();
  for (const match of raw.matchAll(MENTION_RE)) {
    // Trailing punctuation belongs to the sentence, not the handle.
    const cleaned = match[1].replace(/[.,;:!?)]+$/, '');
    if (cleaned.length > 0) out.add(cleaned.toLowerCase());
    // Capped, so a post full of @s cannot fan out a thousand notifications.
    if (out.size >= limit) break;
  }
  return [...out];
}

/**
 * Inline transforms, applied to text that is ALREADY escaped.
 *
 * The code-span placeholder uses NUL sentinels. They cannot collide with
 * anything in the text, because `escapeHtml` has already removed every control
 * character — including NUL — from the input.
 */
function renderInline(escaped: string): string {
  let out = escaped;

  // Code spans are lifted out first so later passes cannot reach inside them.
  // Without this, `**` inside a code span would still render as bold.
  const codeSpans: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // Links. The URL is VALIDATED, not merely escaped — see isSafeUrl.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) => {
    // The URL arrives already HTML-escaped, so `&amp;` goes back to `&` before
    // the scheme is judged — otherwise a legitimate query string carrying an
    // ampersand would be tested in a form no browser will ever resolve.
    if (!isSafeUrl(url.replace(/&amp;/g, '&'))) return whole;
    const external = !url.startsWith('/');
    // `noopener` is not decorative: without it, a target=_blank link hands the
    // opened page a live reference back to this one through window.opener.
    const attrs = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
    return `<a href="${url}"${attrs}>${text}</a>`;
  });

  // Bare URLs, autolinked. Same validation.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (whole, lead: string, url: string) => {
    if (!isSafeUrl(url.replace(/&amp;/g, '&'))) return whole;
    return `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
  });

  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>');

  // Mentions become a visual marker only — never a link. Resolving a handle to
  // a person is the server's job, and a link built from unverified text would
  // advertise whether an account exists.
  out = out.replace(
    /(^|[\s(])@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g,
    '$1<span class="mention">@$2</span>',
  );

  return out.replace(
    /\u0000(\d+)\u0000/g,
    (_, i: string) => `<code>${codeSpans[Number(i)]}</code>`,
  );
}

/**
 * Render a post body to HTML.
 *
 * The block grammar is deliberately small — headings, quotes, lists, fenced
 * code, paragraphs. A school forum needs to be readable, not to be a CMS, and
 * every construct added here is another thing that must stay correct forever.
 */
export function renderMarkdown(raw: string): string {
  // STEP 1. Escape everything. After this line the string is inert.
  const escaped = escapeHtml(raw.replace(/\r\n/g, '\n'));

  const lines = escaped.split('\n');
  const blocks: string[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      `<${tag}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${tag}>`,
    );
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    // Fenced code: contents are emitted verbatim (already escaped) with NO
    // inline pass, which is the entire point of a code block.
    if (/^\s*```/.test(line)) {
      if (fence === null) {
        flushAll();
        fence = [];
      } else {
        blocks.push(`<pre><code>${fence.join('\n')}</code></pre>`);
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      // Capped so the smallest heading an author can emit is h3. A forum post
      // is not a document; letting authors emit h1 wrecks the page's heading
      // outline for anyone navigating by screen reader.
      const level = Math.min(heading[1].length + 2, 4);
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // `>` has already become `&gt;` by the time we see it.
    const quoted = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  // An unterminated fence still renders as code rather than vanishing. Losing
  // somebody's post because they forgot three backticks is worse than showing
  // it in a monospace box.
  if (fence !== null) blocks.push(`<pre><code>${fence.join('\n')}</code></pre>`);
  flushAll();

  return blocks.join('\n');
}

/** Plain-text excerpt, for listings and notification bodies. */
export function excerpt(raw: string, length = 160): string {
  const flat = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1).trimEnd()}…`;
}
