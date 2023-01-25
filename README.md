# zoom-rec-dl

Save Zoom cloud recordings to a local directory. A cross-platform video and audio download script.

## Requirements

- Windows, macOS, and Linux. Any operating system that supports [Node.js](https://nodejs.org/) v18 or later.
- Zoom cloud recording share link that does not require any additional authentication. [^1]

---

For protected cloud recordings, the passcode should be embedded in the shareable link.

Reference the [documentation](https://support.zoom.us/hc/en-us/articles/11692220055821) and enable the following settings in the Zoom web portal.

✅ Require passcode to access shared cloud recordings\
✅ Embed passcode in the shareable link for one-click access

## Instructions

> **Note**
> Cloud recordings will be downloaded inside the unzipped folder.

1. [Download](https://github.com/hyunbinseo/zoom-rec-dl/archive/refs/heads/main.zip) and unzip the code in a desired location.
2. Add cloud recording share links to the `urls.json` file.
3. [Download](https://nodejs.org/en/download/) and install [Node.js](https://nodejs.org/). Check `Add to PATH` option.
4. Open a terminal in the unzipped folder where `index.js` exists.
5. Run `node index.js` or `node index`

---

If the following error occurs, the terminal is not opened in the correct location.

```
node:internal/modules/cjs/loader:1042
  throw err;
  ^

Error: Cannot find module '/Users/username/.../index.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1039:15)
    at Module._load (node:internal/modules/cjs/loader:885:27)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:81:12)
    at node:internal/main/run_main_module:23:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v18.13.0
```

Check if `index.js` is listed by running `ls` or `dir` command in the terminal.

```
# macOS Terminal
# Windows PowerShell

% ls
README.md	index.js	package.json	urls.json
downloads	jsconfig.json	settings.json
```

```
# Windows Command Prompt (cmd.exe)
# Windows PowerShell

> dir
2023-01-06  오전 09:34             7,374 index.js
2023-01-06  오전 09:34               104 settings.json
2023-01-06  오전 09:34               545 urls.json
```

## Customizations

Edit the `settings.json` file if necessary.

```jsonc
{
	"download_folder": "downloads", // string, lowercase alphabets only (a-z)
	"filename_meeting_topic": true, // boolean
	"filename_unix_timestamp": false // boolean
}
```

[^1]: Should show a media player and a download button. Should not show an 'Enter the passcode to watch' message.
