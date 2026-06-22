const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");
const { exiftool } = require("exiftool-vendored");

const MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "qt",
  "m4v",
  "mxf",
  "avi",
  "mkv",
  "webm",
  "wmv",
  "mts",
  "m2ts",
  "r3d",
  "braw",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "heic",
  "heif",
  "dng",
  "cr2",
  "nef",
  "arw",
  "raf",
  "orf",
  "rw2"
];

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".dng",
  ".cr2",
  ".nef",
  ".arw",
  ".raf",
  ".orf",
  ".rw2"
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".qt",
  ".m4v",
  ".mxf",
  ".avi",
  ".mkv",
  ".webm",
  ".wmv",
  ".mts",
  ".m2ts",
  ".r3d",
  ".braw"
]);

const WRITABLE_FIELDS = [
  { key: "title", label: "Title", tags: ["Title", "ObjectName", "XMP-dc:Title"] },
  { key: "description", label: "Description", tags: ["Description", "ImageDescription", "Caption-Abstract", "XMP-dc:Description"] },
  { key: "creator", label: "Creator", tags: ["Creator", "Artist", "By-line", "XMP-dc:Creator"] },
  { key: "copyright", label: "Copyright", tags: ["Copyright", "CopyrightNotice", "Rights", "XMP-dc:Rights"] },
  { key: "keywords", label: "Keywords", tags: ["Keywords", "Subject", "XMP-dc:Subject"], list: true },
  { key: "project", label: "Project", tags: ["ProjectName", "XMP-xmpDM:ProjectName"] },
  { key: "scene", label: "Scene", tags: ["Scene", "XMP-iptcCore:Scene"] },
  { key: "take", label: "Take", tags: ["TakeNumber", "XMP-xmpDM:TakeNumber"] },
  { key: "reel", label: "Reel", tags: ["ReelName", "TapeName", "XMP-xmpDM:TapeName"] }
];

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#101316",
    title: "MetaDADDY",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "..", "src", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await exiftool.end();
});

ipcMain.handle("app:info", () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform
}));

ipcMain.handle("metadata:select-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select media file",
    properties: ["openFile"],
    filters: [
      { name: "Video and image files", extensions: MEDIA_EXTENSIONS },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return analyzeFile(result.filePaths[0]);
});

ipcMain.handle("metadata:analyze-path", async (_event, filePath) => analyzeFile(filePath));

ipcMain.handle("metadata:export-json", async (_event, payload) => {
  assertFilePayload(payload);
  const defaultPath = path.join(
    path.dirname(payload.filePath),
    `metadata-export-${path.basename(payload.filePath)}.json`
  );
  const result = await dialog.showSaveDialog({
    title: "Export metadata JSON",
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  await fs.writeFile(result.filePath, JSON.stringify(payload.metadata, null, 2), "utf8");
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("metadata:create-sidecar", async (_event, payload) => {
  assertFilePayload(payload);
  const edits = normalizeEditableFields(payload.edits || {});
  if (Object.keys(edits).length === 0) {
    throw new Error("No metadata values were provided.");
  }

  const format = payload.format === "xmp" ? "xmp" : "json";
  const sidecarPath = path.join(path.dirname(payload.filePath), `${path.basename(payload.filePath)}.metadaddy.${format}`);

  if (format === "xmp") {
    await fs.writeFile(sidecarPath, buildXmpSidecar(edits, payload.filePath), "utf8");
  } else {
    await fs.writeFile(
      sidecarPath,
      JSON.stringify(
        {
          sourceFile: payload.filePath,
          createdAt: new Date().toISOString(),
          metadata: edits
        },
        null,
        2
      ),
      "utf8"
    );
  }

  return { path: sidecarPath };
});

ipcMain.handle("metadata:write-embedded-copy", async (_event, payload) => {
  assertFilePayload(payload);
  const edits = normalizeEditableFields(payload.edits || {});
  if (Object.keys(edits).length === 0) {
    throw new Error("No metadata values were provided.");
  }

  const source = payload.filePath;
  const ext = path.extname(source);
  const base = path.basename(source, ext);
  const defaultPath = path.join(path.dirname(source), `${base}.metadata-copy${ext}`);
  const result = await dialog.showSaveDialog({
    title: "Save embedded metadata copy",
    defaultPath,
    filters: [{ name: `${ext.slice(1).toUpperCase() || "Media"} file`, extensions: [ext.slice(1) || "*"] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  await fs.copyFile(source, result.filePath);

  const writeTags = buildExiftoolWriteTags(edits);
  await exiftool.write(result.filePath, writeTags, ["-overwrite_original", "-P", "-m"]);

  return { canceled: false, path: result.filePath };
});

ipcMain.handle("shell:reveal-path", async (_event, filePath) => {
  if (typeof filePath !== "string" || filePath.trim() === "") return;
  shell.showItemInFolder(filePath);
});

async function analyzeFile(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new Error("A file path is required.");
  }

  const normalizedPath = path.resolve(filePath);
  const stat = await fs.stat(normalizedPath);
  if (!stat.isFile()) throw new Error("Please select a file.");

  const extension = path.extname(normalizedPath).toLowerCase();
  const kind = IMAGE_EXTENSIONS.has(extension) ? "image" : VIDEO_EXTENSIONS.has(extension) ? "video" : "unknown";

  const [exif, ffprobe, preview] = await Promise.all([
    readExifMetadata(normalizedPath),
    kind === "video" ? readFfprobeMetadata(normalizedPath) : Promise.resolve(null),
    createPreview(normalizedPath, kind)
  ]);

  return {
    canceled: false,
    file: {
      path: normalizedPath,
      name: path.basename(normalizedPath),
      directory: path.dirname(normalizedPath),
      extension,
      kind,
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString()
    },
    overview: buildOverview(normalizedPath, stat, kind, exif, ffprobe),
    writableFields: deriveWritableFields(exif),
    exif,
    ffprobe,
    preview
  };
}

async function readExifMetadata(filePath) {
  try {
    const tags = await exiftool.read(filePath, ["-G1", "-a", "-s", "-struct", "-api", "LargeFileSupport=1"]);
    return stringifyForTransport(tags);
  } catch (error) {
    return {
      SourceFile: filePath,
      Error: error.message
    };
  }
}

async function readFfprobeMetadata(filePath) {
  if (!ffprobeStatic.path || !existsSync(ffprobeStatic.path)) return null;

  const result = await spawnCapture(ffprobeStatic.path, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-show_chapters",
    "-show_programs",
    filePath
  ]);

  if (result.code !== 0) {
    return { error: result.stderr || "ffprobe could not read the file." };
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { error: error.message, raw: result.stdout };
  }
}

async function createPreview(filePath, kind) {
  if (kind === "image") return createImagePreview(filePath);
  if (kind === "video") return createVideoPreview(filePath);
  return null;
}

async function createImagePreview(filePath) {
  const { nativeImage } = require("electron");
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;

  const resized = image.resize({ width: 900, quality: "best" });
  return {
    type: "image",
    dataUrl: resized.toDataURL(),
    width: resized.getSize().width,
    height: resized.getSize().height
  };
}

async function createVideoPreview(filePath) {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return null;

  const tmpFile = path.join(os.tmpdir(), `metadaddy-${crypto.randomUUID()}.jpg`);
  const result = await tryCreateVideoFrame(filePath, tmpFile, "00:00:00.500");
  const fallbackResult = result.code === 0 && existsSync(tmpFile) ? result : await tryCreateVideoFrame(filePath, tmpFile, "00:00:00");

  if (fallbackResult.code !== 0 || !existsSync(tmpFile)) return null;

  const buffer = await fs.readFile(tmpFile);
  await fs.rm(tmpFile, { force: true });

  return {
    type: "video",
    dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`
  };
}

function tryCreateVideoFrame(filePath, outputPath, timestamp) {
  return spawnCapture(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    timestamp,
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(900,iw)':-2",
    "-q:v",
    "3",
    "-y",
    outputPath
  ]);
}

function spawnCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function buildOverview(filePath, stat, kind, exif, ffprobe) {
  const videoStream = ffprobe?.streams?.find((stream) => stream.codec_type === "video");
  const audioStreams = ffprobe?.streams?.filter((stream) => stream.codec_type === "audio") || [];
  const duration = firstValue([
    ffprobe?.format?.duration,
    exif.Duration,
    exif["QuickTime:Duration"],
    exif["Track1:TrackDuration"]
  ]);
  const width = firstValue([videoStream?.width, exif.ImageWidth, exif.ExifImageWidth, exif["File:ImageWidth"]]);
  const height = firstValue([videoStream?.height, exif.ImageHeight, exif.ExifImageHeight, exif["File:ImageHeight"]]);

  return {
    fileName: path.basename(filePath),
    filePath,
    kind,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    duration,
    dimensions: width && height ? `${width} x ${height}` : null,
    videoCodec: videoStream?.codec_name || exif.CompressorName || exif.Compression || null,
    audio: audioStreams.length ? `${audioStreams.length} stream${audioStreams.length === 1 ? "" : "s"}` : null,
    container: ffprobe?.format?.format_long_name || ffprobe?.format?.format_name || exif.FileType || exif.MIMEType || null
  };
}

function deriveWritableFields(exif) {
  return WRITABLE_FIELDS.map((field) => {
    const value = firstValue(field.tags.map((tag) => exif[tag] ?? exif[tag.replace(/^.*:/, "")]));
    return {
      key: field.key,
      label: field.label,
      value: Array.isArray(value) ? value.join(", ") : value || "",
      isEmpty: value == null || value === "",
      list: Boolean(field.list)
    };
  });
}

function normalizeEditableFields(fields) {
  const validKeys = new Set(WRITABLE_FIELDS.map((field) => field.key));
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([key, value]) => validKeys.has(key) && value != null && value !== "")
  );
}

function buildExiftoolWriteTags(edits) {
  const tags = {};

  for (const field of WRITABLE_FIELDS) {
    if (!(field.key in edits)) continue;
    const value = field.list ? splitListValue(edits[field.key]) : edits[field.key];

    if (field.key === "keywords") {
      tags.Keywords = value;
      tags.Subject = value;
    } else {
      tags[field.tags[0]] = value;
    }
  }

  return tags;
}

function buildXmpSidecar(edits, sourceFile) {
  const escaped = Object.fromEntries(Object.entries(edits).map(([key, value]) => [key, escapeXml(String(value))]));
  const keywordItems = splitListValue(edits.keywords || "")
    .map((keyword) => `          <rdf:li>${escapeXml(keyword)}</rdf:li>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="${escapeXml(path.basename(sourceFile))}"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/">
${escaped.title ? `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escaped.title}</rdf:li></rdf:Alt></dc:title>` : ""}
${escaped.description ? `      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escaped.description}</rdf:li></rdf:Alt></dc:description>` : ""}
${escaped.creator ? `      <dc:creator><rdf:Seq><rdf:li>${escaped.creator}</rdf:li></rdf:Seq></dc:creator>` : ""}
${escaped.copyright ? `      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escaped.copyright}</rdf:li></rdf:Alt></dc:rights>` : ""}
${keywordItems ? `      <dc:subject>\n        <rdf:Bag>\n${keywordItems}\n        </rdf:Bag>\n      </dc:subject>` : ""}
${escaped.project ? `      <xmpDM:projectName>${escaped.project}</xmpDM:projectName>` : ""}
${escaped.scene ? `      <xmpDM:scene>${escaped.scene}</xmpDM:scene>` : ""}
${escaped.take ? `      <xmpDM:takeNumber>${escaped.take}</xmpDM:takeNumber>` : ""}
${escaped.reel ? `      <xmpDM:tapeName>${escaped.reel}</xmpDM:tapeName>` : ""}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}

function assertFilePayload(payload) {
  if (!payload || typeof payload.filePath !== "string" || payload.filePath.trim() === "") {
    throw new Error("A source file is required.");
  }
}

function stringifyForTransport(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item instanceof Date) return item.toISOString();
      if (typeof item === "bigint") return item.toString();
      return item;
    })
  );
}

function firstValue(values) {
  return values.find((value) => value != null && value !== "");
}

function splitListValue(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
