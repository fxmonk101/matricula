import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_LIMITS,
  LOGO_LIMITS,
  UploadError,
  extensionOf,
  formatBytes,
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
    if (!verdict.ok) expect(verdict.message).toMatch(/do not match any accepted format/);
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
