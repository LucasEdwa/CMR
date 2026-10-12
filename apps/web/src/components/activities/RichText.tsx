import type { ReactNode } from 'react'
import type { RichDoc, RichNode } from '@crm/shared'

// Renders stored note JSON with React elements only (no innerHTML), so a note can never inject markup.
function renderNode(node: RichNode, key: number): ReactNode {
  switch (node.type) {
    case 'text': {
      let out: ReactNode = node.text
      for (const mark of node.marks ?? []) {
        out = mark.type === 'bold' ? <strong>{out}</strong> : mark.type === 'italic' ? <em>{out}</em> : <s>{out}</s>
      }
      return <span key={key}>{out}</span>
    }
    case 'mention':
      return (
        <span key={key} className="bg-primary/10 text-primary rounded px-1 font-medium">
          @{node.attrs.label}
        </span>
      )
    case 'hardBreak':
      return <br key={key} />
    case 'paragraph':
      return <p key={key}>{children(node.content)}</p>
    case 'bulletList':
      return (
        <ul key={key} className="list-disc pl-5">
          {children(node.content)}
        </ul>
      )
    case 'orderedList':
      return (
        <ol key={key} className="list-decimal pl-5">
          {children(node.content)}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{children(node.content)}</li>
  }
}

const children = (nodes: RichNode[] | undefined) => nodes?.map(renderNode)

export function RichText({ doc }: { doc: RichDoc }) {
  return <div className="grid gap-1.5 text-sm break-words whitespace-pre-wrap">{children(doc.content)}</div>
}
