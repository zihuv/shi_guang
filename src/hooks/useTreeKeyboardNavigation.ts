import { useCallback, useEffect, useRef, type KeyboardEventHandler } from "react"

export type TreeNavigationId = string | number | null

export type TreeNavigationItem<TId extends TreeNavigationId> = {
  id: TId
  parentId: TId | null
  depth: number
  hasChildren: boolean
  isExpanded: boolean
}

type BuildVisibleTreeItemsOptions<TNode, TId extends TreeNavigationId> = {
  expandedIds: readonly TId[]
  getId: (node: TNode) => TId
  getChildren: (node: TNode) => TNode[]
  parentId?: TId | null
  depth?: number
}

type UseTreeKeyboardNavigationOptions<TId extends TreeNavigationId> = {
  items: TreeNavigationItem<TId>[]
  selectedId: TId
  onSelect: (id: TId) => void | Promise<void>
  onToggle: (id: Exclude<TId, null>) => void
  onActivate: () => void
}

const ROOT_ITEM_KEY = "__tree_root__"

function getItemKey(id: TreeNavigationId) {
  return id === null ? ROOT_ITEM_KEY : String(id)
}

export function buildVisibleTreeItems<TNode, TId extends TreeNavigationId>(
  nodes: TNode[],
  {
    expandedIds,
    getId,
    getChildren,
    parentId = null,
    depth = 0,
  }: BuildVisibleTreeItemsOptions<TNode, TId>,
): TreeNavigationItem<TId>[] {
  const expandedIdSet = new Set(expandedIds)

  const visit = (items: TNode[], currentParentId: TId | null, currentDepth: number): TreeNavigationItem<TId>[] =>
    items.flatMap((item) => {
      const id = getId(item)
      const children = getChildren(item)
      const hasChildren = children.length > 0
      const isExpanded = expandedIdSet.has(id)

      return [
        {
          id,
          parentId: currentParentId,
          depth: currentDepth,
          hasChildren,
          isExpanded,
        },
        ...(hasChildren && isExpanded ? visit(children, id, currentDepth + 1) : []),
      ]
    })

  return visit(nodes, parentId, depth)
}

export function useTreeKeyboardNavigation<TId extends TreeNavigationId>({
  items,
  selectedId,
  onSelect,
  onToggle,
  onActivate,
}: UseTreeKeyboardNavigationOptions<TId>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())

  const focusContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const registerItem = useCallback((id: TId, element: HTMLElement | null) => {
    const key = getItemKey(id)
    if (element) {
      itemRefs.current.set(key, element)
      return
    }

    itemRefs.current.delete(key)
  }, [])

  useEffect(() => {
    itemRefs.current.get(getItemKey(selectedId))?.scrollIntoView({ block: "nearest" })
  }, [items, selectedId])

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback((event) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent

    if (
      event.defaultPrevented ||
      nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return
    }

    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Enter"
    ) {
      return
    }

    const currentIndex = items.findIndex((item) => item.id === selectedId)
    const resolvedIndex = currentIndex === -1 ? 0 : currentIndex
    const currentItem = items[resolvedIndex]

    if (!currentItem) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    switch (event.key) {
      case "ArrowUp": {
        const previousItem = items[Math.max(0, resolvedIndex - 1)]
        if (previousItem) {
          void onSelect(previousItem.id)
        }
        return
      }
      case "ArrowDown": {
        const nextItem = items[Math.min(items.length - 1, resolvedIndex + 1)]
        if (nextItem) {
          void onSelect(nextItem.id)
        }
        return
      }
      case "ArrowLeft":
        if (currentItem.id === null) {
          return
        }

        if (currentItem.hasChildren && currentItem.isExpanded) {
          onToggle(currentItem.id as Exclude<TId, null>)
          return
        }

        if (currentItem.parentId !== null || selectedId !== null) {
          void onSelect(currentItem.parentId as TId)
        }
        return
      case "ArrowRight":
        onActivate()
        return
      case "Enter":
        if (currentItem.id !== null && currentItem.hasChildren) {
          onToggle(currentItem.id as Exclude<TId, null>)
          return
        }
        onActivate()
        return
    }
  }, [items, onActivate, onSelect, onToggle, selectedId])

  return {
    containerRef,
    focusContainer,
    registerItem,
    handleKeyDown,
  }
}
