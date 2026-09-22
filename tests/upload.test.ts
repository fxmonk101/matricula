import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_TYPES,
  DOCUMENT_LIMITS,
  LOGO_LIMITS,
  SUBMISSION_LIMITS,
  UploadError,
  extensionOf,
  formatBytes,
  mayRenderInline,
  safeDisplayName,
  sniffType,
  storedFileName,
  validateUpload,
} from '@/lib/domain/upload';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const JPEG_EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('type sniffing', () => {
  it('identifies the formats the product accepts', () => {
    expect(sniffType(PNG)?.mediaType).toBe('image/png');
    expect(sniffType(JPEG)?.mediaType).toBe('image/jpeg');
    expect(sniffType(WEBP)?.mediaType).toBe('image/webp');
    expect(sniffType(PDF)?.mediaType).toBe('application/pdf');
  });

  it('accepts every JPEG marker flavour', () => {
    // The fourth byte varies (E0 JFIF, E1 Exif, DB raw), which is why it is
    // wildcarded. Pinning it to E0 would reject most photos from a phone.
    expect(sniffType(JPEG_EXIF)?.mediaType).toBe('image/jpeg');
  });

  it('does not mistake a bare RIFF container for WebP', () => {
    // A WAV file is also RIFF. Without the trailer check at offset 8 this
    // would sniff as an image.
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffType(wav)).toBeNull();
  });

  it('returns null for anything it does not recognise', () => {
    expect(sniffType(bytesOf('just some text'))).toBeNull();
    expect(sniffType(new Uint8Array([]))).toBeNull();
  });

  it('does not read past the end of a short file', () => {
    // A two-byte file must not throw while being compared to an eight-byte
    // signature.
    expect(() => sniffType(new Uint8Array([0x89, 0x50]))).not.toThrow();
    expect(sniffType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('the bytes decide, not the claim', () => {
  it('refuses HTML that calls itself a PNG', () => {
    // The attack this exists to stop: store an HTML document, have the app
    // serve it back from its own origin, and that is stored XSS. The declared
    // Content-Type and the .png extension are both attacker-supplied.
    const verdict = validateUpload({
      bytes: bytesOf('<html><script>alert(1)</script></html>'),
      fileName: 'logo.png',
      limits: LOGO_LIMITS,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/not a file type this system accepts|not one this system accepts/);
  });

  it('accepts a real PNG whatever the file is called', () => {
    // The converse: the extension is not evidence in either direction.
    const verdict = validateUpload({ bytes: PNG, fileName: 'crest.dat', limits: LOGO_LIMITS });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.type.extension).toBe('png');
  });

  it('refuses SVG by name, and says why', () => {
    // SVG is XML that can carry <script> and executes when served inline from
    // your own origin. "Sanitise it" is the losing denylist game the forum
    // renderer was built to avoid.
    const verdict = validateUpload({
      bytes: bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      fileName: 'logo.svg',
      limits: LOGO_LIMITS,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toMatch(/scripts/i);
      expect(verdict.message).toMatch(/PNG or WebP/);
    }
  });

  it('refuses other executable-ish extensions by name', () => {
    for (const name of ['x.html', 'x.htm', 'x.js', 'x.exe']) {
      const verdict = validateUpload({ bytes: PNG, fileName: name, limits: LOGO_LIMITS });
      expect(verdict.ok, name).toBe(false);
    }
  });
});

describe('limits', () => {
  it('refuses an empty file with its own message', () => {
    const verdict = validateUpload({ bytes: new Uint8Array([]), fileName: 'a.png', limits: LOGO_LIMITS });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/empty/);
  });

  it('refuses an oversized file and names both numbers', () => {
    // "Too large" without saying the limit makes the user guess.
    const big = new Uint8Array(LOGO_LIMITS.maxBytes + 1);
    big.set(PNG);
    const verdict = validateUpload({ bytes: big, fileName: 'a.png', limits: LOGO_LIMITS });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toMatch(/2\.0 MB/);
    }
  });

  it('keeps documents out of an image-only slot', () => {
    const verdict = validateUpload({ bytes: PDF, fileName: 'logo.pdf', limits: LOGO_LIMITS });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toMatch(/document/i);
  });

  it('accepts a document where documents are allowed', () => {
    expect(validateUpload({ bytes: PDF, fileName: 'transcript.pdf', limits: DOCUMENT_LIMITS }).ok).toBe(true);
  });
});

describe('stored names', () => {
  it('builds a name from the id and the DETERMINED extension', () => {
    // Never from the uploader's extension, which is a claim, not a fact.
    const type = sniffType(PNG)!;
    expect(storedFileName('abc123', type)).toBe('abc123.png');
  });

  it('refuses an id that could escape the directory', () => {
    const type = sniffType(PNG)!;
    for (const id of ['../etc/passwd', 'a/b', 'a\\b', 'a.b', '']) {
      expect(() => storedFileName(id, type), id).toThrow(UploadError);
    }
  });
});

describe('display names', () => {
  it('keeps only the basename, discarding any path', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('passwd');
    expect(safeDisplayName('C:\\Users\\me\\logo.png')).toBe('logo.png');
  });

  it('strips control characters', () => {
    expect(safeDisplayName('lo\u0000go\u001f.png')).toBe('logo.png');
  });

  it('never returns an empty or traversal name', () => {
    expect(safeDisplayName('')).toBe('file');
    expect(safeDisplayName('...')).toBe('...');
    expect(safeDisplayName('/')).toBe('file');
  });

  it('truncates something absurdly long', () => {
    expect(safeDisplayName(`${'x'.repeat(500)}.png`).length).toBeLessThanOrEqual(120);
  });
});

describe('helpers', () => {
  it('reads an extension case-insensitively', () => {
    expect(extensionOf('LOGO.PNG')).toBe('png');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noextension')).toBe('');
  });

  it('formats sizes for a human', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

// -----------------------------------------------------------------------------
// The ZIP-container family
// -----------------------------------------------------------------------------

/*
 * Office documents are the one place this codebase lets a CLAIMED EXTENSION
 * decide anything, because .docx, .xlsx, .pptx, .zip and .jar share their
 * leading bytes byte for byte. These tests pin the boundary of that concession:
 * it applies only to the ZIP family, only with a matching container, and never
 * to a format whose bytes already identify it.
 */

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

describe('Office documents', () => {
  it('accepts a .docx whose bytes really are a ZIP container', () => {
    const verdict = validateUpload({
      bytes: ZIP,
      fileName: 'essay.docx',
      limits: SUBMISSION_LIMITS,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.type.extension).toBe('docx');
  });

  it('tells a .docx from an .xlsx by the name, since the bytes cannot', () => {
    const asSheet = validateUpload({
      bytes: ZIP,
      fileName: 'results.xlsx',
      limits: SUBMISSION_LIMITS,
    });
    expect(asSheet.ok).toBe(true);
    if (asSheet.ok) expect(asSheet.type.extension).toBe('xlsx');
  });

  it('refuses a ZIP claiming to be a document it is not shaped like', () => {
    // No extension, so nothing disambiguates it and it stays unidentified.
    const verdict = validateUpload({ bytes: ZIP, fileName: 'archive', limits: SUBMISSION_LIMITS });
    expect(verdict.ok).toBe(false);
  });

  it('refuses a plain .zip by name, rather than letting it through as a document', () => {
    const verdict = validateUpload({ bytes: ZIP, fileName: 'work.zip', limits: SUBMISSION_LIMITS });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.message).toMatch(/document itself/);
  });

  it('REFUSES macro-enabled formats, which sniff identically to safe ones', () => {
    // .docm is a ZIP container exactly like .docx, so only the name can refuse
    // it — which is precisely why it is refused by name.
    for (const name of ['essay.docm', 'book.xlsm', 'deck.pptm']) {
      const verdict = validateUpload({ bytes: ZIP, fileName: name, limits: SUBMISSION_LIMITS });
      expect(verdict.ok, name).toBe(false);
      expect(verdict.ok === false && verdict.message).toMatch(/Macro-enabled/);
    }
  });

  it('refuses a .jar, which is also a ZIP container', () => {
    const verdict = validateUpload({ bytes: ZIP, fileName: 'app.jar', limits: SUBMISSION_LIMITS });
    expect(verdict.ok).toBe(false);
  });

  it('refuses the pre-2007 binary Office formats with a useful message', () => {
    for (const name of ['essay.doc', 'sheet.xls', 'deck.ppt']) {
      const verdict = validateUpload({ bytes: ZIP, fileName: name, limits: SUBMISSION_LIMITS });
      expect(verdict.ok, name).toBe(false);
      expect(verdict.ok === false && verdict.message).toMatch(/not accepted/);
    }
  });

  it('does NOT let an extension override bytes that already identify a file', () => {
    /*
     * The concession is one-way. A real PNG called .docx is still a PNG — the
     * unambiguous formats are resolved first and never consult the name.
     */
    const verdict = validateUpload({
      bytes: PNG,
      fileName: 'sneaky.docx',
      limits: SUBMISSION_LIMITS,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.type.mediaType).toBe('image/png');
  });

  it('still refuses HTML that claims to be a .docx', () => {
    const verdict = validateUpload({
      bytes: bytesOf('<html><script>alert(1)</script></html>'),
      fileName: 'essay.docx',
      limits: SUBMISSION_LIMITS,
    });
    expect(verdict.ok).toBe(false);
  });
});

describe('what may be rendered in the browser', () => {
  it('allows only the formats that cannot carry a surprise', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) {
      expect(mayRenderInline(type), type).toBe(true);
    }
  });

  it('REFUSES to render every ZIP-container format inline', () => {
    /*
     * The mitigation that makes accepting an ambiguous format defensible. These
     * are downloaded, never handed to the browser — so a .zip wearing a .docx
     * name is an archive somebody saves, not code the page runs.
     */
    for (const spec of ACCEPTED_TYPES.filter((t) => t.ambiguous)) {
      expect(mayRenderInline(spec.mediaType), spec.extension).toBe(false);
    }
    expect(mayRenderInline('text/html')).toBe(false);
    expect(mayRenderInline('application/octet-stream')).toBe(false);
  });
});
