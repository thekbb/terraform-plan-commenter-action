const longestBacktickRun = (text) => {
    let longest = 0;
    for (const match of text.matchAll(/`+/gu))
        longest = Math.max(longest, match[0].length);
    return longest;
};
export const formatPlanBlock = (plan) => {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(plan) + 1));
    return `${fence}terraform\n${plan}\n${fence}`;
};
export const formatDirectory = (directory) => {
    // Keep line breaks and control characters out of Markdown's block structure.
    // Escaping backslashes too distinguishes a literal '\n' from a real newline.
    const text = JSON.stringify(directory).slice(1, -1);
    const delimiter = '`'.repeat(longestBacktickRun(text) + 1);
    // Padding separates boundary backticks and preserves surrounding spaces
    // under CommonMark's code-span whitespace rules. Normal paths need none.
    const needsPadding = text.startsWith('`') || text.endsWith('`') ||
        (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '');
    const padding = needsPadding ? ' ' : '';
    return `${delimiter}${padding}${text}${padding}${delimiter}`;
};
