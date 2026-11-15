# ben-lawson

Interactive About Me site for recruiters. Static site with a browser-side matcher: no AI calls and no keys in the page. Two small Vercel functions (`/api/request-resume`, `/api/log-search`) forward to a Google Apps Script. Visits are counted with Vercel Web Analytics (no cookies).

A recruiter types job titles or requirements (commas or new lines) and each one is checked against Ben's resume. The result is a green **YES** with a proof line, or a red **NOT YET** with an honest note.

## Layout

- `index.template.html` + `data/profile.json` -> `node tools/build.mjs` -> `index.html`
- `matcher.js` the matching engine (runs in the browser and in Node)
- `data/skills.json` skills, synonyms and related terms, and evidence lines (extend this freely)
- `data/titles.json` job titles mapped to sets of skills, plus known gaps
- `data/gaps.json` things Ben has not done, so the matcher can say NOT YET honestly
- `tests/matcher.test.js` run with `npm test`
- `tools/make-images.py [headshot.jpg]` builds the favicon, apple-touch-icon, OG image and portrait (metadata stripped)

## Rules for the data

- Evidence is quoted from Ben's resume (`source: resume`) or confirmed by Ben (`source: confirmed`). Never invent a claim.
- `years` is only set when it can be backed by dates. `null` means the resume does not say.
- Seven plus years of HR, never 8. The leadership development program stays lowercase.
- Contact is email and LinkedIn only. No phone number or street address.

## Deploy

Pushed branches deploy as Vercel previews. Production is promoted only after Ben reviews.

Preview URL pattern: branch deploys at ben-lawson-git-<branch>-beardboss20-projects1.vercel.app (Vercel Authentication on).
