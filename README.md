# MetaDADDY

MetaDADDY is a Windows-first desktop app for inspecting embedded video and image metadata without going to the terminal. It uses ExifTool for deep metadata and ffprobe for stream/container details.

## Current MVP

- Select or drag in a video/image file.
- Drag/drop works anywhere in the window.
- View ExifTool-level metadata with grouping, search, and raw export.
- View ffprobe stream/container metadata for video files.
- Generate a still preview image without playback.
- Fill common metadata fields.
- Save metadata as a JSON or XMP sidecar.
- Write embedded metadata to a new copy, leaving the original file untouched.

## Development

```powershell
npm.cmd install
npm.cmd start
```

## Windows build

```powershell
npm.cmd run dist:win
```

## macOS build

macOS packaging must run on macOS:

```bash
npm run dist:mac
```

The included GitHub Actions workflow builds both Windows and macOS installers from the `main` branch.
