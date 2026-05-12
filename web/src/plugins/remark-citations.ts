const citeKeyPattern = '[a-zA-Z][a-zA-Z0-9_-]*';

export function remarkCitations(options?: { bibEntries?: Map<string, { author?: string; year?: string; [k: string]: unknown }> }) {
  const bibEntries = options?.bibEntries;

  const formatNarrative = (key: string): string => {
    if (!bibEntries) return key;
    const entry = bibEntries.get(key);
    if (!entry?.author) return key;
    const authorStr = formatAuthorShort(entry.author as string);
    const year = entry.year ? ` (${entry.year})` : '';
    return `${authorStr}${year}`;
  };

  const formatParenthetical = (key: string): string => {
    if (!bibEntries) return key;
    const entry = bibEntries.get(key);
    if (!entry?.author) return key;
    const authorStr = formatAuthorShort(entry.author as string);
    const year = entry.year ? ` ${entry.year}` : '';
    return `${authorStr}${year}`;
  };

  function formatAuthorShort(authorField: string): string {
    const authors = authorField.split(/\s+and\s+/i);
    const lastName = extractLastName(authors[0]);
    if (authors.length > 2) return `${lastName} et al.`;
    if (authors.length === 2) return `${lastName} & ${extractLastName(authors[1])}`;
    return lastName;
  }

  function extractLastName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.includes(',')) return trimmed.split(',')[0].trim();
    const parts = trimmed.split(/\s+/);
    return parts[parts.length - 1];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeCiteLink = (key: string, displayText: string): any => ({
    type: 'link',
    url: `#cite-${key}`,
    title: key,
    children: [{ type: 'text', value: displayText }],
    data: { hProperties: { className: 'markdown-citation-link', 'data-cite-key': key } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformNode = (node: any): any[] => {
    if (!node) return [];
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'math' || node.type === 'inlineMath') return [node];

    if (node.type === 'text' && typeof node.value === 'string') {
      const value = node.value;
      const combinedRegex = new RegExp(
        `(\\(@!${citeKeyPattern}\\))|([\\[\\(]@${citeKeyPattern}(?:\\s*;\\s*@${citeKeyPattern})*[\\]\\)])|(?<![\\w@])@(${citeKeyPattern})(?![\\w-])`,
        'g'
      );
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newNodes: any[] = [];
      let hadMatch = false;

      while ((match = combinedRegex.exec(value)) !== null) {
        if (match.index > lastIndex) newNodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        hadMatch = true;
        if (match[1]) {
          // nocite
        } else if (match[2]) {
          const inner = match[2].slice(1, -1);
          const keys = inner.split(/\s*;\s*/).map((k: string) => k.replace(/^@/, ''));
          newNodes.push({ type: 'text', value: '(' });
          keys.forEach((key: string, index: number) => {
            if (index > 0) newNodes.push({ type: 'text', value: '; ' });
            newNodes.push(makeCiteLink(key, formatParenthetical(key)));
          });
          newNodes.push({ type: 'text', value: ')' });
        } else if (match[3]) {
          newNodes.push(makeCiteLink(match[3], formatNarrative(match[3])));
        }
        lastIndex = match.index + match[0].length;
      }

      if (hadMatch) {
        if (lastIndex < value.length) newNodes.push({ type: 'text', value: value.slice(lastIndex) });
        return newNodes;
      }
    }

    if (Array.isArray(node.children)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node.children = node.children.flatMap((child: any) => transformNode(child));
    }
    return [node];
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    if (Array.isArray(tree.children)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tree.children = tree.children.flatMap((child: any) => transformNode(child));
    }
  };
}
