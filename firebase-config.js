/* ============================================================================
   FIREBASE SETUP — do this once, it takes about 5 minutes, and it's free.

   You need your OWN Firebase project so that YOU own the accounts and data
   (nobody, including Anthropic or Claude, can create this for you — it
   requires signing in with your own Google account).

   STEP 1 — Create a project
   1. Go to https://console.firebase.google.com
   2. Click "Add project" → give it any name, e.g. "legalscan-ai"
   3. You can disable Google Analytics for this project (not needed) → Create

   STEP 2 — Register a Web App
   1. On the project's home page, click the "</>" (Web) icon to add a web app
   2. Give it a nickname (e.g. "legalscan-web") → Register app
   3. Firebase will show you a `firebaseConfig` object like the placeholder
      below. Copy YOUR values and paste them in below, replacing every
      "YOUR_..." placeholder. Leave the key names (apiKey, authDomain, etc.)
      exactly as they are.

   STEP 3 — Turn on Authentication
   1. In the left sidebar: Build → Authentication → Get started
   2. Under "Sign-in method", enable:
        - "Email/Password"  (toggle it on → Save)
        - "Anonymous"       (toggle it on → Save)  ← powers "Continue as Consumer"

   STEP 4 — Turn on Firestore (the database)
   1. In the left sidebar: Build → Firestore Database → Create database
   2. Choose a location close to you → Start in "production mode" → Enable

   STEP 5 — Paste in security rules (controls who can read/write what)
   1. In Firestore Database, click the "Rules" tab
   2. Replace everything with the rules below, then click "Publish":

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       // Every signed-in user has exactly one profile doc, keyed by their
       // own uid. They can create/read/update only their own profile.
       match /users/{uid} {
         allow read, update: if request.auth != null && request.auth.uid == uid;
         allow create: if request.auth != null && request.auth.uid == uid
                       && request.resource.data.role in ['inspector', 'manufacturer', 'consumer'];
       }

       // Inspections: the owner (uid) can always read/write their own.
       // Inspectors can read (and update, e.g. dispute status) EVERYONE's,
       // which is what powers the admin/Inspector view. Role is looked up
       // from the requester's own locked profile doc, never trusted from
       // the request itself.
       match /inspections/{id} {
         allow read: if request.auth != null && (
             resource.data.uid == request.auth.uid ||
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'inspector'
         );
         allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
         allow update: if request.auth != null && (
             resource.data.uid == request.auth.uid ||
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'inspector'
         );
       }
     }
   }

   STEP 6 — Save this file and reload index.html
   Once real values are below (no more "YOUR_" placeholders), the yellow
   "not configured" banner on the login screen disappears and Sign Up / Log
   In start working for real.

   IMPORTANT — known limitation of this demo: anyone can pick "Inspection
   Officer / Regulator" for themselves at sign-up, so this is NOT real
   access control for a production deployment — it's just enough to
   demonstrate the admin view. A real deployment would gate the Inspector
   role behind an invite code, manual approval, or government SSO, exactly
   as the previous demo note said.
============================================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Used by app.js to detect whether the placeholders above have been
// replaced yet, so it can show a clear banner instead of a login form
// that looks real but silently can't work.
const FIREBASE_IS_CONFIGURED = firebaseConfig.apiKey !== "YOUR_API_KEY" &&
                                !!firebaseConfig.apiKey &&
                                !!firebaseConfig.projectId;
