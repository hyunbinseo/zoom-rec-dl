# zoom-rec-dl

Download Zoom cloud recordings from share links. Provides both a CLI and a Node.js API.

## Requirements

- [Node.js] 26 LTS (26.13.0) or later.
- A Zoom cloud recording share link that does not require sign-in. If the recording is protected, the passcode should be embedded in the link (`?pwd=...`).

[node.js]: https://nodejs.org/

## CLI

Install a pinned version in a new directory, so that a new release doesn't change how downloads work:

```shell
npm install --save-exact zoom-rec-dl
# pnpm add --save-exact zoom-rec-dl
```

Create a `recordings.txt` file in the same directory with one URL per line. Only lines that start with `https://` are read. Text after a URL is ignored.

```
https://example.zoom.us/rec/share/...?pwd=...
https://zoom.us/rec/play/...?pwd=...
```

Optionally, create a `config.mts` file. It is type-checked by your editor.

```ts
import { defineConfig } from 'zoom-rec-dl';

export default defineConfig({
  // Optional. Saves to `downloads/2026-11-21/`, using the recording's start date in the time zone.
  group: { by: 'date', timeZone: 'Asia/Seoul' },
  // Optional. Downloads all files if omitted.
  select: {
    // Recording types to download, in order of preference. List more types to fall back to.
    types: ['active_speaker', 'shared_screen_with_speaker_view', 'audio_only'],
    // Maximum number of types per recording, picked in `types` order. Or 'none'.
    limit: 1,
  },
});
```

A recording with no matching types is reported as failed. Fewer matching types than `limit` is not a failure.

Then run the installed version with your package manager's `exec` command:

```shell
npm exec zoom-rec-dl
# pnpm exec zoom-rec-dl
```

Files are saved to the `downloads` directory as `{topic} {file name}`. Files that already exist with the same size are skipped. The CLI exits with code 1 if any recording fails.

Update by changing the pinned version: `npm install --save-exact zoom-rec-dl@<version>`.

### Migrating from v2

- v2 ran with `npx zoom-rec-dl@latest`. Install a pinned version instead.
- `urls.txt` is no longer read. Rename it to `recordings.txt`.
- Email notifications (`sendgrid.json`) were removed.

## API

```ts
import { ValiError, ZoomError, downloadFile, getRecording } from 'zoom-rec-dl';

const recording = await getRecording(url);
// { topic, start_time, duration, recording_count, recording_files: [{ recording_type, file_type, download_url, ... }] }

for (const file of recording.recording_files) {
  if (file.recording_type !== 'active_speaker') continue;
  await downloadFile(file, { dir: 'downloads', onProgress: ({ received, total }) => {} });
}
```

The returned object mirrors the [Get meeting recordings](https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording) response of Zoom's Cloud Recording API: `recording_type` is one of `active_speaker`, `gallery_view`, `shared_screen`, `shared_screen_with_speaker_view`, `shared_screen_with_gallery_view`, `audio_only`.

Errors:

- `ZoomError` - Zoom responded with an error. e.g. `This recording does not exist. (3301)`
- `ValiError` - Zoom responded with data that does not match the expected shape.
- `Error` - e.g. downloads disabled by the host, unknown recording file name.

## How It Works

Zoom's Cloud Recording API requires the host account's OAuth token, so it cannot be used with share links. This library makes the same requests as Zoom's web player, and validates every response.

1. `GET /nws/recording/1.0/play/share-info/{shareId}?pwd=` returns the play ID (`redirectUrl`) and play parameters.
2. `GET /nws/recording/1.0/play/info/{playId}?pwd=&continueMode=true&...` returns the meeting and clip information.
3. The player's download button:
   - `POST /nws/recording/1.0/download-meeting/{encryptMeetingId}?startTime=` returns all files (`clipDownload: true`).
   - `GET /nws/recording/1.0/sdownload/{playId}` returns a single file (`clipDownload: false`).
4. Files are downloaded from the signed `ssrweb.zoom.us` URLs with a `Referer: https://zoom.us/` header.

These are undocumented endpoints and may change without notice.
