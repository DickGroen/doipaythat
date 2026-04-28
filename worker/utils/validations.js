export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const VALID_CATEGORIES = ["debt", "parking", "bill", "subscription"];

export function validateUploadInput({ file, name, email, type }) {
  if (!file) return "No file received";
  if (file.size > MAX_FILE_SIZE) return `File too large (max 8 MB, received ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  if (!ALLOWED_TYPES.includes(file.type)) return `File type not allowed (${file.type}). Use PDF, JPG or PNG.`;
  if (!name || !String(name).trim()) return "Name is required";
  if (!email || !String(email).includes("@") || !String(email).includes(".")) return "Invalid email address";
  if (!type || !VALID_CATEGORIES.includes(type)) return `Invalid type. Must be one of: ${VALID_CATEGORIES.join(", ")}`;
  return null;
}
