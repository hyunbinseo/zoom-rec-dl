# zoom-rec-dl

Save Zoom cloud recordings to a local directory. A cross-platform video download script.

## Requirement

- Windows, macOS, and Linux. Any operating system that supports [Node.js](https://nodejs.org/) v18 or later.
- Zoom URL[^1] that includes a password. (e.g. `https://zoom.us/rec/share/id?pwd=password`)

## Instruction

1. [Download](https://nodejs.org/en/download/) and install[^2] Node.js v18 or later.
2. [Download](https://github.com/hyunbinseo/zoom-rec-dl/archive/refs/heads/main.zip) and unzip[^3] the source code.
3. Enter Zoom URLs in the `urls.json` file.
4. Open a terminal in the same directory.
5. Run `node index.mjs` command.

## Explanation

The script works by

1. Requesting a Zoom URL.
2. Extracting MP4 file URL(s).
3. Downloading MP4 files one by one.
4. Repeating `1-3` for all Zoom URLs.
5. Logging any failed attempts.

## Customization

Edit the `settings.json` file if necessary.

```jsonc
{
  "download_folder": "downloads", // string, lowercase alphabets only (a-z)
  "filename_meeting_topic": true, // boolean
  "filename_unix_timestamp": false // boolean
}
```

[^1]: Should show a video player and a download button. Should not show an 'Enter the passcode to watch' message.
[^2]: Node.js should be added to PATH. When `node -v` command is run, it should show a version number. (e.g. `v18.10.0`)
[^3]: The video files will be downloaded in the same folder. A subdirectory called 'downloads' will be created and used.
