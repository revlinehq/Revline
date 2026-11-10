# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:
https://github.com/revlinehq/Revline/security/advisories/new

If private reporting is unavailable, contact the repository owner privately through GitHub before disclosing details. Do not open a public issue containing an exploit, credential, signed URL, customer identifier, or private media. Include affected versions, reproduction steps, expected behavior, and impact using your own accounts and data.

Security fixes target the current main branch. Older revisions are not maintained as separate security releases.

## Credentials and deployment

- Create your own Clerk, Convex, storage, AI provider and hosting accounts. Repository identifiers are not credentials and do not grant access to the hosted Revline service.
- Keep local credentials in ignored environment files and hosted credentials in the deployment's secret store. Only intentionally public configuration may use `NEXT_PUBLIC_`.
- Use different credentials for development, staging and production. Keep worker, upload and signing credentials scoped to their role.
- Revoke an exposed credential first. Removing it in a new commit does not remove it from history, forks, caches, logs or artifacts.
- Repository builds, media workers require an appropriate isolated runtime. Do not expose a development server, privileged worker, Docker socket or deployment token to untrusted users.

Automated scans reduce risk but cannot prove that software has no vulnerabilities. Review deployment permissions, authentication, ownership checks and dependency advisories before operating a public instance.

## Automated checks

GitHub Actions is enabled for this repository; individual workflows can still be disabled from the Actions tab, and a disabled workflow runs nothing. When enabled, the Security workflow runs a redacted Gitleaks scan of all reachable history and root and agent-runner production dependency audits on every pull request, every push to main and weekly. It and the Validate workflow run only on GitHub-hosted runners. To run the same checks locally before publishing changes:

```sh
npm audit --omit=dev --audit-level=moderate
npm audit --prefix cf-workers/agent-runner --omit=dev --audit-level=moderate
gitleaks git --redact=100 --no-banner --log-opts="--remotes=origin --tags"
npm run typecheck
npm run build
```

Install Gitleaks from its official release before using the scan command. Fetch the refs being published first. Review exact historical false-positive exceptions rather than disabling secret rules. Keep scan reports private.

## Release runner

Production releases run from `deploy-main.yml` on the maintainer's self-hosted `revline-deploy-pc` runner, which shares a machine with production environment files. Its job refuses anything except the owner's push or manual dispatch on `main` of `revlinehq/Revline`. That guard lives in a workflow file, and a pull request can edit or add workflow files, so it cannot stop a fork's own job from targeting the runner. Disabling existing workflows does not help either, because a newly added workflow file is not disabled. The repository settings are the boundary:

- Require approval for fork pull request workflows from all external contributors.
- Keep the runner in an organization runner group whose workflow access is limited to `revlinehq/Revline/.github/workflows/deploy-main.yml@refs/heads/main`, or remove it from this public repository.

Never approve a fork pull request's workflow run without reviewing every change under `.github/`. Never run simultaneous manual and automated releases. An existing release must finish and release its lock before another starts.
