import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { toast } from "sonner"
import { startExternalFileDrag } from "@/lib/externalDrag"
import { useFileStore } from "@/stores/fileStore"

const EXTERNAL_DRAG_THRESHOLD = 6
const EXTERNAL_DRAG_REGION_SELECTOR = "[data-external-drag-region='true']"

type PendingExternalDrag = {
  startX: number
  startY: number
  started: boolean
}

function getExternalDragFileIds(fileId: number) {
  const { selectedFiles } = useFileStore.getState()
  return selectedFiles.includes(fileId) ? selectedFiles : [fileId]
}

export function isExternalDragRegionTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(EXTERNAL_DRAG_REGION_SELECTOR) !== null
}

export function useExternalFileDrag(fileId: number) {
  const [isTrackingExternalDrag, setIsTrackingExternalDrag] = useState(false)
  const pendingExternalDragRef = useRef<PendingExternalDrag | null>(null)

  const clearPendingExternalDrag = useCallback(() => {
    pendingExternalDragRef.current = null
    setIsTrackingExternalDrag(false)
  }, [])

  useEffect(() => {
    if (!isTrackingExternalDrag) {
      return
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const current = pendingExternalDragRef.current
      if (!current) {
        clearPendingExternalDrag()
        return
      }

      if ((event.buttons & 1) !== 1) {
        clearPendingExternalDrag()
        return
      }

      if (current.started) {
        return
      }

      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < EXTERNAL_DRAG_THRESHOLD) {
        return
      }

      current.started = true
      clearPendingExternalDrag()
      useFileStore.getState().clearInternalFileDrag()

      void startExternalFileDrag(getExternalDragFileIds(fileId)).catch((error) => {
        console.error("Failed to start external file drag:", error)
        toast.error("拖拽到外部应用失败")
      })
    }

    const handleWindowMouseUp = () => {
      clearPendingExternalDrag()
    }

    const handleWindowBlur = () => {
      clearPendingExternalDrag()
    }

    window.addEventListener("mousemove", handleWindowMouseMove)
    window.addEventListener("mouseup", handleWindowMouseUp)
    window.addEventListener("blur", handleWindowBlur)

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
      window.removeEventListener("blur", handleWindowBlur)
    }
  }, [clearPendingExternalDrag, fileId, isTrackingExternalDrag])

  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    pendingExternalDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    }
    setIsTrackingExternalDrag(true)
  }, [])

  return {
    dragHandleProps: {
      "data-external-drag-region": "true",
      onMouseDown: handleMouseDown,
    } as const,
  }
}
