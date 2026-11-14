# Apps Script for Request Resume

`Code.gs` is the web app that receives requests from `/api/request-resume`, appends a row to the sheet, and emails Ben.

## Paste and deploy
1. Open the sheet "ben-lawson.site Resume Requests" > Extensions > Apps Script.
2. Select everything in `Code.gs`, replace it with this repo's `apps-script/Code.gs`, and click Save.
3. Deploy > New deployment > gear icon > Web app. Execute as: Me. Who has access: Anyone. Click Deploy and authorize the permissions (spreadsheet and send email).
4. Copy the web app URL (it ends in `/exec`) and send it back.

The shared secret is already in the sheet's `Config` tab (cell B1), and the script reads it from there. That tab is hidden when the sheet is opened or a request arrives (View > Hidden sheets shows it). Optionally, you can instead store it as a Script Property named `SHARED_SECRET`, which takes priority.

## Later edits
Use Deploy > Manage deployments > Edit > New version, so the URL stays the same.

## Optional test
Run `selfTest` once in the editor. It adds a TEST row and sends one email. Delete the row afterwards.
