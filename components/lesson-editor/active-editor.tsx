"use client"

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { EditorContext, type Editor } from "@tiptap/react"

type ActiveEditorValue = {
  activeEditor: Editor | null
  setActiveEditor: Dispatch<SetStateAction<Editor | null>>
}

const ActiveEditorContext = createContext<ActiveEditorValue | null>(null)

/**
 * A lesson has one rich-text editor per block but a single toolbar. The last
 * focused editor becomes "active" and is exposed through Tiptap's
 * EditorContext, which is what every tiptap-ui button reads from.
 */
export function ActiveEditorProvider({ children }: { children: ReactNode }) {
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)

  return (
    <ActiveEditorContext.Provider value={{ activeEditor, setActiveEditor }}>
      <EditorContext.Provider value={{ editor: activeEditor }}>{children}</EditorContext.Provider>
    </ActiveEditorContext.Provider>
  )
}

export function useActiveEditor() {
  const value = useContext(ActiveEditorContext)
  if (!value) throw new Error("useActiveEditor must be used inside <ActiveEditorProvider>")
  return value
}
