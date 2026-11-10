# Resero Defects

Defect registers for Resero projects: floor plans with pins, room boundaries that recognise the room you tap,
dictation with a Gemini helper, photos with markup, and branded exports (PDF schedule, Excel, Procore CSV, zip).

**App:** https://tony-aria-reyna.github.io/defect-tool/
**Try it without signing in:** https://tony-aria-reyna.github.io/defect-tool/?demo (data stays in that browser only)

## How it works
- Static web app on GitHub Pages; no build step. Install on a phone with "Add to Home Screen".
- Sign-in, data and files are in Firebase project `resero-site-tools` (Sydney): Authentication (Google and email link),
  Firestore (projects, plans, room boundaries, defects) and Storage (plan images and photos).
- Firestore keeps an offline copy, so the register works with no signal. Photos taken offline wait on the device and upload when back online.
- Libraries are kept in `/lib` (Firebase 12.6.0, pdf.js, pdf-lib, JSZip, SheetJS), so nothing loads from other sites.

## Roles (per project)
| Role | Can do |
|---|---|
| Admin | Project settings, plans, room boundaries, users, everything below |
| Editor | Raise, edit and close defects, import registers, export |
| Contractor | View, add photos and comments, set In progress / Ready for review |
| Viewer | View and export |

System administrators (listed in Firestore `system/admins`) can create projects and see every project.

## One-off Firebase setup
1. **Authentication**: enable Google, and Email/Password with "Email link (passwordless sign-in)". Under Settings > Authorised domains add `tony-aria-reyna.github.io`.
2. **Firestore**: create the database in `australia-southeast1`, production mode. Rules: paste `firestore.rules` and Publish.
3. **Blaze plan** with a budget alert, then **Storage** in `australia-southeast1`. Rules: paste `storage.rules` and Publish.
4. **System administrator**: sign in to the app once, copy your user ID from the projects page, then in Firestore create
   collection `system`, document `admins`, field `uids` (array) containing that ID. Reload the app.
5. **Gemini helper** (optional but recommended): see `helper/Code.gs`, then enter its address and key in the app under ☰ > Gemini.
6. **Storage CORS** (so photos and plans can go into PDF exports and be marked up): in the Google Cloud console open Cloud Shell and run
   ```
   echo '[{"origin":["https://tony-aria-reyna.github.io"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gcloud storage buckets update gs://resero-site-tools.firebasestorage.app --cors-file=cors.json
   ```

## Starting a project
☰ > New project (system admin) > fill in details and client logo > upload plan PDFs > set block and level for each plan >
☰ > Room boundaries (draw unit outlines and rooms, then "Duplicate unit with its rooms") > ☰ > Users and access (invite people) >
☰ > Import register (Excel/CSV, or a v1 backup file).

## Files
- `index.html`, `css/app.css`: layout
- `js/app.js`: screens, register, defect editor, exports menu
- `js/admin.js`: project settings, users, plans, room boundaries, import, Gemini settings
- `js/planview.js`: plan viewer (pan, zoom, pins, boundary drawing)
- `js/store.js`: data layer (Firebase, and the local demo store)
- `js/exports.js`: PDF / Excel / CSV / zip
- `js/ai.js`, `js/photos.js`, `js/util.js`, `js/state.js`, `js/config.js`
- `firestore.rules`, `storage.rules`: security rules (paste into the Firebase console)
- `helper/Code.gs`: Google Apps Script Gemini helper

Prepared by Resero Property.
