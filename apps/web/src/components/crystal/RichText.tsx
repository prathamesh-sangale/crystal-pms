import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useId, useState } from 'react';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/**
 * Rich text — design system section 20.
 *
 * The design system's own demo drives this with `document.execCommand`, which
 * browsers have deprecated and are removing. This is the one place the brief
 * asked for a different implementation: the appearance is unchanged down to
 * the class names, but the engine underneath is ProseMirror.
 *
 * `.rte-area` is attached to the editor's own contenteditable element rather
 * than a wrapper, so the padding, focus ring and placeholder rules all still
 * apply to exactly the element the design system wrote them for.
 */

interface ToolbarButton {
  key: string;
  label: string;
  icon?: IconName;
  text?: string;
  style?: React.CSSProperties;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: ToolbarButton[][] = [
  [
    {
      key: 'bold',
      label: 'Bold',
      text: 'B',
      style: { fontWeight: 800 },
      isActive: (e) => e.isActive('bold'),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Italic',
      text: 'I',
      style: { fontStyle: 'italic', fontFamily: 'Georgia, serif' },
      isActive: (e) => e.isActive('italic'),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      key: 'underline',
      label: 'Underline',
      text: 'U',
      style: { textDecoration: 'underline' },
      isActive: (e) => e.isActive('underline'),
      run: (e) => e.chain().focus().toggleUnderline().run(),
    },
  ],
  [
    {
      key: 'bullet',
      label: 'Bulleted list',
      icon: 'list',
      isActive: (e) => e.isActive('bulletList'),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
  ],
  [
    {
      key: 'clear',
      label: 'Clear formatting',
      icon: 'refresh',
      isActive: () => false,
      run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  ],
];

export function RichText({
  value,
  onSave,
  saving,
  placeholder = 'Write a handover note…',
  label,
  readOnly,
}: {
  value: string;
  onSave: (html: string) => void;
  saving?: boolean;
  placeholder?: string;
  label: string;
  readOnly?: boolean;
}): React.ReactElement {
  const id = useId();
  const [dirty, setDirty] = useState(false);

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
        Underline,
        Link.configure({ openOnClick: false, autolink: true }),
      ],
      content: value || '',
      editorProps: {
        attributes: {
          class: 'rte-area',
          'data-ph': placeholder,
          'aria-label': label,
          role: 'textbox',
          'aria-multiline': 'true',
          id,
        },
      },
      onUpdate: () => setDirty(true),
    },
    [readOnly]
  );

  // Adopt a value that changed elsewhere — but never while someone is typing.
  useEffect(() => {
    if (!editor || dirty) return;
    const current = editor.getHTML();
    const next = value || '<p></p>';
    // `false` suppresses the update event — otherwise adopting a value from
    // the server would immediately mark the editor dirty again.
    if (current !== next) editor.commands.setContent(next, false);
  }, [editor, value, dirty]);

  if (!editor) {
    return <div className="skel" style={{ height: '160px', borderRadius: 'var(--r-md)' }} />;
  }

  const words = editor.getText().trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="rte">
      {!readOnly && (
        <div className="rte-bar" role="toolbar" aria-label={`${label} formatting`}>
          {BUTTONS.map((group, groupIndex) => (
            <span key={groupIndex} style={{ display: 'contents' }}>
              {groupIndex > 0 && <span className="divider-v" style={{ height: '20px' }} />}
              {group.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  aria-label={button.label}
                  aria-pressed={button.isActive(editor)}
                  className={cx(button.isActive(editor) && 'on')}
                  // Keeps the selection while the button takes the click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => button.run(editor)}
                  style={button.style}
                >
                  {button.icon ? <Icon name={button.icon} size="sm" /> : button.text}
                </button>
              ))}
            </span>
          ))}
        </div>
      )}

      <EditorContent editor={editor} />

      {!readOnly && (
        <div className="rte-foot">
          <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
            {words} {words === 1 ? 'word' : 'words'}
            {dirty && ' · unsaved'}
          </span>
          <Button
            variant="primary"
            size="sm"
            style={{ marginLeft: 'auto' }}
            loading={saving}
            disabled={!dirty}
            onClick={() => {
              onSave(editor.isEmpty ? '' : editor.getHTML());
              setDirty(false);
            }}
          >
            Save note
          </Button>
        </div>
      )}
    </div>
  );
}
