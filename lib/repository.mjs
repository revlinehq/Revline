/** The canonical GitHub repository. Its earlier names still redirect, and
 * GitHub Actions, Railway or a CLI may report one of them until the transfer
 * settles everywhere, so repository guards accept them too. */
export const REPOSITORY = 'revlinehq/Revline';
const LEGACY_REPOSITORIES = ['zuraHQ/Revline', 'zuraHQ/revline-editor'];

/** GitHub owner and repository names are case-insensitive.
 * @param {unknown} name */
export const isRevlineRepository = name => typeof name === 'string' && [REPOSITORY, ...LEGACY_REPOSITORIES].some(repo => repo.toLowerCase() === name.toLowerCase());

/** Worker images publish under the canonical owner. Digests pinned before the
 * transfer stay valid under the previous owner. */
export const IMAGE_REGISTRY = `ghcr.io/${REPOSITORY.split('/')[0].toLowerCase()}`;
export const IMAGE_REGISTRIES = [IMAGE_REGISTRY, 'ghcr.io/zurahq'];
