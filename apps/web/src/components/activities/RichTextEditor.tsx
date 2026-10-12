import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { Bold, Italic, List, ListOrdered } from 'lucide-react'
import type { Member, RichDoc } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MentionItem = { id: string; label: string }
type Popup = { items: MentionItem[]; index: number; rect: DOMRect | null; command: (item: MentionItem) => void } | null

type Props = {
  id?: string
  initial?: RichDoc | null
  placeholder: string
  members: Member[]
  onChange: (doc: RichDoc, empty: boolean) => void
  // Ctrl/Cmd+Enter
  onSubmit?: () => void
  autofocus?: boolean
  invalid?: boolean
}

export function RichTextEditor({ id, initial, placeholder, members, onChange, onSubmit, autofocus, invalid }: Props) {
  const { t } = useTranslation()
  const [popup, setPopup] = useState<Popup>(null)
  // The suggestion plugin is created once; refs give it the current members and popup state.
  const membersRef = useRef(members)
  const popupRef = useRef<Popup>(null)
  const submitRef = useRef(onSubmit)
  useEffect(() => {
    membersRef.current = members
    submitRef.current = onSubmit
  })
  const show = (next: Popup) => {
    popupRef.current = next
    setPopup(next)
  }

  const editor = useEditor({
    extensions: [
      // Only what the server accepts (see richDocSchema): no headings, quotes, code or links.
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      // The suggestion callbacks read the refs only when the user types "@", never during render.
      // eslint-disable-next-line react-hooks/refs
      Mention.configure({
        HTMLAttributes: { class: 'bg-primary/10 text-primary rounded px-1 font-medium' },
        suggestion: {
          char: '@',
          items: ({ query }) =>
            membersRef.current
              .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6)
              .map((m) => ({ id: m.userId, label: m.name })),
          render: () => {
            const update = (props: SuggestionProps<MentionItem>) =>
              show({ items: props.items, index: 0, rect: props.clientRect?.() ?? null, command: props.command })
            return {
              onStart: update,
              onUpdate: update,
              onExit: () => show(null),
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                const current = popupRef.current
                if (!current?.items.length) return false
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  show({ ...current, index: (current.index + step + current.items.length) % current.items.length })
                  return true
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  current.command(current.items[current.index]!)
                  return true
                }
                if (event.key === 'Escape') {
                  show(null)
                  return true
                }
                return false
              },
            }
          },
        },
      }),
    ],
    content: initial ?? undefined,
    // Keeps the toolbar's active states in sync; notes are small, so the re-renders are cheap.
    shouldRerenderOnTransaction: true,
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': placeholder,
        class: 'min-h-20 px-3 py-2 text-sm outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submitRef.current) {
          submitRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichDoc, editor.isEmpty),
  })

  return (
    <div
      className={cn(
        'border-input focus-within:ring-ring/50 rounded-md border shadow-xs focus-within:ring-[3px]',
        invalid && 'border-destructive',
      )}
    >
      <Toolbar editor={editor} label={t('activities.formatting')} />
      <EditorContent editor={editor} />
      {popup && popup.items.length > 0 && popup.rect && (
        <ul
          role="listbox"
          aria-label={t('activities.mentionSomeone')}
          className="bg-popover text-popover-foreground fixed z-50 grid min-w-48 rounded-md border p-1 shadow-md"
          style={{ top: popup.rect.bottom + 4, left: Math.min(popup.rect.left, window.innerWidth - 200) }}
        >
          {popup.items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === popup.index}
              className={cn('cursor-pointer rounded px-2 py-1.5 text-sm', i === popup.index && 'bg-accent')}
              // mousedown keeps focus in the editor
              onMouseDown={(e) => {
                e.preventDefault()
                popup.command(item)
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Toolbar({ editor, label }: { editor: Editor | null; label: string }) {
  const { t } = useTranslation()
  if (!editor) return null
  const buttons = [
    { key: 'bold', icon: Bold, run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { key: 'italic', icon: Italic, run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { key: 'bulletList', icon: List, run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { key: 'orderedList', icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
  ]
  return (
    <div role="toolbar" aria-label={label} className="flex gap-0.5 border-b p-1">
      {buttons.map(({ key, icon: Icon, run, active }) => (
        <Button
          key={key}
          type="button"
          variant="ghost"
          size="icon"
          className={cn('size-7', active && 'bg-muted')}
          aria-label={t(`activities.format.${key}`)}
          aria-pressed={active}
          // Keep focus and the selection in the editor, so typing right after a click is not lost.
          onMouseDown={(e) => e.preventDefault()}
          onClick={run}
        >
          <Icon className="size-3.5" aria-hidden />
        </Button>
      ))}
    </div>
  )
}
