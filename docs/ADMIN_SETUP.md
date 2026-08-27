# Admin authentication setup

Set these variables in Vercel Production: `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
Admin credentials must not be stored in `index.html`.
The frontend receives a short-lived admin JWT and sends it only to `/api/admin/*`.
