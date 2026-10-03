export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

// Files travel base64-encoded inside JSON: 4/3 overhead plus room for the other fields.
export const DOCUMENT_BODY_LIMIT = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 1024 * 1024;
