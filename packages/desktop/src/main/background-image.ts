import { app, dialog, nativeImage, type BrowserWindow, type NativeImage } from "electron"
import { rm, stat, writeFile, readFile } from "node:fs/promises"
import { extname, join } from "node:path"

// Stored as a single fixed-name file (no extension) in userData. Fixed name avoids
// wildcard matching conflicts. The file is kept in its original format when
// nativeImage cannot decode it (some Windows image variants).
const FILENAME = "background-image"
const MAX_BYTES = 20 * 1024 * 1024
const MAX_WIDTH = 1920

export type BackgroundImage = { dataURL: string; width: number; height: number }

const imageFilters = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]

function imagePath() {
  return join(app.getPath("userData"), FILENAME)
}

function mimeFromExt(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png": return "image/png"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".gif": return "image/gif"
    case ".webp": return "image/webp"
    case ".bmp": return "image/bmp"
    default: return "image/png"
  }
}

function mimeFromBytes(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png"
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp"
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp"
  return "image/png"
}

function toDataURL(buffer: Buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

// Resize to <= MAX_WIDTH keeping aspect ratio; returns the original when small enough.
function fit(image: NativeImage) {
  const { width, height } = image.getSize()
  if (width <= MAX_WIDTH) return image
  const scale = MAX_WIDTH / width
  return image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
}

export async function pickBackgroundImage(win?: BrowserWindow): Promise<BackgroundImage | null> {
  const result = win
    ? await dialog.showOpenDialog(win, { properties: ["openFile"], title: "Choose a background image", filters: imageFilters })
    : await dialog.showOpenDialog({ properties: ["openFile"], title: "Choose a background image", filters: imageFilters })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  if ((await stat(filePath)).size > MAX_BYTES) throw new Error("background-image: file exceeds 20MB limit")

  const buffer = await readFile(filePath)
  const image = nativeImage.createFromBuffer(buffer)

  if (!image.isEmpty()) {
    const fitted = fit(image)
    const png = fitted.toPNG()
    await writeFile(imagePath(), png)
    const { width, height } = fitted.getSize()
    const dataURL = toDataURL(png)
    console.log("[background-image] pick returning:", { pngBytes: png.length, dataURLLength: dataURL.length, width, height })
    return { dataURL, width, height }
  }

  // nativeImage could not decode the file (unsupported variant on this platform).
  // Save the raw buffer so the image still works as a CSS background-image.
  const mime = mimeFromExt(filePath)
  await writeFile(imagePath(), buffer)
  const dataURL = toDataURL(buffer, mime)
  console.log("[background-image] pick returning (raw fallback):", { bytes: buffer.length, dataURLLength: dataURL.length, mime })
  return { dataURL, width: 0, height: 0 }
}

export async function getBackgroundImage(): Promise<BackgroundImage | null> {
  // File may not exist (never set or externally removed) — treat as no image.
  let buffer: Buffer
  try {
    buffer = await readFile(imagePath())
  } catch {
    return null
  }
  const image = nativeImage.createFromBuffer(buffer)
  if (!image.isEmpty()) {
    const { width, height } = image.getSize()
    return { dataURL: toDataURL(buffer), width, height }
  }
  // Fallback: saved file couldn't be decoded either, but it may still work
  // as a CSS background-image served as a data URL.
  return { dataURL: toDataURL(buffer, mimeFromBytes(buffer)), width: 0, height: 0 }
}

export async function clearBackgroundImage(): Promise<void> {
  await rm(imagePath(), { force: true })
}
