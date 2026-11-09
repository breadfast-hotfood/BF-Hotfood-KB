# Breadfast CX Knowledge Base

An internal knowledge base for Breadfast customer experience teams. Staff can search support guidance, case handling information, scripts, and reference tables. Authorized administrators can publish workbook updates and manage access.

## Architecture

The application is a static React site with no application server. It runs in the user's browser and accesses Firestore using that user's Google sign-in ID token. Firestore security rules are the security boundary: client-side role checks only control the interface and do not grant database access.

The knowledge base is stored in versioned Firestore documents. Publishing parses an Excel workbook in the browser, splits the content into checksummed chunks, writes and verifies a new version, then updates the active-version pointer. Administrators can roll back to an earlier version or delete historical versions.

## Technology

- TypeScript, React, and Vite
- Firebase Authentication and Cloud Firestore
- Tailwind CSS, Lucide icons, and Motion
- `xlsx` for workbook parsing
- GitHub Actions and GitHub Pages for the static site deployment

## Repository layout

- `src/main.tsx` and `src/App.tsx`: application entry point and top-level interface/state.
- `src/components/`: search and workbook views, case drawer, administration tools, and access screens.
- `src/utils/`: workbook parsing, search, access helpers, Firestore client, version publishing, and supporting UI logic.
- `src/firebase.ts` and `firebase-applet-config.json`: Firebase client initialization and deployment-specific client configuration.
- `firestore.rules`: database authorization rules. These are published separately in the Firebase Console.
- `tests/`: focused Node-based regression tests for parsing, publishing, access, and UI helpers.
- `.github/workflows/deploy.yml`: test, build, and GitHub Pages deployment workflow.
- `public/`: static icons and assets served with the site.

## Access and roles

Users sign in with a verified Google account. Company-domain accounts can read the knowledge base unless they are on the blocked list. Administrators have additional publishing and access-management capabilities. The Main Admin has a fixed identity defined in the Firestore rules and can manage the blocked list. Firestore rules independently enforce these permissions for every database request.

## Local development

Node.js 22 is used in continuous integration. The application does not require environment variables for local development.

```sh
npm install --legacy-peer-deps
npm run dev
npm test
npm run lint
npm run build
```

Vite serves the local site at `http://localhost:3000`.

## Tests

`npm test` runs the regression suites for KB publishing, Firestore helpers, access rules, sessions, pointer watching, workbook parsing, UI helpers, Main Admin configuration, and rich-text rendering. `npm run lint` runs the TypeScript compiler without emitting files.

## Deployment and operations

GitHub Actions runs the checks, builds the static site, and deploys it to GitHub Pages. The build sets the repository base path so assets work from the project's Pages URL. The workflow rejects commits containing workbook or CSV data files.

Firestore rules are published manually in the Firebase Console. Ensure the hosted site's domain is listed among Firebase Authentication's authorized domains. If a publish fails, the active pointer remains unchanged; remove the failed version through the administration interface when appropriate.

**This repository contains application logic only. Never commit company knowledge base data or other company data files.**
