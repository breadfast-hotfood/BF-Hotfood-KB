# Breadfast CX Knowledge Base (static site)

A static React/Vite site. There is **no server**: the browser talks directly to Firestore using the signed-in user's
Google ID token, and the Firestore security rules (`firestore.rules`) are what protect the data.

- Access: verified Google accounts ending `@breadfast.com`, plus one fixed Main Admin account (see `firestore.rules`).
- The knowledge base itself is stored in Firestore and published from the Administration Center (Admins only).
- This repository must contain **no data files** (`.xlsx`, `.csv`, ...). The deploy workflow fails if one is committed.

## Local development
```
npm install --legacy-peer-deps
npm run dev      # http://localhost:3000
npm test
npm run build
```

## Layout
- `src/utils/localApi.ts`: in-browser replacement for the former `/api/*` server endpoints.
- `src/utils/kbChunks.ts`, `kbPublish.ts`: versioned, checksummed storage of the KB in Firestore chunks.
- `firestore.rules`: publish these in the Firebase Console (Firestore, the right database, Rules).
- Add the site's domain in Firebase Console, Authentication, Settings, Authorized domains.
