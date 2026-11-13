// Keyboard helpers shared by the views, and the shortcut list the ? overlay shows.

export const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !!e.target.isContentEditable

// A single-key shortcut: no ⌘/Ctrl/Alt and not typed into a field (Shift is allowed).
export const plainKey = (e) => !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey

// Esc in a field leaves the field first; the next Esc clears the selection. → true if it blurred
export function blurField(e) {
  if (!isTyping(e)) return false
  e.target.blur()
  return true
}

// Focus (and select) a field once the inspector for a new selection has rendered.
export function focusField(id) {
  setTimeout(() => {
    const el = document.getElementById(id)
    el?.focus()
    el?.select?.()
  }, 30)
}

export const SHORTCUTS = [
  {
    group: 'General',
    items: [
      ['⌘K', 'Go to anything'],
      ['⌘1 – ⌘4', 'Switch view'],
      ['⌘B', 'Show / hide the side bar'],
      ['?', 'Show these shortcuts'],
      ['Esc', 'Leave a field, close a dialog, then deselect'],
    ],
  },
  {
    group: 'Flows',
    items: [
      ['M', 'Go to a method in this folder (pans the canvas to it)'],
      ['N', 'New note on the selection (or the first flow)'],
      ['S', 'New step after the selected step'],
      ['⇧N', 'New flow in this folder'],
      ['↑ ↓', 'Previous / next item'],
      ['← →', 'Out to the flow / into its steps'],
      ['⌥↑ ⌥↓', 'Move the selection up / down'],
      ['↵', 'Edit the selection in the inspector'],
      ['C', 'Comment on the selection'],
      ['F', 'Zoom to the selection (or fit all)'],
      ['[ ]', 'Previous / next editor tab'],
      ['⌫', 'Delete the selection'],
      ['⌘Z  ⇧⌘Z', 'Undo / redo'],
    ],
  },
  {
    group: 'Classes',
    items: [
      ['/', 'Filter classes'],
      ['F', 'Zoom to the selected class'],
    ],
  },
]
