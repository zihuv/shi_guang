import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getFileKind } from "@/utils"

type FileTypeIconProps = {
  ext: string
  className?: string
}

const kindColorClassMap = {
  image: "text-emerald-500",
  video: "text-blue-500",
  pdf: "text-red-500",
  audio: "text-orange-500",
  archive: "text-amber-500",
  spreadsheet: "text-green-600",
  presentation: "text-yellow-500",
  word: "text-sky-500",
  code: "text-violet-500",
  text: "text-slate-500",
  other: "text-gray-400",
} as const

export default function FileTypeIcon({ ext, className }: FileTypeIconProps) {
  const kind = getFileKind(ext)

  const Icon =
    kind === "image"
      ? FileImage
      : kind === "video"
        ? FilePlay
        : kind === "audio"
          ? FileMusic
          : kind === "archive"
            ? FileArchive
            : kind === "spreadsheet"
              ? FileSpreadsheet
              : kind === "presentation"
                ? Presentation
                : kind === "word" || kind === "pdf" || kind === "text"
                  ? FileText
                  : kind === "code"
                    ? FileCode
                    : File

  return <Icon className={cn(kindColorClassMap[kind], className)} strokeWidth={1.8} />
}
