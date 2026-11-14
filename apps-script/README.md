# Apps Script for Request Resume

`Code.gs` is the web app that receives requests from `/api/request-resume`, appends a row to the sheet, and emails Ben.

1. Open the sheet "ben-lawson.site Resume Requests" > Extensions > Apps Script.
2. Replace the contents of `Code.gs` with this file's contents. Save.
3. Project Settings (gear) > Script Properties > Add property: name `SHARED_SECRET`, value = the secret. Save.
4. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy, then authorize the permissions (spreadsheet and send email).
5. Copy the web app URL (ends in `/exec`).
6. In Vercel project ben-lawson > Settings > Environment Variables, add `APPS_SCRIPT_URL` (that URL) and `APPS_SCRIPT_SECRET` (the same secret). Redeploy.
7. Optional: run `selfTest` once in the editor. It adds a TEST row and sends one email. Delete the row.

If you edit the script later, use Deploy > Manage deployments > Edit > New version, so the URL stays the same.
