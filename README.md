# zoom-rec-dl

Save Zoom cloud recordings to a local directory. A cross-platform video and audio download script.

## Requirements

- Windows, macOS, and Linux - any operating system that supports [Node.js] and [npm].
- Zoom cloud recording share link that does not require any additional authentication.

[node.js]: (https://nodejs.org/)
[npm]: (https://www.npmjs.com/)

---

For protected cloud recordings, the shareable link

- Should have the passcode embedded in the link.
- Should show a media player and a download button.
- Should not show an 'Enter the passcode to watch'.

Reference the [documentation](https://support.zoom.us/hc/en-us/articles/11692220055821) and enable the following settings in the Zoom web portal.

- Require passcode to access shared cloud recordings
- Embed passcode in the shareable link for one-click access

## Prerequisites

- [Node.js] 18+
- [npm] 9+

To check the versions, execute the following commands in a terminal window.

- `node -v`
- `npm -v`

If not found or outdated, [download](https://nodejs.org/en/download/) and install the latest Node.js LTS release.

- [npm] should be installed. (Included in the Node.js installer)
- `Add to PATH` option should be checked. (Windows only)

## Instructions

1. Create a `urls.txt` file in a desired place.
2. Add URLs to the text file, one in each line.
3. Open a terminal window in the directory.[^1]
4. Execute `npx zoom-rec-dl@latest`

[^1]: When `ls` or `dir` command is executed, the `urls.txt` file should be listed.
