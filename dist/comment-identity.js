import { createHash } from 'node:crypto';
export const normalizeWorkingDirectory = (directory) => {
    const normalized = directory.replace(/\/+/gu, '/').replace(/^(?:\.\/)+/u, '').replace(/\/$/u, '');
    return normalized === '' ? (directory.startsWith('/') ? '/' : '.') : normalized;
};
export const commentIdentity = (directory = '.', workspace = 'default') => ({
    directory: normalizeWorkingDirectory(directory), workspace,
});
export const identityMarker = (identity) => {
    const digest = createHash('sha256').update(JSON.stringify([identity.directory, identity.workspace])).digest('hex');
    return `<!-- terraform-plan-comment:v2:${digest} -->`;
};
export const makeMarker = (directory = '.', workspace = 'default') => identityMarker(commentIdentity(directory, workspace));
// During v2, migrate only comments whose original header disambiguates the
// lossy legacy marker. Never search arbitrary plan/note text for identity.
const matchesLegacyIdentity = (body, identity) => {
    if (/[<>\r\n]/u.test(identity.workspace))
        return false;
    const legacyDirectory = normalizeWorkingDirectory(identity.directory.trim());
    const legacyMarker = `<!-- terraform-plan-comment:${legacyDirectory === '.' ? 'root' : legacyDirectory.replace(/\//gu, '-')}:${identity.workspace} -->`;
    const prefix = `${legacyMarker}\n### Terraform Plan\n`;
    if (!body.startsWith(prefix))
        return false;
    const header = body.slice(prefix.length);
    const directoryHeader = /^\n📁 `([^`\r\n]+)`\n/u.exec(header);
    if (directoryHeader?.[1] !== undefined) {
        return normalizeWorkingDirectory(directoryHeader[1]) === identity.directory;
    }
    return identity.directory === '.' && header.startsWith('\n\n');
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
        else if (matchesLegacyIdentity(body, identity))
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
