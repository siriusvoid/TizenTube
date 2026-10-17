// Identifies a sidebar (guide) entry for the "Disable Sidebar Contents"
// setting. Most entries open a browse page and are keyed by its browseId;
// Search has no browseId but carries a searchEndpoint. Anything else falls
// back to its icon, which is how entries were identified before browseIds
// were used. A blanket 'search' fallback gave every entry without a browseId
// the same key as Search, so hiding Shorts hid Search too.
export function sidebarEntryKey(entry) {
    const endpoint = entry?.navigationEndpoint;
    if (endpoint?.browseEndpoint?.browseId) return endpoint.browseEndpoint.browseId;
    if (endpoint?.searchEndpoint) return 'search';
    return entry?.icon?.iconType || null;
}
