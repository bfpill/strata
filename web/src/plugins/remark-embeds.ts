function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function remarkEmbeds() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    if (!Array.isArray(tree.children)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tree.children = tree.children.map((node: any) => {
      if (node.type !== 'paragraph' || !Array.isArray(node.children) || node.children.length !== 1) return node;
      const child = node.children[0];
      if (child.type !== 'link' || !child.url) return node;
      const text = (child.children?.[0]?.value ?? '').trim();
      if (!text.match(/^embed\b/i)) return node;
      const stylePart = text.replace(/^embed:?\s*/i, '').trim();
      const style = stylePart || 'width:100%;height:500px;border:none';
      return { type: 'html', value: `<iframe src="${escapeAttr(child.url)}" style="${escapeAttr(style)}" frameborder="0" allowfullscreen loading="lazy"></iframe>` };
    });
  };
}
