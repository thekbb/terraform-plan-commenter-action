import { createHash } from 'node:crypto';
export const normalizeWorkingDirectory = (directory) => {
    // Remove only empty and single-dot segments. Resolving '..' lexically can
    // change the target when an earlier segment is a symlink.
    const segments = directory.split('/').filter((segment) => segment !== '' && segment !== '.');
    const normalized = segments.join('/');
    if (directory.startsWith('/'))
        return `/${normalized}`;
    return normalized === '' ? '.' : normalized;
};
export const commentIdentity = (directory = '.', workspace = 'default') => ({
    directory: normalizeWorkingDirectory(directory), workspace,
});
export const identityMarker = (identity) => {
    const digest = createHash('sha256').update(JSON.stringify([identity.directory, identity.workspace])).digest('hex');
    return `<!-- terraform-plan-comment:v2:${digest} -->`;
};
export const makeMarker = (directory = '.', workspace = 'default') => identityMarker(commentIdentity(directory, workspace));
// During v2, migrate older markers only when the original header disambiguates
// the directory. Never search arbitrary plan/note text for identity.
const matchesPreviousIdentity = (body, identity) => {
    if (/[<>\r\n]/u.test(identity.workspace))
        return false;
    const firstLineEnd = body.indexOf('\n');
    if (firstLineEnd < 0)
        return false;
    const marker = body.slice(0, firstLineEnd);
    const prefix = `${marker}\n### Terraform Plan\n`;
    if (!body.startsWith(prefix))
        return false;
    const header = body.slice(prefix.length);
    const directoryHeader = /^\n📁 `([^`\r\n]+)`\n/u.exec(header);
    const directory = directoryHeader?.[1] ?? (header.startsWith('\n\n') ? '.' : undefined);
    if (directory === undefined || normalizeWorkingDirectory(directory) !== identity.directory)
        return false;
    // Reproduce the old encodings from the recorded spelling, not the new
    // canonical path, so comments with interior/trailing dots can migrate too.
    const legacyDirectory = directory.trim().replace(/^\.\/+/, '').replace(/\/+/g, '/').replace(/\/+$/g, '');
    const legacyValue = legacyDirectory === '' || legacyDirectory === '.' ? 'root' : legacyDirectory.replace(/\//g, '-');
    const legacyMarker = `<!-- terraform-plan-comment:${legacyValue}:${identity.workspace} -->`;
    const previousDirectory = directory.replace(/\/+/gu, '/').replace(/^(?:\.\/)+/u, '').replace(/\/$/u, '');
    const previousMarker = identityMarker({
        directory: previousDirectory === '' ? (directory.startsWith('/') ? '/' : '.') : previousDirectory,
        workspace: identity.workspace,
    });
    return marker === legacyMarker || marker === previousMarker;
};
export const selectOwnedComment = (comments, authorId, identity) => {
    const marker = identityMarker(identity);
    const current = [];
    const legacy = [];
    for (const comment of comments) {
        if (comment.user?.id !== authorId || typeof comment.body !== 'string')
            continue;
        const body = comment.body.replace(/\r\n/gu, '\n');
        if (body === marker || body.startsWith(`${marker}\n`))
            current.push(comment);
        else if (matchesPreviousIdentity(body, identity))
            legacy.push(comment);
    }
    const candidates = current.length > 0 ? current : legacy;
    candidates.sort((first, second) => first.id - second.id);
    return { comment: candidates[0], matches: current.length + legacy.length, migrated: current.length === 0 && legacy.length > 0 };
};
export const authenticatedAuthor = async (graphql) => {
    // viewer works for user tokens and installation tokens, unlike REST /user.
    const response = await graphql('query { viewer { databaseId login } }');
    if (typeof response !== 'object' || response === null || !('viewer' in response) || 'errors' in response) {
        throw new Error('GitHub did not identify the authenticated comment author');
    }
    const viewer = response.viewer;
    if (typeof viewer !== 'object' || viewer === null || !('databaseId' in viewer) || !('login' in viewer) ||
        typeof viewer.databaseId !== 'number' || !Number.isSafeInteger(viewer.databaseId) || viewer.databaseId <= 0 ||
        typeof viewer.login !== 'string' || !viewer.login) {
        throw new Error('GitHub did not identify the authenticated comment author');
    }
    return { id: viewer.databaseId, login: viewer.login };
};
