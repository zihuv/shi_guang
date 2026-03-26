import { useCallback, useEffect } from "react";

export function useClipboardImport(
  importImagesFromBase64: (
    items: { base64Data: string; ext: string }[],
  ) => Promise<unknown>,
) {
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems: { base64Data: string; ext: string }[] = [];

      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }

        event.preventDefault();
        const blob = item.getAsFile();
        if (!blob) {
          continue;
        }

        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve((reader.result as string).split(",")[1]);
          };
          reader.readAsDataURL(blob);
        });

        const ext = blob.type.split("/")[1] || "png";
        imageItems.push({ base64Data, ext });
      }

      if (imageItems.length > 0) {
        await importImagesFromBase64(imageItems);
      }
    },
    [importImagesFromBase64],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);
}
