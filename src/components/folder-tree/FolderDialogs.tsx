import { useFolderStore } from "@/stores/folderStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";

interface FolderDialogsProps {
  isAdding: boolean;
  setIsAdding: (value: boolean) => void;
  onAddFolder: () => Promise<void>;
  onAddSubfolderSubmit: () => Promise<void>;
  onRenameSubmit: () => Promise<void>;
  onConfirmDelete: () => Promise<void>;
}

export function FolderDialogs({
  isAdding,
  setIsAdding,
  onAddFolder,
  onAddSubfolderSubmit,
  onRenameSubmit,
  onConfirmDelete,
}: FolderDialogsProps) {
  const {
    addingSubfolder,
    editingFolder,
    deleteConfirm,
    newFolderName,
    setAddingSubfolder,
    setEditingFolder,
    setDeleteConfirm,
    setNewFolderName,
  } = useFolderStore();

  return (
    <>
      <Dialog
        open={isAdding}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setIsAdding(false);
            setNewFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onAddFolder();
                }
              }}
              placeholder="文件夹名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setNewFolderName("");
              }}
            >
              取消
            </Button>
            <Button onClick={() => void onAddFolder()}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!addingSubfolder}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setAddingSubfolder(null);
            setNewFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建子文件夹</DialogTitle>
            <DialogDescription>在 "{addingSubfolder?.name}" 下创建子文件夹</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onAddSubfolderSubmit();
                }
              }}
              placeholder="子文件夹名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAddingSubfolder(null);
                setNewFolderName("");
              }}
            >
              取消
            </Button>
            <Button onClick={() => void onAddSubfolderSubmit()}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingFolder}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setEditingFolder(null);
            setNewFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onRenameSubmit();
                }
              }}
              placeholder="新名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditingFolder(null);
                setNewFolderName("");
              }}
            >
              取消
            </Button>
            <Button onClick={() => void onRenameSubmit()}>确定</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleteConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除文件夹 "{deleteConfirm?.name}"
              吗？删除后文件夹中的文件不会被删除，但会变成未分类状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
