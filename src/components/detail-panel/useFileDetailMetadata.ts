import { useEffect, useMemo, useState } from "react";
import { type FileItem, getNameWithoutExt } from "@/stores/fileTypes";
import { debounce } from "@/utils";

function getExt(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

interface UseFileDetailMetadataOptions {
  file: FileItem;
  updateFileMetadata: (
    fileId: number,
    rating: number,
    description: string,
    sourceUrl: string,
  ) => Promise<void>;
  updateFileName: (fileId: number, name: string) => Promise<void>;
}

export function useFileDetailMetadata({
  file,
  updateFileMetadata,
  updateFileName,
}: UseFileDetailMetadataOptions) {
  const [rating, setRating] = useState(file.rating || 0);
  const [description, setDescription] = useState(file.description || "");
  const [sourceUrl, setSourceUrl] = useState(file.sourceUrl || "");
  const [editedName, setEditedName] = useState(getNameWithoutExt(file.name));

  useEffect(() => {
    setRating(file.rating || 0);
    setDescription(file.description || "");
    setSourceUrl(file.sourceUrl || "");
    setEditedName(getNameWithoutExt(file.name));
  }, [file.rating, file.description, file.sourceUrl, file.name]);

  const saveMetadata = useMemo(
    () =>
      debounce(async (newRating: number, newDescription: string, newSourceUrl: string) => {
        await updateFileMetadata(file.id, newRating, newDescription, newSourceUrl);
      }, 500),
    [file.id, updateFileMetadata],
  );

  const handleRatingChange = (newRating: number) => {
    setRating(newRating);
    saveMetadata(newRating, description, sourceUrl);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    saveMetadata(rating, value, sourceUrl);
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    saveMetadata(rating, description, value);
  };

  const resetEditedName = () => {
    setEditedName(getNameWithoutExt(file.name));
  };

  const handleNameSave = async () => {
    const currentNameWithoutExt = getNameWithoutExt(file.name);
    const ext = getExt(file.name);
    if (editedName && editedName !== currentNameWithoutExt) {
      const fullName = ext ? `${editedName}.${ext}` : editedName;
      await updateFileName(file.id, fullName);
    }
  };

  return {
    description,
    editedName,
    handleDescriptionChange,
    handleNameSave,
    handleRatingChange,
    handleSourceUrlChange,
    rating,
    resetEditedName,
    setEditedName,
    sourceUrl,
  };
}
