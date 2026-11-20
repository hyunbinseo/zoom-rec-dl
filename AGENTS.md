# zoom-rec-dl

## Zoom API

- The library calls the web player's `/nws/recording/1.0/*` endpoints.
- Share links can be:
  - public
  - passcode-protected (`?pwd=`)
  - sign-in or registration required (unsupported)
- Types in `src/types.ts` mirror Zoom's Cloud Recording API.
  - Base them on the spec: [Get meeting recordings](https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording/GET/meetings/{meetingId}/recordings) (`recording_files[]`).
  - Besides MP4 and M4A, a recording can include `TRANSCRIPT`, `CHAT`, `CC`, `CSV`, `SUMMARY`, and other file types.
