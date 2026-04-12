import type { Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'

export type DragPosition =
  | { type: 'none' }
  | { type: 'nest'; folderId: number }
  | { type: 'sort'; targetId: number; before: boolean }
  | { type: 'instruction'; instruction: Instruction; itemId: number; targetId: number }

export type CleanupFn = () => void

export type RegisterTreeItem = ({
  itemId,
  element,
}: {
  itemId: string
  element: HTMLElement
}) => CleanupFn

export function createTreeItemRegistry() {
  const registry = new Map<string, { element: HTMLElement }>()

  const registerTreeItem: RegisterTreeItem = ({ itemId, element }) => {
    registry.set(itemId, { element })
    return () => {
      registry.delete(itemId)
    }
  }

  return { registry, registerTreeItem }
}
