# zoom-rec-dl

Cross-platform Zoom cloud recordings download script.

## Requirement

- Windows, macOS, and Linux. Any operating system that supports [Node.js](https://nodejs.org/) v18 or later.
- Zoom URL[^1] that includes a password. (e.g. `"https://zoom.us/rec/share/id?pwd=`)

## Instruction

1. [Download](https://nodejs.org/en/download/) and install[^2] Node.js v18 or later.
2. [Download](https://github.com/hyunbinseo/zoom-rec-dl/archive/refs/heads/main.zip) and unzip[^3] the source code.
3. Enter Zoom URLs in the `urls.json` file.
4. Open a terminal in the same directory.
5. Run `node index.mjs` command.

## Customization

Edit the `settings.json` file if necessary.

```jsonc
{
  "download": {
    "folder": "downloads" // lowercase alphabets only (a-z)
  }
}
```

[^1]: Should show a video player and a download button. Should not show an 'Enter the passcode to watch' message.
[^2]: Node.js should be added to PATH. When `node -v` command is run, it should show a version number. (e.g. `v18.10.0`)
[^3]: The video files will be downloaded in the same folder. A subdirectory called 'downloads' will be created and used.
