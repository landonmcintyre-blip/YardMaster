# YardMaster

Standalone iPhone-friendly yard scanner with its own repository, deployment, backend, storage keys, and scan data:

- ZXing continuous camera scanner
- GitHub Pages/static HTTPS hosting
- Apps Script JSON backend
- local carton cache
- local pending queue with background retry
- ClientScanID idempotency
- loader/PIN sessions with a 9-hour limit

## Setup

1. Replace the contents of the YardMaster Apps Script `Code.gs` with the complete `Code.gs` supplied here.
2. Deploy the Apps Script project as a web app that executes as the owner and allows access without a Google account.
3. Paste that `/exec` URL into `API_URL` at the top of `app.js`.
4. Put `index.html`, `style.css`, `app.js`, and `service-worker.js` in a separate GitHub repository and enable GitHub Pages from the main branch/root.

YardMaster does not use the TrackMaster repository, Apps Script deployment, spreadsheet, sessions, browser storage, service-worker cache, or sync queue.

`API_ADDITION.gs` is included only as a reference showing the API layer that was added. Use the complete `Code.gs` for deployment. Neither `.gs` file belongs in the public GitHub Pages repository.
