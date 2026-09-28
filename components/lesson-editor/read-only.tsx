"use client"

import { createContext, useContext } from "react"

/**
 * True while the lesson's course is in review. Form controls are disabled by a
 * surrounding <fieldset disabled>; rich-text editors read this to lock
 * themselves, since contenteditable ignores fieldsets.
 */
export const ReadOnlyContext = createContext(false)

export const useReadOnly = () => useContext(ReadOnlyContext)
