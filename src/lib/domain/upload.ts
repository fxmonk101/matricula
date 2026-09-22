/**
 * =============================================================================
 * UPLOAD VALIDATION
 * =============================================================================
 *
 * Pure. Takes bytes and a claimed name, returns a verdict.
 *
 * THE RULE: THE BYTES DECIDE, NOT THE CLAIM
 * -----------------------------------------
 * A browser sends `Content-Type` and a filename, and both are supplied by
 * whoever is uploading. `image/png` on a payload that is actually HTML is one
 * form submission away, and a server that believes the header will happily
 * store an HTML document and later serve it back from its own origin — which
 * is stored XSS with extra steps.
 *
 * So every check here reads the leading bytes. The declared type is used for
 * exactly one thing: telling the user their file was not what they thought.
 *
 * SVG IS REFUSED, DELIBERATELY
 * ----------------------------
 * SVG is not an image format in the sense that matters here — it is XML, it can
 * carry `<script>`, and it executes when served inline from your own origin. A
 * school logo has no need of it, and "sanitise the SVG" is the same losing
 * denylist game the forum renderer was designed to avoid. PNG, JPEG and WebP
 * cover every real logo.
 */

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export type UploadKind = 'image' | 'document';

export interface FileTypeSpec {
  /** Canonical media type this codebase will store and serve. */
  mediaType: string;
  extension: string;
  kind: UploadKind;
  /** Leading-byte signature, with `null` meaning "any byte here". */
  signature: readonly (number | null)[];
  /** Additional signature at a fixed offset — WebP needs this. */
  trailer?: { offset: number; bytes: readonly number[] };

  /**
   * True when this format's leading bytes DO NOT identify it uniquely.
   *
   * Every modern Office document is a ZIP archive: .docx, .xlsx and .pptx all
   * begin with the same four bytes as each other, as a plain .zip, and as a
   * .jar. Sniffing can confirm "this is a ZIP container" and can never say
   * which one — so for these, and only these, the claimed extension decides,
   * with the signature demoted to a consistency check.
   *
   * That is a real weakening and it is confined here. It is acceptable only
   * because nothing in this product ever RENDERS one: a stored document is
   * served as an attachment with nosniff, so a .zip wearing a .docx name is an
   * archive somebody downloads, not code the browser runs.
   */
  ambiguous?: boolean;
}

/**
 * The complete set of accepted formats. An allow-list; anything not here is
 * refused, including formats that are perfectly safe but that nothing in the
 * product needs.
 */
export const ACCEPTED_TYPES: readonly FileTypeSpec[] = [
  {
    mediaType: 'image/png',
    extension: 'png',
    kind: 'image',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    mediaType: 'image/jpeg',
    extension: 'jpg',
    kind: 'image',
    // JPEG's fourth byte varies by marker (E0 JFIF, E1 Exif, DB raw), so it is
    // wildcarded rather than pinned to one flavour.
    signature: [0xff, 0xd8, 0xff],
  },
  {
    mediaType: 'image/webp',
    extension: 'webp',
    kind: 'image',
    // RIFF container: "RIFF" then four size bytes then "WEBP".
    signature: [0x52, 0x49, 0x46, 0x46],
    trailer: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  },
  {
    mediaType: 'application/pdf',
    extension: 'pdf',
    kind: 'document',
    signature: [0x25, 0x50, 0x44, 0x46], // "%PDF"
  },

  /*
   * The ZIP-container family. Students submit .docx, and refusing it would mean
   * telling a class to export to PDF before every hand-in — which they will not
   * do, so the work would arrive by email instead and the system would be
   * bypassed for the one thing it exists to collect.
   *
   * All three share the local-file-header signature "PK\x03\x04". They are
   * marked ambiguous so the claimed extension picks between them; see the note
   * on FileTypeSpec.ambiguous for why that is safe HERE and nowhere else.
   */
  {
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    kind: 'document',
    signature: [0x50, 0x4b, 0x03, 0x04],
    ambiguous: true,
  },
  {
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    kind: 'document',
    signature: [0x50, 0x4b, 0x03, 0x04],
    ambiguous: true,
  },
  {
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
    kind: 'document',
    signature: [0x50, 0x4b, 0x03, 0x04],
    ambiguous: true,
  },
];

/** Formats refused by name, so the message can say why rather than "unknown". */
const REFUSED_WITH_REASON: Record<string, string> = {
  svg: 'SVG files can contain scripts, so they are not accepted. Save the logo as PNG or WebP instead.',
  html: 'HTML files are not accepted.',
  htm: 'HTML files are not accepted.',
  js: 'Script files are not accepted.',
  exe: 'Executable files are not accepted.',
  // The pre-2007 binary Office formats are OLE compound files that can carry
  // macros, and unlike the .docx family there is no container check that tells
  // a document from a macro-laden one. Named so the message is useful.
  doc: 'Save it as .docx or PDF — the old .doc format is not accepted.',
  xls: 'Save it as .xlsx or PDF — the old .xls format is not accepted.',
  ppt: 'Save it as .pptx or PDF — the old .ppt format is not accepted.',
  // Macro-enabled variants are ZIP containers like .docx, so they would sniff
  // identically. Refused by name for exactly that reason.
  docm: 'Macro-enabled documents are not accepted. Save it as .docx or PDF.',
  xlsm: 'Macro-enabled spreadsheets are not accepted. Save it as .xlsx or PDF.',
  pptm: 'Macro-enabled presentations are not accepted. Save it as .pptx or PDF.',
  jar: 'Java archives are not accepted.',
  zip: 'Upload the document itself rather than a zip of it.',
};

export interface UploadLimits {
  maxBytes: number;
  kinds: readonly UploadKind[];
}

export const LOGO_LIMITS: UploadLimits = { maxBytes: 2 * 1024 * 1024, kinds: ['image'] };
export const DOCUMENT_LIMITS: UploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  kinds: ['image', 'document'],
};

/**
 * What a student may hand in.
 *
 * 20 MB rather than the 10 of a general document: a dissertation with figures,
 * or a scanned handwritten submission photographed page by page, runs larger
 * than a form upload — and a hand-in refused on size at the deadline is a
 * student who misses it.
 */
export const SUBMISSION_LIMITS: UploadLimits = {
  maxBytes: 20 * 1024 * 1024,
  kinds: ['image', 'document'],
};

export type UploadVerdict =
  | { ok: true; type: FileTypeSpec }
  | { ok: false; message: string };

function matches(bytes: Uint8Array, spec: FileTypeSpec): boolean {
  if (bytes.length < spec.signature.length) return false;
  for (let i = 0; i < spec.signature.length; i += 1) {
    const expected = spec.signature[i];
    if (expected !== null && bytes[i] !== expected) return false;
  }
  if (spec.trailer) {
    const { offset, bytes: tail } = spec.trailer;
    if (bytes.length < offset + tail.length) return false;
    for (let i = 0; i < tail.length; i += 1) {
      if (bytes[offset + i] !== tail[i]) return false;
    }
  }
  return true;
}

/**
 * Identify a file by its bytes, falling back to its claimed extension ONLY for
 * formats whose bytes cannot distinguish them.
 *
 * Unambiguous formats are resolved first and the extension is never consulted
 * for them — a PNG named .docx is still a PNG, and calling it a Word document
 * because somebody typed one would be exactly the mistake sniffing prevents.
 */
export function sniffType(bytes: Uint8Array, claimedExtension?: string): FileTypeSpec | null {
  const unambiguous = ACCEPTED_TYPES.find((spec) => !spec.ambiguous && matches(bytes, spec));
  if (unambiguous) return unambiguous;

  if (!claimedExtension) return null;

  const claimed = claimedExtension.toLowerCase();
  return (
    ACCEPTED_TYPES.find(
      (spec) => spec.ambiguous && spec.extension === claimed && matches(bytes, spec),
    ) ?? null
  );
}

/**
 * Validate an upload.
 *
 * Order matters: size is checked before content, because a refusal for being
 * 400 MB should not require reading 400 MB, and an empty file gets its own
 * message rather than the confusing "we could not tell what this file is".
 */
export function validateUpload(params: {
  bytes: Uint8Array;
  fileName: string;
  limits: UploadLimits;
}): UploadVerdict {
  const { bytes, fileName, limits } = params;

  if (bytes.length === 0) {
    return { ok: false, message: 'That file is empty.' };
  }
  if (bytes.length > limits.maxBytes) {
    return {
      ok: false,
      message: `That file is ${formatBytes(bytes.length)}. The limit is ${formatBytes(limits.maxBytes)}.`,
    };
  }

  const claimed = extensionOf(fileName);
  const refusal = REFUSED_WITH_REASON[claimed];
  if (refusal) return { ok: false, message: refusal };

  const type = sniffType(bytes, claimed);
  if (!type) {
    return {
      ok: false,
      message:
        'That file is not one this system accepts. Images (PNG, JPEG, WebP), PDFs and Word, Excel or PowerPoint documents are.',
    };
  }

  if (!limits.kinds.includes(type.kind)) {
    return {
      ok: false,
      message:
        type.kind === 'document'
          ? 'That is a document. Upload an image here.'
          : 'That file type is not accepted here.',
    };
  }

  return { ok: true, type };
}

/**
 * May this type be rendered in the browser, or must it be downloaded?
 *
 * The allow-list is the point. Anything not named here is served as an
 * attachment, so a format that arrives ambiguous — the whole ZIP-container
 * family — can never be handed to the browser as something to execute.
 */
export function mayRenderInline(mediaType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(mediaType);
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * A safe stored filename.
 *
 * The uploader's filename is never used as a path. It can contain `../`, a null
 * byte, a leading dash, a Windows reserved name, or 4 KB of Unicode — none of
 * which belongs in a filesystem call. The stored name is generated from an id
 * and the extension we *determined*, so the original is kept only as a label.
 */
export function storedFileName(id: string, type: FileTypeSpec): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new UploadError(`Unsafe storage id: ${id}`);
  }
  return `${id}.${type.extension}`;
}

/** A display-safe version of the original name, for showing back to the user. */
export function safeDisplayName(fileName: string, max = 120): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file';
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
