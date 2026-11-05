# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:
https://github.com/zuraHQ/revline-editor/security/advisories/new

If private reporting is unavailable, contact the repository owner privately through GitHub before disclosing details. Do not open a public issue containing an exploit, credential, signed URL, customer identifier, or private media. Include affected versions, reproduction steps, expected behavior, and impact using your own accounts and data.

Security fixes target the current main branch. Older revisions are not maintained as separate security releases.

## Credentials and deployment

- Create your own Clerk, Convex, storage, AI provider and hosting accounts. Repository identifiers are not credentials and do not grant access to the hosted Revline service.
- Keep local credentials in ignored environment files and hosted credentials in the deployment's secret store. Only intentionally public configuration may use `NEXT_PUBLIC_`.
- Use different credentials for development, staging and production. Keep worker, upload and signing credentials scoped to their role.
- Revoke an exposed credential first. Removing it in a new commit does not remove it from history, forks, caches, logs or artifacts.
- Repository builds, media workers and scene execution require an appropriate isolated runtime. Do not expose a development server, privileged worker, Docker socket or deployment token to untrusted users.

Automated scans reduce risk but cannot prove that software has no vulnerabilities. Review deployment permissions, authentication, ownership checks and dependency advisories before operating a public instance.
