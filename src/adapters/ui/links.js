import { createContext } from 'react'

// onLink({ tab, flow? }) — jump to another folder tab, optionally focusing a flow
export const LinkContext = createContext(() => {})

// linkInfo({ tab, flow? }) → { label, path, title }: where a link goes, named by the target
// flow's file when it has one ("utils/anthropic_client.py"), else by the folder.
export const LinkInfoContext = createContext((link) => ({ label: link.tab.split('/').pop(), path: link.tab, title: link.tab }))

// Canvas-side edit actions that nodes trigger directly (e.g. collapse chevrons).
export const EditContext = createContext({ toggleCollapse: () => {} })

// ref → { count, state } of message threads in the active folder (for node badges).
export const ThreadsContext = createContext({})
