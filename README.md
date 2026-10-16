# Free Fire MAX BR Tournament Portal

A responsive starter website for your 45-squad tournament. Includes:
- Team registration with captain, squad name and four player IDs
- Password hashing and login
- Admin approval/rejection and team deletion
- Admin-entered match scores and public points table
- Team profile with score history and total points
- Admin controls for registration fee and prizes for places 1–9
- SQLite database

## Run locally

Requires Node.js 20 or newer.

1. Extract this ZIP.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Set admin environment variables before the first run:
   - `ADMIN_EMAIL=your-admin-email`
   - `ADMIN_PASSWORD=a-long-unique-password`
   - `SESSION_SECRET=a-long-random-secret`
5. Start with `npm start`.
6. Open `http://localhost:3000`.

PowerShell example:
```powershell
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="Choose-A-Long-Unique-Password"
$env:SESSION_SECRET="replace-this-with-a-long-random-secret"
npm install
npm start
```

The initial admin is created only when the database is first created and the two admin environment variables are set. Do not use a sample or shared password.

## Deploying online

This is a Node.js web service, not a static-only site. Deploy it to a Node hosting provider that supports persistent storage. Configure:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (strong unique password)
- `SESSION_SECRET` (long random secret)
- `NODE_ENV=production`
- `DB_FILE` pointing to a persistent disk path, if supported (for example `/var/data/tournament.db`)

Attach a persistent disk/volume for the SQLite database. Without persistent storage, accounts and scores may be lost on redeploy/restart. Keep the admin password private. Enable HTTPS. Do not commit `.env`, database files, or credentials to GitHub.

## Important notes before public launch

- The included default prizes/entry fee are examples based on a ₹80 entry fee and top 9 prizes; the admin can change them.
- The app records team-level kills/points. Admin can put individual player details in the score note, but a separate normalized individual-player leaderboard is not yet included.
- For public tournaments, add rate limiting, email verification/password reset, CSRF protection, database backups, and a persistent production session store before launch.
- Publish tournament rules and refund/dispute policy before accepting fees.


## Android + Render deployment walkthrough

1. Download and extract the ZIP using your Android file manager.
2. In a browser, sign in to GitHub and create a new repository. Upload `package.json`, `server.js`, `.gitignore`, and `README.md` at the repository root (not inside an extra nested folder).
3. In Render, create a **Web Service** and connect the GitHub repository.
4. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Runtime: Node
5. Add environment variables in Render:
   - `ADMIN_EMAIL` = the admin email you control
   - `ADMIN_PASSWORD` = a unique, long password
   - `SESSION_SECRET` = a long random secret
   - `NODE_ENV` = `production`
   - `DB_FILE` = `/var/data/tournament.db` (only after attaching a persistent disk mounted at `/var/data`)
6. Attach a persistent disk/volume at `/var/data` and redeploy. Check the hosting provider's current plan/pricing and disk availability; a persistent disk may require a paid plan.
7. Open the deployed HTTPS URL. Register a test team, log out, sign in as admin, approve the team, then test team scoring and individual player scoring.

Important: the initial admin account is created on first startup only if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set and the database is empty. If you change the password environment variable after the admin already exists, it will not automatically change the stored password. Never share admin credentials or put them in the repository.
