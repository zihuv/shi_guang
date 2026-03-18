# React 卡片拖拽排序方案

基于 Blinko 项目的实现，使用 **@dnd-kit** 库。

## 依赖安装

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## 核心概念

| 概念 | 说明 |
|------|------|
| `DndContext` | 拖拽上下文容器，包裹整个可拖拽区域 |
| `useDraggable` | 让元素变得可拖拽 |
| `useDroppable` | 让元素变得可作为放置目标 |
| `useSensors` | 配置拖拽传感器（鼠标、触摸） |
| `DragOverlay` | 拖拽时跟随光标的半透明副本 |

## 完整代码实现

### 1. 自定义 Hook (`useDragCard.ts`)

```typescript
import { useState, useRef, useEffect } from 'react';
import {
  DragEndEvent,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  useDraggable
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/trpc';  // 替换为你的 API 调用

interface Note {
  id: number;
  isTop: boolean;
  sortOrder: number;
  // ... 其他字段
}

interface UseDragCardProps {
  notes: Note[] | undefined;
  onNotesUpdate?: (notes: Note[]) => void;
  activeId: number | null;
  setActiveId: (id: number | null) => void;
  insertPosition: number | null;
  setInsertPosition: (position: number | null) => void;
  isDragForbidden: boolean;
  setIsDragForbidden: (forbidden: boolean) => void;
}

export const useDragCard = ({
  notes,
  onNotesUpdate,
  activeId,
  setActiveId,
  insertPosition,
  setInsertPosition,
  isDragForbidden,
  setIsDragForbidden
}: UseDragCardProps) => {
  const [localNotes, setLocalNotes] = useState<Note[]>([]);
  const isDraggingRef = useRef(false);

  // 同步外部数据到本地状态
  useEffect(() => {
    if (notes && !isDraggingRef.current) {
      const sortedNotes = [...notes].sort((a, b) => {
        if (a.isTop !== b.isTop) {
          return b.isTop ? 1 : -1;  // 置顶笔记排在前面
        }
        return a.sortOrder - b.sortOrder;
      });
      setLocalNotes(sortedNotes);
      onNotesUpdate?.(sortedNotes);
    } else if (!notes) {
      setLocalNotes([]);
    }
  }, [notes]);

  // 配置传感器：延迟 250ms 后才触发拖拽，防止误触
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  // 拖拽开始
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
    isDraggingRef.current = true;
  };

  // 拖拽过程中
  const handleDragOver = (event: { active: any; over: any }) => {
    const { active, over } = event;
    if (over && active) {
      const targetNoteId = parseInt(over.id.toString().replace('drop-', ''));
      const dragItemId = active.id;

      setInsertPosition(targetNoteId);

      // 检查是否可以跨区域拖拽（例如：置顶区 <-> 普通区）
      const draggedNote = localNotes.find((note) => note.id === dragItemId);
      const targetNote = localNotes.find((note) => note.id === targetNoteId);

      if (draggedNote && targetNote && draggedNote.isTop !== targetNote.isTop) {
        setIsDragForbidden(true);  // 禁止拖拽
      } else {
        setIsDragForbidden(false);
      }
    }
  };

  // 拖拽结束
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    isDraggingRef.current = false;

    if (over) {
      const dropTargetId = over.id.toString();
      const dragItemId = active.id;
      const targetNoteId = parseInt(dropTargetId.replace('drop-', ''));

      if (dragItemId !== targetNoteId) {
        const oldIndex = localNotes.findIndex((note) => note.id === dragItemId);
        const newIndex = localNotes.findIndex((note) => note.id === targetNoteId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const movedNote = localNotes[oldIndex];
          const targetNote = localNotes[newIndex];

          // 阻止跨区域拖拽
          if (movedNote.isTop !== targetNote.isTop) {
            setActiveId(null);
            setInsertPosition(null);
            return;
          }

          // 重新排序
          const newNotes = [...localNotes];
          newNotes.splice(oldIndex, 1);
          newNotes.splice(newIndex, 0, movedNote);

          // 更新 sortOrder
          const updatedNotes = newNotes.map((note, index) => ({
            ...note,
            sortOrder: index,
          }));

          setLocalNotes(updatedNotes);

          // 调用 API 持久化
          const updates = updatedNotes.map((note) => ({
            id: note.id,
            sortOrder: note.sortOrder,
          }));

          api.notes.updateNotesOrder.mutate({ updates });
        }
      }
    }

    setActiveId(null);
    setInsertPosition(null);
    setIsDragForbidden(false);
  };

  return {
    localNotes,
    sensors,
    setLocalNotes,
    isDraggingRef,
    handleDragStart,
    handleDragEnd,
    handleDragOver
  };
};
```

### 2. 可拖拽卡片组件 (`DraggableCard.tsx`)

```typescript
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '@/components/Common/Iconify/icons';

interface DraggableCardProps {
  item: any;
  showInsertLine?: boolean;
  insertPosition?: 'top' | 'bottom';
  isDragForbidden?: boolean;
  onClick?: () => void;
}

export const DraggableCard = ({
  item,
  showInsertLine,
  insertPosition,
  isDragForbidden,
  onClick
}: DraggableCardProps) => {
  // 可放置区域
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `drop-${item.id}`,
  });

  // 可拖拽区域
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging,
  } = useDraggable({
    id: item.id,
  });

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div className="relative">
      {/* 顶部插入线 */}
      {showInsertLine && insertPosition === 'top' && (
        <div className={`absolute -top-2 left-0 right-0 h-1 z-50 rounded-full ${
          isDragForbidden ? 'bg-red-500' : 'bg-blue-500'
        }`} />
      )}

      {/* 放置区域 */}
      <div
        ref={setDroppableRef}
        className={`relative ${
          isDragging ? 'bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg' : ''
        } ${isOver && isDragForbidden ? 'border-2 border-dashed !border-red-500 rounded-lg' : ''}`}
      >
        {/* 禁止图标 */}
        {isOver && isDragForbidden && !isDragging && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-red-500/10 rounded-lg">
            <div className="bg-red-500 text-white rounded-full p-3">
              <Icon icon="ph:prohibit-bold" width="32" height="32" />
            </div>
          </div>
        )}

        {/* 实际卡片 */}
        {isDragging ? (
          <div className="flex items-center justify-center p-8 min-h-[100px]">
            <div className="text-gray-400 text-center">
              <div className="text-sm">拖拽中...</div>
            </div>
          </div>
        ) : (
          <div
            ref={setDraggableRef}
            style={dragStyle}
            {...attributes}
            {...listeners}
            className="cursor-move"
          >
            {/* 这里放置你的卡片组件 */}
            <YourCardComponent item={item} onClick={onClick} />
          </div>
        )}
      </div>

      {/* 底部插入线 */}
      {showInsertLine && insertPosition === 'bottom' && (
        <div className={`absolute -bottom-2 left-0 right-0 h-1 z-50 rounded-full ${
          isDragForbidden ? 'bg-red-500' : 'bg-blue-500'
        }`} />
      )}
    </div>
  );
};
```

### 3. 在页面中使用 (`HomePage.tsx`)

```typescript
import { useState } from 'react';
import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { useDragCard, DraggableCard } from '@/hooks/useDragCard';

const HomePage = () => {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [insertPosition, setInsertPosition] = useState<number | null>(null);
  const [isDragForbidden, setIsDragForbidden] = useState(false);

  const {
    localNotes,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragOver
  } = useDragCard({
    notes: data?.value,  // 从 API 获取的笔记数据
    activeId,
    setActiveId,
    insertPosition,
    setInsertPosition,
    isDragForbidden,
    setIsDragForbidden,
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* 卡片列表 */}
      <div className="grid grid-cols-2 gap-4">
        {localNotes?.map((item) => (
          <DraggableCard
            key={item.id}
            item={item}
            showInsertLine={insertPosition === item.id && activeId !== item.id}
            insertPosition={/* 判断插入位置 */ 'top'}
            isDragForbidden={isDragForbidden}
          />
        ))}
      </div>

      {/* 拖拽时的半透明覆盖层 */}
      <DragOverlay>
        {activeId ? (
          <div className="opacity-80">
            {/* 拖拽中的卡片副本 */}
            <YourCardComponent item={localNotes.find(n => n.id === activeId)} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
```

### 4. 后端 API (可选)

```typescript
// tRPC router 示例
updateNotesOrder: publicProcedure
  .input(z.object({
    updates: z.array(z.object({
      id: z.number(),
      sortOrder: z.number(),
    })),
  }))
  .mutation(async ({ input }) => {
    const updates = input.updates.map(({ id, sortOrder }) =>
      db.note.update({
        where: { id },
        data: { sortOrder },
      })
    );
    await db.$transaction(updates);
  }),
```

## 关键特性

### 1. 防止误触
```typescript
useSensor(MouseSensor, {
  activationConstraint: {
    delay: 250,      // 长按 250ms 才触发
    tolerance: 5,   // 移动 5px 内不算拖拽
  },
})
```

### 2. 区域限制
可以阻止在"置顶"和"非置顶"笔记之间拖拽：
```typescript
if (draggedNote.isTop !== targetNote.isTop) {
  setIsDragForbidden(true);
}
```

### 3. 视觉反馈
- 蓝色插入线：允许放置
- 红色插入线 + 禁止图标：禁止放置
- 拖拽中的卡片：显示虚线占位符
- DragOverlay：拖拽时显示半透明副本

## 注意事项

1. **数据同步**：拖拽时先更新本地状态，再调用 API 持久化
2. **全屏模式**：某些场景下需要禁用拖拽（如打开全屏编辑器时）
3. **触摸屏支持**：`TouchSensor` 需要与 `MouseSensor` 配合使用
4. **排序字段**：数据库需要 `sortOrder` 字段来存储顺序

## 参考资料

- [dnd-kit 官方文档](https://docs.dndkit.com)
- [Blinko 项目源码](https://github.com/jhao0413/blinko)
